import process from 'node:process';
import { spawn, type ChildProcess } from 'node:child_process';
import type { RuntimeStartRequest } from './index.js';
import type {
  LocalSupervisorProcessHandle,
  LocalSupervisorProcessLauncher
} from './local-supervisor.js';

export interface StdioProcessLauncherLogEvent {
  event_name: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface StdioProcessLauncherOptions {
  healthCheckTimeoutMs?: number;
  logger?: {
    log(event: StdioProcessLauncherLogEvent): void | Promise<void>;
  };
  onSpawn?: (event: { package_id: string; child: ChildProcess }) => void | Promise<void>;
  onExit?: (event: {
    package_id: string;
    code: number | null;
    signal: string | null;
  }) => void | Promise<void>;
}

export interface ManagedLocalSupervisorProcessHandle
  extends LocalSupervisorProcessHandle {
  kill(): void;
  pid?: number;
}

export interface StdioProcessLauncher extends LocalSupervisorProcessLauncher {
  launch(
    request: RuntimeStartRequest,
    attempt: number
  ): Promise<ManagedLocalSupervisorProcessHandle>;
  getProcess(packageId: string): ChildProcess | undefined;
}

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;

let nextMcpRequestId = 0;

function createMcpInitializeRequest() {
  nextMcpRequestId += 1;

  return {
    requestId: nextMcpRequestId,
    payload:
      JSON.stringify({
        jsonrpc: '2.0',
        id: nextMcpRequestId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'forge-runtime-daemon',
            version: '0.1.0'
          }
        }
      }) + '\n'
  };
}

function createFailedHandle(code: number): ManagedLocalSupervisorProcessHandle {
  return {
    async waitForExit() {
      return {
        code,
        signal: null
      };
    },

    async healthCheck() {
      return false;
    },

    kill() {}
  };
}

async function emitLog(
  logger: StdioProcessLauncherOptions['logger'],
  event_name: string,
  payload: Record<string, unknown>
) {
  if (!logger) {
    return;
  }

  await logger.log({
    event_name,
    occurred_at: new Date().toISOString(),
    payload
  });
}

function normalizeChunk(chunk: Buffer | string): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
}

export function createStdioProcessLauncher(
  options: StdioProcessLauncherOptions = {}
): StdioProcessLauncher {
  const timeoutMs = options.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  const processes = new Map<string, ChildProcess>();

  return {
    getProcess(packageId: string) {
      return processes.get(packageId);
    },

    async launch(request, _attempt) {
      const command = request.process_command;
      if (!command) {
        await emitLog(options.logger, 'runtime.process_spawn_failed', {
          package_id: request.package_id,
          reason: 'process_command_missing'
        });
        return createFailedHandle(1);
      }

      let child: ChildProcess;
      try {
        child = spawn(command.command, command.args, {
          env: {
            ...process.env,
            ...(command.env ?? {})
          },
          ...(command.cwd ? { cwd: command.cwd } : {}),
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (error) {
        await emitLog(options.logger, 'runtime.process_spawn_failed', {
          package_id: request.package_id,
          command: command.command,
          reason: error instanceof Error ? error.message : 'unknown_spawn_error'
        });
        return createFailedHandle(1);
      }

      const spawnError = await new Promise<Error | null>((resolve) => {
        const onError = (error: Error) => {
          child.off('spawn', onSpawn);
          resolve(error);
        };
        const onSpawn = () => {
          child.off('error', onError);
          resolve(null);
        };

        child.once('error', onError);
        child.once('spawn', onSpawn);
      });

      if (spawnError) {
        await emitLog(options.logger, 'runtime.process_spawn_failed', {
          package_id: request.package_id,
          command: command.command,
          reason: spawnError.message
        });
        return createFailedHandle(1);
      }

      processes.set(request.package_id, child);
      await options.onSpawn?.({
        package_id: request.package_id,
        child
      });

      let exitResult: { code: number | null; signal: string | null } | null = null;
      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.once('exit', (code, signal) => {
          exitResult = {
            code,
            signal: signal ?? null
          };
          processes.delete(request.package_id);
          void options.onExit?.({
            package_id: request.package_id,
            code,
            signal: signal ?? null
          });
          resolve(exitResult);
        });
      });

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer | string) => {
          void emitLog(options.logger, 'runtime.process_stderr', {
            package_id: request.package_id,
            data: normalizeChunk(chunk).trimEnd()
          });
        });
      }

      child.on('error', (error) => {
        void emitLog(options.logger, 'runtime.process_error', {
          package_id: request.package_id,
          reason: error.message
        });
      });

      let healthStatus: boolean | null = null;

      return {
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
        async healthCheck() {
          if (healthStatus !== null) {
            return healthStatus && child.exitCode === null;
          }

          if (exitResult || !child.stdin || !child.stdout) {
            healthStatus = false;
            return false;
          }

          const stdin = child.stdin;
          const stdout = child.stdout;
          const { requestId, payload } = createMcpInitializeRequest();

          healthStatus = await new Promise<boolean>((resolve) => {
            let settled = false;
            let buffer = '';

            const finalize = (value: boolean) => {
              if (settled) {
                return;
              }

              settled = true;
              clearTimeout(timer);
              stdout.off('data', onData);
              child.off('exit', onExit);
              resolve(value);
            };

            const onExit = () => {
              finalize(false);
            };

            const onData = (chunk: Buffer | string) => {
              buffer += normalizeChunk(chunk);
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.length === 0) {
                  continue;
                }

                try {
                  const message = JSON.parse(trimmed) as {
                    id?: unknown;
                    result?: unknown;
                  };

                  if (message.id === requestId && message.result !== undefined) {
                    finalize(true);
                    return;
                  }
                } catch {
                  continue;
                }
              }
            };

            const timer = setTimeout(() => {
              finalize(false);
            }, timeoutMs);

            stdout.on('data', onData);
            child.once('exit', onExit);
            stdin.write(payload, (error) => {
              if (error) {
                finalize(false);
              }
            });
          });

          return healthStatus;
        },

        async waitForExit() {
          if (exitResult) {
            return exitResult;
          }

          return exitPromise;
        },

        kill() {
          if (!exitResult && !child.killed) {
            child.kill('SIGTERM');
          }
        }
      };
    }
  };
}
