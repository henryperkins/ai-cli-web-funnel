import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { evaluatePolicyPreflight } from '@forge/policy-engine';
import { validateDaemonStartupEnv } from './daemon-env-validation.js';
import { resolveRuntimeFeatureFlagsFromEnv } from './daemon-feature-flags.js';
import { createDaemonHttpApp } from './daemon-http-app.js';
import {
  createRuntimeOAuthTokenClientFromEnv,
  createRuntimeRemoteResolverFromEnv,
  createSecretRefResolverFromEnv
} from './daemon-remote-config.js';
import { createHttpProbeClient } from './http-probe-client.js';
import { createRuntimeDaemonBootstrap } from './runtime-bootstrap.js';
import { createStdioProcessLauncher } from './stdio-process-launcher.js';

export interface KillableProcess {
  kill(): void;
}

interface RegisteredProcess {
  process: KillableProcess;
  pid?: number;
}

function structuredLog(event_name: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event_name,
      occurred_at: new Date().toISOString(),
      payload
    })
  );
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    request.on('error', reject);
  });
}

export function createProcessRegistry() {
  const processes = new Map<string, RegisteredProcess>();

  return {
    register(packageId: string, process: KillableProcess, pid?: number) {
      processes.set(packageId, {
        process,
        ...(pid !== undefined ? { pid } : {})
      });
    },

    unregister(packageId: string) {
      processes.delete(packageId);
    },

    getStatus(packageId: string): { package_id: string; state: string; pid?: number } | null {
      const entry = processes.get(packageId);
      if (!entry) {
        return null;
      }

      return {
        package_id: packageId,
        state: 'running',
        ...(entry.pid !== undefined ? { pid: entry.pid } : {})
      };
    },

    async stop(packageId: string): Promise<{ ok: boolean }> {
      const entry = processes.get(packageId);
      if (!entry) {
        return {
          ok: false
        };
      }

      entry.process.kill();
      processes.delete(packageId);
      return {
        ok: true
      };
    },

    async shutdownAll(): Promise<void> {
      for (const [packageId, entry] of [...processes.entries()]) {
        entry.process.kill();
        processes.delete(packageId);
      }
    },

    get size() {
      return processes.size;
    }
  };
}

async function main(): Promise<void> {
  const envValidation = validateDaemonStartupEnv(process.env);
  if (!envValidation.ok) {
    structuredLog('daemon.startup_validation_failed', {
      errors: envValidation.errors
    });
    process.exit(1);
  }

  const logger = {
    log(event: { event_name: string; occurred_at: string; payload: Record<string, unknown> }) {
      console.log(JSON.stringify(event));
    }
  };

  const processRegistry = createProcessRegistry();
  const processLauncher = createStdioProcessLauncher({
    logger,
    onSpawn({ package_id, child }) {
      processRegistry.register(
        package_id,
        {
          kill() {
            child.kill('SIGTERM');
          }
        },
        child.pid ?? undefined
      );
    },
    onExit({ package_id }) {
      processRegistry.unregister(package_id);
    }
  });

  const bootstrap = createRuntimeDaemonBootstrap({
    featureFlags: resolveRuntimeFeatureFlagsFromEnv({
      env: process.env
    }),
    policyClient: {
      async preflight(input) {
        return evaluatePolicyPreflight(input);
      }
    },
    localSupervisorLauncher: processLauncher,
    remoteResolver: createRuntimeRemoteResolverFromEnv(process.env),
    secretResolver: createSecretRefResolverFromEnv(process.env),
    remoteProbeClient: createHttpProbeClient({
      logger
    }),
    oauthTokenClient: createRuntimeOAuthTokenClientFromEnv(logger),
    logger
  });

  let ready = false;
  let shuttingDown = false;

  const app = createDaemonHttpApp({
    pipeline: {
      async run(request) {
        return bootstrap.run(request);
      }
    },
    processRegistry,
    readinessProbe: async () => ({
      ok: ready,
      details: ready ? ['ready'] : ['initializing']
    })
  });

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? 'GET';
    const url = request.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    const body = method === 'POST' ? await readRequestBody(request) : '';
    const result = await app.handle(method, path, body);

    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(envValidation.port, '0.0.0.0', () => {
      server.off('error', reject);
      ready = true;
      structuredLog('daemon.started', {
        host: '0.0.0.0',
        port: envValidation.port
      });
      resolve();
    });
  });

  const close = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    ready = false;

    structuredLog('daemon.shutting_down', {
      signal,
      supervised_processes: processRegistry.size
    });

    await processRegistry.shutdownAll();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    structuredLog('daemon.stopped', {
      signal
    });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', () => {
    void close('SIGINT');
  });
  process.on('SIGTERM', () => {
    void close('SIGTERM');
  });
}

function isExecutedAsScript() {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isExecutedAsScript()) {
  void main().catch((error) => {
    structuredLog('daemon.startup_failed', {
      reason: error instanceof Error ? error.message : 'unknown_error'
    });
    process.exit(1);
  });
}
