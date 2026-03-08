# Runtime Daemon Standalone Process Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the runtime daemon a production-ready standalone HTTP process with concrete `child_process` and `fetch`-based implementations, then rewire the control-plane to communicate with it over HTTP.

**Architecture:** The daemon gets its own `node:http` server exposing runtime pipeline routes. A concrete stdio process launcher spawns MCP servers via `child_process.spawn`. A concrete HTTP probe client verifies remote endpoints via `fetch`. The control-plane replaces its inline bootstrap wiring with an HTTP client that POSTs to the daemon.

**Tech Stack:** Node.js `node:http`, `node:child_process`, Vitest, TypeScript ESM (NodeNext resolution)

---

### Task 1: Extend `RuntimeStartRequest` with `process_command`

**Files:**
- Modify: `apps/runtime-daemon/src/index.ts:29-39`
- Test: `apps/runtime-daemon/tests/runtime-pipeline.test.ts`

**Step 1: Add the optional `process_command` field to `RuntimeStartRequest`**

In `apps/runtime-daemon/src/index.ts`, add after line 38 (`policy_input`):

```typescript
export interface ProcessCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface RuntimeStartRequest {
  package_id: string;
  package_slug: string;
  correlation_id?: string;
  mode: RuntimeMode;
  transport: RuntimeTransport;
  trust_state: TrustState;
  trust_reset_trigger: TrustResetTrigger;
  scope_candidates: RuntimeScopeCandidate[];
  policy_input: PolicyPreflightInput;
  process_command?: ProcessCommand;
}
```

**Step 2: Run existing tests to verify no regressions**

Run: `npx vitest run apps/runtime-daemon/tests --reporter=verbose`
Expected: All existing tests pass (field is optional, no breakage).

**Step 3: Run typecheck across workspaces**

Run: `npm run typecheck`
Expected: Clean — optional field doesn't break any call sites.

**Step 4: Commit**

```bash
git add apps/runtime-daemon/src/index.ts
git commit -m "feat(runtime-daemon): add optional process_command to RuntimeStartRequest"
```

---

### Task 2: Concrete stdio process launcher

**Files:**
- Create: `apps/runtime-daemon/src/stdio-process-launcher.ts`
- Create: `apps/runtime-daemon/tests/stdio-process-launcher.test.ts`
- Create: `apps/runtime-daemon/tests/fixtures/echo-server.mjs` (test helper)

**Step 1: Create the test helper — a trivial MCP-like process**

Create `apps/runtime-daemon/tests/fixtures/echo-server.mjs`:

```javascript
// Minimal stdio process that reads a JSON-RPC request from stdin, responds, then exits.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'echo', version: '0.1.0' } }
      });
      process.stdout.write(response + '\n');
    }
  } catch {
    // ignore parse errors
  }
});

// Exit cleanly after 2 seconds if no input
setTimeout(() => process.exit(0), 2000);
```

**Step 2: Write the failing tests**

Create `apps/runtime-daemon/tests/stdio-process-launcher.test.ts`:

```typescript
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStdioProcessLauncher } from '../src/stdio-process-launcher.js';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    package_id: 'pkg-test',
    package_slug: 'acme/test',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-test',
      requested_permissions: [],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-test'],
        block_flagged: false,
        permission_caps: { maxPermissions: 3, disallowedPermissions: [] }
      },
      enforcement: {
        package_id: 'pkg-test',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-03-01T00:00:00Z'
      }
    },
    process_command: {
      command: 'node',
      args: [join(FIXTURE_DIR, 'echo-server.mjs')],
    },
    ...overrides
  };
}

describe('stdio process launcher', () => {
  it('launches a process and returns a healthy handle', async () => {
    const launcher = createStdioProcessLauncher();
    const handle = await launcher.launch(buildRequest(), 1);

    const healthy = await handle.healthCheck();
    expect(healthy).toBe(true);

    const exit = await handle.waitForExit();
    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
  });

  it('returns unhealthy handle when command does not exist', async () => {
    const launcher = createStdioProcessLauncher();
    const handle = await launcher.launch(
      buildRequest({
        process_command: { command: '/nonexistent/binary', args: [] }
      }),
      1
    );

    const healthy = await handle.healthCheck();
    expect(healthy).toBe(false);

    const exit = await handle.waitForExit();
    expect(exit.code).not.toBe(0);
  });

  it('returns unhealthy handle when process_command is missing', async () => {
    const launcher = createStdioProcessLauncher();
    const handle = await launcher.launch(
      buildRequest({ process_command: undefined }),
      1
    );

    const healthy = await handle.healthCheck();
    expect(healthy).toBe(false);
  });

  it('health check times out against a non-responding process', async () => {
    const launcher = createStdioProcessLauncher({ healthCheckTimeoutMs: 200 });
    const handle = await launcher.launch(
      buildRequest({
        process_command: { command: 'node', args: ['-e', 'setTimeout(()=>{},10000)'] }
      }),
      1
    );

    const healthy = await handle.healthCheck();
    expect(healthy).toBe(false);

    handle.kill();
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run apps/runtime-daemon/tests/stdio-process-launcher.test.ts --reporter=verbose`
Expected: FAIL — module `../src/stdio-process-launcher.js` not found.

**Step 4: Implement the launcher**

Create `apps/runtime-daemon/src/stdio-process-launcher.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import type { RuntimeStartRequest } from './index.js';
import type {
  LocalSupervisorProcessHandle,
  LocalSupervisorProcessLauncher
} from './local-supervisor.js';

export interface StdioProcessLauncherOptions {
  healthCheckTimeoutMs?: number;
  logger?: {
    log(event: { event_name: string; occurred_at: string; payload: Record<string, unknown> }): void | Promise<void>;
  };
}

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;

let mcpRequestId = 0;

function createMcpInitializeRequest(): string {
  mcpRequestId += 1;
  return JSON.stringify({
    jsonrpc: '2.0',
    id: mcpRequestId,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'forge-daemon', version: '0.1.0' }
    }
  }) + '\n';
}

function createFailedHandle(code: number): LocalSupervisorProcessHandle & { kill(): void } {
  return {
    async waitForExit() {
      return { code, signal: null };
    },
    async healthCheck() {
      return false;
    },
    kill() {}
  };
}

export function createStdioProcessLauncher(
  options: StdioProcessLauncherOptions = {}
): LocalSupervisorProcessLauncher & { getProcess(packageId: string): ChildProcess | undefined } {
  const timeoutMs = options.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  const processes = new Map<string, ChildProcess>();

  return {
    getProcess(packageId: string) {
      return processes.get(packageId);
    },

    async launch(request: RuntimeStartRequest, _attempt: number) {
      const cmd = request.process_command;
      if (!cmd) {
        return createFailedHandle(1);
      }

      let child: ChildProcess;
      try {
        child = spawn(cmd.command, cmd.args, {
          env: { ...process.env, ...(cmd.env ?? {}) },
          cwd: cmd.cwd,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch {
        return createFailedHandle(1);
      }

      // Handle spawn errors (ENOENT, EACCES)
      const spawnError = await new Promise<Error | null>((resolve) => {
        child.once('error', (err) => resolve(err));
        child.once('spawn', () => resolve(null));
      });

      if (spawnError) {
        if (options.logger) {
          void options.logger.log({
            event_name: 'runtime.process_spawn_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              package_id: request.package_id,
              command: cmd.command,
              error: spawnError.message
            }
          });
        }
        return createFailedHandle(1);
      }

      processes.set(request.package_id, child);

      let exitResult: { code: number | null; signal: string | null } | null = null;
      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.once('exit', (code, signal) => {
          exitResult = { code, signal: signal ?? null };
          processes.delete(request.package_id);
          resolve(exitResult);
        });
      });

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          if (options.logger) {
            void options.logger.log({
              event_name: 'runtime.process_stderr',
              occurred_at: new Date().toISOString(),
              payload: {
                package_id: request.package_id,
                data: chunk.toString('utf-8').trimEnd()
              }
            });
          }
        });
      }

      let healthChecked = false;

      return {
        async healthCheck() {
          if (exitResult) {
            return false;
          }

          if (healthChecked) {
            return child.exitCode === null;
          }

          healthChecked = true;

          if (!child.stdin || !child.stdout) {
            return false;
          }

          return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              resolve(false);
            }, timeoutMs);

            let buffer = '';
            const onData = (chunk: Buffer) => {
              buffer += chunk.toString('utf-8');
              const lines = buffer.split('\n');
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const msg = JSON.parse(line);
                  if (msg.result && msg.id) {
                    clearTimeout(timer);
                    child.stdout!.off('data', onData);
                    resolve(true);
                    return;
                  }
                } catch {
                  // not valid JSON yet, keep buffering
                }
              }
            };

            child.stdout.on('data', onData);
            child.stdin.write(createMcpInitializeRequest());
          });
        },

        async waitForExit() {
          if (exitResult) {
            return exitResult;
          }
          return exitPromise;
        },

        kill() {
          if (!exitResult) {
            child.kill('SIGTERM');
          }
        }
      } satisfies LocalSupervisorProcessHandle & { kill(): void };
    }
  };
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/runtime-daemon/tests/stdio-process-launcher.test.ts --reporter=verbose`
Expected: All 4 tests PASS.

**Step 6: Add export to package.json**

In `apps/runtime-daemon/package.json`, add to `exports`:

```json
"./stdio-process-launcher": {
  "types": "./src/stdio-process-launcher.ts",
  "default": "./dist/stdio-process-launcher.js"
}
```

**Step 7: Commit**

```bash
git add apps/runtime-daemon/src/stdio-process-launcher.ts apps/runtime-daemon/tests/stdio-process-launcher.test.ts apps/runtime-daemon/tests/fixtures/echo-server.mjs apps/runtime-daemon/package.json
git commit -m "feat(runtime-daemon): add concrete child_process stdio launcher with MCP health check"
```

---

### Task 3: Concrete HTTP probe client

**Files:**
- Create: `apps/runtime-daemon/src/http-probe-client.ts`
- Create: `apps/runtime-daemon/tests/http-probe-client.test.ts`

**Step 1: Write the failing tests**

Create `apps/runtime-daemon/tests/http-probe-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createHttpProbeClient } from '../src/http-probe-client.js';

function fakeFetch(
  responseInit: { status: number; headers?: Record<string, string>; body?: string } | 'throw'
): typeof fetch {
  return async (input, init) => {
    if (responseInit === 'throw') {
      throw new Error('network_error');
    }
    return new Response(responseInit.body ?? '', {
      status: responseInit.status,
      headers: responseInit.headers
    });
  };
}

describe('http probe client', () => {
  it('probeSse returns ok when response is 200 with text/event-stream', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch({
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    });

    const result = await client.probeSse('https://example.com/sse', {});
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('probeSse returns not ok when response is non-2xx', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch({ status: 502 })
    });

    const result = await client.probeSse('https://example.com/sse', {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it('probeSse returns not ok on network error', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch('throw')
    });

    const result = await client.probeSse('https://example.com/sse', {});
    expect(result.ok).toBe(false);
    expect(result.details).toBe('network_error');
  });

  it('probeStreamableHttp sends POST with correct accept header', async () => {
    let capturedInit: RequestInit | undefined;
    const client = createHttpProbeClient({
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response('{}', { status: 200 });
      }
    });

    const result = await client.probeStreamableHttp('https://example.com/mcp', {
      Authorization: 'Bearer tok'
    });

    expect(result.ok).toBe(true);
    expect(capturedInit?.method).toBe('POST');
  });

  it('probeStreamableHttp returns not ok on network error', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch('throw')
    });

    const result = await client.probeStreamableHttp('https://example.com/mcp', {});
    expect(result.ok).toBe(false);
    expect(result.details).toBe('network_error');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/runtime-daemon/tests/http-probe-client.test.ts --reporter=verbose`
Expected: FAIL — module not found.

**Step 3: Implement the probe client**

Create `apps/runtime-daemon/src/http-probe-client.ts`:

```typescript
import type { RemoteProbeClient, RemoteProbeResult } from './remote-connectors.js';

export interface HttpProbeClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: {
    log(event: { event_name: string; occurred_at: string; payload: Record<string, unknown> }): void | Promise<void>;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function createHttpProbeClient(
  options: HttpProbeClientOptions = {}
): RemoteProbeClient {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function doFetch(
    url: string,
    init: RequestInit
  ): Promise<RemoteProbeResult> {
    try {
      const response = await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });

      return {
        ok: response.ok,
        status: response.status,
        details: response.ok ? 'probe_ok' : 'probe_http_error'
      };
    } catch (error) {
      return {
        ok: false,
        details: error instanceof Error ? error.message : 'probe_request_failed'
      };
    }
  }

  return {
    async probeSse(url, headers) {
      return doFetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...headers
        },
        redirect: 'manual'
      });
    },

    async probeStreamableHttp(url, headers) {
      return doFetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'forge-daemon-probe', version: '0.1.0' }
          }
        }),
        redirect: 'manual'
      });
    }
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/runtime-daemon/tests/http-probe-client.test.ts --reporter=verbose`
Expected: All 5 tests PASS.

**Step 5: Add export to package.json**

In `apps/runtime-daemon/package.json`, add to `exports`:

```json
"./http-probe-client": {
  "types": "./src/http-probe-client.ts",
  "default": "./dist/http-probe-client.js"
}
```

**Step 6: Commit**

```bash
git add apps/runtime-daemon/src/http-probe-client.ts apps/runtime-daemon/tests/http-probe-client.test.ts apps/runtime-daemon/package.json
git commit -m "feat(runtime-daemon): add concrete fetch-based HTTP probe client"
```

---

### Task 4: Daemon env validation

**Files:**
- Create: `apps/runtime-daemon/src/daemon-env-validation.ts`

**Step 1: Implement env validation**

Create `apps/runtime-daemon/src/daemon-env-validation.ts`:

```typescript
export interface DaemonEnvValidationResult {
  ok: boolean;
  errors: string[];
  port: number;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function validateDaemonStartupEnv(
  env: Record<string, string | undefined>
): DaemonEnvValidationResult {
  const errors: string[] = [];

  const rawPort = env.FORGE_DAEMON_PORT ?? '4100';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    errors.push('FORGE_DAEMON_PORT must be a valid port number (1-65535)');
  }

  // Remote connector env vars are validated only if remote modes are enabled
  const remoteSse = env.FORGE_RUNTIME_REMOTE_SSE_ENABLED;
  if (remoteSse === '1' || remoteSse === 'true') {
    if (!hasValue(env.FORGE_RUNTIME_REMOTE_SSE_URL)) {
      errors.push('FORGE_RUNTIME_REMOTE_SSE_URL is required when remote SSE is enabled');
    }
  }

  const remoteHttp = env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED;
  if (remoteHttp === '1' || remoteHttp === 'true') {
    if (!hasValue(env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL)) {
      errors.push('FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL is required when remote streamable-HTTP is enabled');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    port: Number.isFinite(port) ? port : 4100
  };
}
```

**Step 2: Add export to package.json**

In `apps/runtime-daemon/package.json`, add to `exports`:

```json
"./daemon-env-validation": {
  "types": "./src/daemon-env-validation.ts",
  "default": "./dist/daemon-env-validation.js"
}
```

**Step 3: Commit**

```bash
git add apps/runtime-daemon/src/daemon-env-validation.ts apps/runtime-daemon/package.json
git commit -m "feat(runtime-daemon): add daemon startup env validation"
```

---

### Task 5: Daemon HTTP app (routing layer)

**Files:**
- Create: `apps/runtime-daemon/src/daemon-http-app.ts`
- Create: `apps/runtime-daemon/tests/daemon-http-app.test.ts`

**Step 1: Write the failing tests**

Create `apps/runtime-daemon/tests/daemon-http-app.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createDaemonHttpApp, type DaemonHttpAppDependencies } from '../src/daemon-http-app.js';
import type { RuntimePipelineResult, RuntimeStartRequest } from '../src/index.js';

function buildMockPipelineResult(ready: boolean): RuntimePipelineResult {
  return {
    ready,
    failure_reason_code: ready ? null : 'preflight_checks_failed',
    final_trust_state: 'trusted',
    policy: {
      outcome: 'allowed',
      install_allowed: true,
      runtime_allowed: true,
      reason_code: null,
      warnings: [],
      policy_blocked: false,
      blocked_by: 'none'
    },
    scope_resolution: {
      ordered_writable_scopes: [],
      blocked_scopes: []
    },
    stages: [
      { stage: 'policy_preflight', ok: true, details: ['allowed'] },
      { stage: 'trust_gate', ok: true, details: ['trust_state=trusted'] }
    ]
  };
}

function buildDependencies(
  overrides: Partial<DaemonHttpAppDependencies> = {}
): DaemonHttpAppDependencies {
  return {
    pipeline: {
      async run(_request: RuntimeStartRequest) {
        return buildMockPipelineResult(true);
      }
    },
    processRegistry: {
      getStatus(_packageId: string) {
        return null;
      },
      async stop(_packageId: string) {
        return { ok: true };
      }
    },
    readinessProbe: async () => ({ ok: true, details: ['ready'] }),
    ...overrides
  };
}

describe('daemon http app', () => {
  it('POST /v1/runtime/verify returns pipeline result', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('POST', '/v1/runtime/verify', JSON.stringify({
      package_id: 'pkg-1',
      package_slug: 'acme/pkg-1',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted',
      trust_reset_trigger: 'none',
      scope_candidates: [],
      policy_input: {
        org_id: 'org-1',
        package_id: 'pkg-1',
        requested_permissions: [],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: ['pkg-1'],
          block_flagged: false,
          permission_caps: { maxPermissions: 3, disallowedPermissions: [] }
        },
        enforcement: {
          package_id: 'pkg-1',
          state: 'none',
          reason_code: null,
          policy_blocked: false,
          source: 'none',
          updated_at: '2026-03-01T00:00:00Z'
        }
      }
    }));

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.ready).toBe(true);
    expect(body.stages).toHaveLength(2);
  });

  it('POST /v1/runtime/start is an alias for verify', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('POST', '/v1/runtime/start', JSON.stringify({
      package_id: 'pkg-1',
      package_slug: 'acme/pkg-1',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted',
      trust_reset_trigger: 'none',
      scope_candidates: [],
      policy_input: {
        org_id: 'org-1',
        package_id: 'pkg-1',
        requested_permissions: [],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: ['pkg-1'],
          block_flagged: false,
          permission_caps: { maxPermissions: 3, disallowedPermissions: [] }
        },
        enforcement: {
          package_id: 'pkg-1',
          state: 'none',
          reason_code: null,
          policy_blocked: false,
          source: 'none',
          updated_at: '2026-03-01T00:00:00Z'
        }
      }
    }));

    expect(result.status).toBe(200);
  });

  it('returns 400 on invalid JSON body', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('POST', '/v1/runtime/verify', 'not json');
    expect(result.status).toBe(400);
  });

  it('GET /health returns 200', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('GET', '/health', '');
    expect(result.status).toBe(200);
  });

  it('GET /ready returns 200 when ready', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('GET', '/ready', '');
    expect(result.status).toBe(200);
  });

  it('GET /ready returns 503 when not ready', async () => {
    const app = createDaemonHttpApp(buildDependencies({
      readinessProbe: async () => ({ ok: false, details: ['initializing'] })
    }));
    const result = await app.handle('GET', '/ready', '');
    expect(result.status).toBe(503);
  });

  it('returns 404 for unknown routes', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('GET', '/unknown', '');
    expect(result.status).toBe(404);
  });

  it('POST /v1/runtime/stop returns result from process registry', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('POST', '/v1/runtime/stop', JSON.stringify({
      package_id: 'pkg-1'
    }));
    expect(result.status).toBe(200);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/runtime-daemon/tests/daemon-http-app.test.ts --reporter=verbose`
Expected: FAIL — module not found.

**Step 3: Implement the daemon HTTP app**

Create `apps/runtime-daemon/src/daemon-http-app.ts`:

```typescript
import type { RuntimePipelineResult, RuntimeStartRequest } from './index.js';

export interface DaemonHttpAppDependencies {
  pipeline: {
    run(request: RuntimeStartRequest): Promise<RuntimePipelineResult>;
  };
  processRegistry: {
    getStatus(packageId: string): { package_id: string; state: string; pid?: number } | null;
    stop(packageId: string): Promise<{ ok: boolean }>;
  };
  readinessProbe: () => Promise<{ ok: boolean; details?: string[] }>;
}

interface HttpResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

function json(status: number, body: unknown): HttpResult {
  return {
    status,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  };
}

function parseJsonBody(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function extractPackageIdFromPath(path: string): string | null {
  const match = /^\/v1\/runtime\/status\/([^/]+)$/.exec(path);
  return match?.[1] ?? null;
}

export function createDaemonHttpApp(dependencies: DaemonHttpAppDependencies) {
  return {
    async handle(method: string, path: string, rawBody: string): Promise<HttpResult> {
      // Health
      if (method === 'GET' && (path === '/health' || path === '/healthz')) {
        return json(200, { status: 'ok' });
      }

      // Readiness
      if (method === 'GET' && (path === '/ready' || path === '/readyz')) {
        const probe = await dependencies.readinessProbe();
        return json(probe.ok ? 200 : 503, probe);
      }

      // Start / Verify (aliases)
      if (method === 'POST' && (path === '/v1/runtime/start' || path === '/v1/runtime/verify')) {
        const parsed = parseJsonBody(rawBody);
        if (!parsed.ok) {
          return json(400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
        }

        const request = parsed.value as RuntimeStartRequest;

        try {
          const result = await dependencies.pipeline.run(request);
          return json(200, result);
        } catch (error) {
          return json(500, {
            error: 'pipeline_error',
            message: error instanceof Error ? error.message : 'unknown'
          });
        }
      }

      // Stop
      if (method === 'POST' && path === '/v1/runtime/stop') {
        const parsed = parseJsonBody(rawBody);
        if (!parsed.ok) {
          return json(400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
        }

        const body = parsed.value as { package_id?: string };
        if (!body.package_id) {
          return json(400, { error: 'missing_package_id' });
        }

        const result = await dependencies.processRegistry.stop(body.package_id);
        return json(200, result);
      }

      // Status
      if (method === 'GET') {
        const packageId = extractPackageIdFromPath(path);
        if (packageId) {
          const status = dependencies.processRegistry.getStatus(packageId);
          if (!status) {
            return json(404, { error: 'not_found', package_id: packageId });
          }
          return json(200, status);
        }
      }

      return json(404, { error: 'not_found', path });
    }
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/runtime-daemon/tests/daemon-http-app.test.ts --reporter=verbose`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add apps/runtime-daemon/src/daemon-http-app.ts apps/runtime-daemon/tests/daemon-http-app.test.ts
git commit -m "feat(runtime-daemon): add daemon HTTP app with routing for start/verify/stop/status/health"
```

---

### Task 6: Daemon entry point and process lifecycle

**Files:**
- Create: `apps/runtime-daemon/src/daemon-main.ts`
- Create: `apps/runtime-daemon/tests/daemon-shutdown.test.ts`
- Modify: `apps/runtime-daemon/package.json`

**Step 1: Write the shutdown test**

Create `apps/runtime-daemon/tests/daemon-shutdown.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createProcessRegistry } from '../src/daemon-main.js';

describe('process registry', () => {
  it('tracks and stops supervised processes', async () => {
    const registry = createProcessRegistry();

    const killed: string[] = [];
    registry.register('pkg-1', {
      kill() { killed.push('pkg-1'); }
    });
    registry.register('pkg-2', {
      kill() { killed.push('pkg-2'); }
    });

    expect(registry.getStatus('pkg-1')).toMatchObject({ package_id: 'pkg-1', state: 'running' });
    expect(registry.getStatus('unknown')).toBeNull();

    await registry.stop('pkg-1');
    expect(killed).toEqual(['pkg-1']);
    expect(registry.getStatus('pkg-1')).toBeNull();

    await registry.shutdownAll();
    expect(killed).toEqual(['pkg-1', 'pkg-2']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run apps/runtime-daemon/tests/daemon-shutdown.test.ts --reporter=verbose`
Expected: FAIL — module not found.

**Step 3: Implement the daemon entry point**

Create `apps/runtime-daemon/src/daemon-main.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { evaluatePolicyPreflight } from '@forge/policy-engine';
import { createRuntimeDaemonBootstrap } from './runtime-bootstrap.js';
import { createStdioProcessLauncher } from './stdio-process-launcher.js';
import { createHttpProbeClient } from './http-probe-client.js';
import { createDaemonHttpApp } from './daemon-http-app.js';
import { validateDaemonStartupEnv } from './daemon-env-validation.js';
import { resolveRuntimeFeatureFlagsFromEnv } from './daemon-feature-flags.js';
import {
  createRuntimeRemoteResolverFromEnv,
  createSecretRefResolverFromEnv,
  createSecretRefResolver,
  createRuntimeOAuthTokenClientFromEnv
} from './daemon-remote-config.js';

export interface KillableProcess {
  kill(): void;
}

export function createProcessRegistry() {
  const processes = new Map<string, KillableProcess>();

  return {
    register(packageId: string, process: KillableProcess) {
      processes.set(packageId, process);
    },

    getStatus(packageId: string): { package_id: string; state: string } | null {
      if (!processes.has(packageId)) {
        return null;
      }
      return { package_id: packageId, state: 'running' };
    },

    async stop(packageId: string): Promise<{ ok: boolean }> {
      const proc = processes.get(packageId);
      if (!proc) {
        return { ok: false };
      }
      proc.kill();
      processes.delete(packageId);
      return { ok: true };
    },

    async shutdownAll(): Promise<void> {
      for (const [id, proc] of processes) {
        proc.kill();
        processes.delete(id);
      }
    },

    get size() {
      return processes.size;
    }
  };
}

function structuredLog(event_name: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({
    event_name,
    occurred_at: new Date().toISOString(),
    payload
  }));
}

async function main(): Promise<void> {
  const envValidation = validateDaemonStartupEnv(process.env);
  if (!envValidation.ok) {
    structuredLog('daemon.startup_validation_failed', { errors: envValidation.errors });
    process.exit(1);
  }

  const port = envValidation.port;

  const logger = {
    log(event: { event_name: string; occurred_at: string; payload: Record<string, unknown> }) {
      console.log(JSON.stringify(event));
    }
  };

  const featureFlags = resolveRuntimeFeatureFlagsFromEnv({ env: process.env });
  const processLauncher = createStdioProcessLauncher({ logger });
  const probeClient = createHttpProbeClient({ logger });
  const processRegistry = createProcessRegistry();

  const bootstrap = createRuntimeDaemonBootstrap({
    featureFlags,
    policyClient: {
      async preflight(input) {
        return evaluatePolicyPreflight(input);
      }
    },
    localSupervisorLauncher: processLauncher,
    remoteResolver: createRuntimeRemoteResolverFromEnv(process.env),
    secretResolver: createSecretRefResolver({
      fallback: createSecretRefResolverFromEnv(process.env)
    }),
    remoteProbeClient: probeClient,
    oauthTokenClient: createRuntimeOAuthTokenClientFromEnv(logger),
    logger
  });

  let ready = false;

  const app = createDaemonHttpApp({
    pipeline: {
      async run(request) {
        const result = await bootstrap.run(request);
        // Track launched processes for lifecycle management
        if (result.ready && request.mode === 'local') {
          const child = processLauncher.getProcess(request.package_id);
          if (child) {
            processRegistry.register(request.package_id, { kill: () => child.kill('SIGTERM') });
          }
        }
        return result;
      }
    },
    processRegistry,
    readinessProbe: async () => ({ ok: ready, details: ready ? ['ready'] : ['initializing'] })
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const path = url.split('?')[0];

    let rawBody = '';
    if (method === 'POST') {
      rawBody = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
    }

    const result = await app.handle(method, path!, rawBody);
    res.writeHead(result.status, result.headers ?? { 'Content-Type': 'application/json' });
    res.end(result.body);
  });

  server.listen(port, '0.0.0.0', () => {
    ready = true;
    structuredLog('daemon.started', { host: '0.0.0.0', port });
  });

  const close = async (signal: 'SIGINT' | 'SIGTERM') => {
    structuredLog('daemon.shutting_down', { signal, supervised_processes: processRegistry.size });

    await processRegistry.shutdownAll();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    structuredLog('daemon.stopped', { signal });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', () => { void close('SIGINT'); });
  process.on('SIGTERM', () => { void close('SIGTERM'); });
}

void main();
```

**Step 4: Run shutdown test to verify it passes**

Run: `npx vitest run apps/runtime-daemon/tests/daemon-shutdown.test.ts --reporter=verbose`
Expected: PASS.

**Step 5: Move runtime-remote-config and feature-flags into daemon**

Copy `apps/control-plane/src/runtime-remote-config.ts` to `apps/runtime-daemon/src/daemon-remote-config.ts`. Update its imports to use local paths instead of `@forge/runtime-daemon/...` (since it's now inside the daemon package):

- Change `from '@forge/runtime-daemon/oauth-token-client'` to `from './oauth-token-client.js'`
- Change `from '@forge/runtime-daemon/remote-connectors'` to `from './remote-connectors.js'`

Copy `apps/control-plane/src/runtime-feature-flags.ts` to `apps/runtime-daemon/src/daemon-feature-flags.ts`. No import changes needed (it only imports from `@forge/shared-contracts`).

Add exports to `apps/runtime-daemon/package.json`:

```json
"./daemon-remote-config": {
  "types": "./src/daemon-remote-config.ts",
  "default": "./dist/daemon-remote-config.js"
},
"./daemon-feature-flags": {
  "types": "./src/daemon-feature-flags.ts",
  "default": "./dist/daemon-feature-flags.js"
}
```

**Step 6: Update package.json scripts**

In `apps/runtime-daemon/package.json`, add:

```json
"start": "node dist/daemon-main.js"
```

And add `"./daemon-main"` export:

```json
"./daemon-main": {
  "types": "./src/daemon-main.ts",
  "default": "./dist/daemon-main.js"
}
```

**Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: Clean.

**Step 8: Commit**

```bash
git add apps/runtime-daemon/src/daemon-main.ts apps/runtime-daemon/src/daemon-remote-config.ts apps/runtime-daemon/src/daemon-feature-flags.ts apps/runtime-daemon/tests/daemon-shutdown.test.ts apps/runtime-daemon/package.json
git commit -m "feat(runtime-daemon): add standalone daemon entry point with signal handling and process registry"
```

---

### Task 7: Control-plane HTTP client for daemon

**Files:**
- Create: `apps/control-plane/src/runtime-daemon-client.ts`
- Create: `apps/control-plane/tests/runtime-daemon-client.test.ts`

**Step 1: Write the failing tests**

Create `apps/control-plane/tests/runtime-daemon-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createRuntimeDaemonClient } from '../src/runtime-daemon-client.js';
import type { RuntimePipelineResult } from '@forge/runtime-daemon';

function mockPipelineResult(): RuntimePipelineResult {
  return {
    ready: true,
    failure_reason_code: null,
    final_trust_state: 'trusted',
    policy: {
      outcome: 'allowed',
      install_allowed: true,
      runtime_allowed: true,
      reason_code: null,
      warnings: [],
      policy_blocked: false,
      blocked_by: 'none'
    },
    scope_resolution: {
      ordered_writable_scopes: [],
      blocked_scopes: []
    },
    stages: [
      { stage: 'policy_preflight', ok: true, details: ['allowed'] }
    ]
  };
}

function buildRequest() {
  return {
    package_id: 'pkg-1',
    package_slug: 'acme/pkg-1',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-1',
      requested_permissions: [],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-1'],
        block_flagged: false,
        permission_caps: { maxPermissions: 3, disallowedPermissions: [] }
      },
      enforcement: {
        package_id: 'pkg-1',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-03-01T00:00:00Z'
      }
    }
  };
}

describe('runtime daemon client', () => {
  it('posts to daemon and returns pipeline result', async () => {
    const expected = mockPipelineResult();
    let capturedUrl = '';
    let capturedBody = '';

    const client = createRuntimeDaemonClient({
      daemonUrl: 'http://localhost:4100',
      fetchImpl: async (input, init) => {
        capturedUrl = input as string;
        capturedBody = init?.body as string;
        return new Response(JSON.stringify(expected), { status: 200 });
      }
    });

    const result = await client.run(buildRequest());

    expect(capturedUrl).toBe('http://localhost:4100/v1/runtime/verify');
    expect(JSON.parse(capturedBody).package_id).toBe('pkg-1');
    expect(result.ready).toBe(true);
    expect(result.stages).toHaveLength(1);
  });

  it('returns synthetic failure on non-2xx response', async () => {
    const client = createRuntimeDaemonClient({
      daemonUrl: 'http://localhost:4100',
      fetchImpl: async () => new Response('error', { status: 502 })
    });

    const result = await client.run(buildRequest());
    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('health_validate_failed');
    expect(result.stages[0]!.details[0]).toContain('daemon_unreachable');
  });

  it('returns synthetic failure on network error', async () => {
    const client = createRuntimeDaemonClient({
      daemonUrl: 'http://localhost:4100',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); }
    });

    const result = await client.run(buildRequest());
    expect(result.ready).toBe(false);
    expect(result.stages[0]!.details[0]).toContain('ECONNREFUSED');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/control-plane/tests/runtime-daemon-client.test.ts --reporter=verbose`
Expected: FAIL — module not found.

**Step 3: Implement the HTTP client**

Create `apps/control-plane/src/runtime-daemon-client.ts`:

```typescript
import type { RuntimePipelineResult, RuntimeStartRequest } from '@forge/runtime-daemon';
import type { InstallRuntimeVerifier } from './install-lifecycle.js';

export interface RuntimeDaemonClientOptions {
  daemonUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function syntheticFailure(details: string): RuntimePipelineResult {
  return {
    ready: false,
    failure_reason_code: 'health_validate_failed',
    final_trust_state: 'untrusted',
    policy: {
      outcome: 'allowed',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: null,
      warnings: [],
      policy_blocked: false,
      blocked_by: 'none'
    },
    scope_resolution: {
      ordered_writable_scopes: [],
      blocked_scopes: []
    },
    stages: [
      {
        stage: 'health_validate',
        ok: false,
        details: [details]
      }
    ]
  };
}

export function createRuntimeDaemonClient(
  options: RuntimeDaemonClientOptions
): Pick<InstallRuntimeVerifier, 'run'> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async run(request: RuntimeStartRequest): Promise<RuntimePipelineResult> {
      const url = `${options.daemonUrl}/v1/runtime/verify`;

      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          return syntheticFailure(`daemon_unreachable:status=${response.status}`);
        }

        const result = (await response.json()) as RuntimePipelineResult;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        return syntheticFailure(`daemon_unreachable:${message}`);
      }
    }
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/control-plane/tests/runtime-daemon-client.test.ts --reporter=verbose`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add apps/control-plane/src/runtime-daemon-client.ts apps/control-plane/tests/runtime-daemon-client.test.ts
git commit -m "feat(control-plane): add HTTP client for runtime daemon communication"
```

---

### Task 8: Rewire control-plane to use daemon client

**Files:**
- Modify: `apps/control-plane/src/http-app.ts:34,41-48,59,185-189,1199-1268`

**Step 1: Update the `ForgeHttpAppPostgresDependencies` interface**

In `apps/control-plane/src/http-app.ts`:

- Remove the import of `createRuntimeDaemonBootstrap` (line 34)
- Remove imports from `./runtime-remote-config.js` (lines 42-48)
- Remove `import type { SecretRefResolver } from '@forge/runtime-daemon/remote-connectors'` (line 59)
- Add import: `import { createRuntimeDaemonClient } from './runtime-daemon-client.js';`
- In `ForgeHttpAppPostgresDependencies` interface, remove `secretResolver` (line 188) and `featureFlagEnv` (line 187), add `daemonUrl?: string`

**Step 2: Replace inline bootstrap wiring with daemon client fallback**

Replace lines 1199-1268 (the `runtimeVerifier` construction block) with:

```typescript
  const runtimeVerifier: InstallRuntimeVerifier =
    dependencies.runtimeVerifier ??
    (() => {
      const daemonUrl = dependencies.daemonUrl ?? process.env.FORGE_RUNTIME_DAEMON_URL;

      if (daemonUrl) {
        const daemonClient = createRuntimeDaemonClient({ daemonUrl });
        return {
          async run(request) {
            return daemonClient.run(request);
          },
          async writeScopeSidecarGuarded(request) {
            // Sidecar writes stay local — they are filesystem operations on the control-plane host
            const { createHash } = await import('node:crypto');
            const checksum = createHash('sha256')
              .update(
                JSON.stringify({
                  package_id: request.record.package_id,
                  package_slug: request.record.package_slug,
                  plan_id: request.record.plan_id,
                  scope_path: request.record.scope_path
                })
              )
              .digest('hex');

            const { writeScopeSidecar } = await import('@forge/runtime-daemon/scope-sidecar');
            const result = await writeScopeSidecar(request.scope_hash, {
              managed_by: 'control-plane',
              client: 'vscode_copilot',
              scope_path: request.record.scope_path,
              entry_keys: [request.record.package_id, request.record.plan_id, request.record.scope],
              checksum,
              last_applied_at: request.record.applied_at
            }, {
              ...(request.options?.baseDir ? { baseDir: request.options.baseDir } : {}),
              owner: request.options?.owner ?? 'control-plane',
              allowMerge: request.options?.allowMerge ?? true
            });

            return {
              ok: true,
              reason_code: null,
              ...result
            };
          }
        } satisfies InstallRuntimeVerifier;
      }

      // Fallback: in-process bootstrap (no daemon URL configured)
      const { resolveRuntimeFeatureFlagsFromEnv } = await import('./runtime-feature-flags.js');
      const { createRuntimeDaemonBootstrap } = await import('@forge/runtime-daemon/runtime-bootstrap');
      const featureFlags = resolveRuntimeFeatureFlagsFromEnv();

      const runtimeLogger = {
        log(event: { event_name: string; occurred_at: string; payload: Record<string, unknown> }) {
          console.log(JSON.stringify(event));
        }
      };

      const bootstrap = createRuntimeDaemonBootstrap({
        featureFlags,
        policyClient: {
          async preflight(input) {
            return evaluatePolicyPreflight(input);
          }
        },
        logger: runtimeLogger
      });

      return {
        async run(request) {
          return bootstrap.run(request);
        },
        async writeScopeSidecarGuarded(request) {
          const checksum = createHash('sha256')
            .update(
              JSON.stringify({
                package_id: request.record.package_id,
                package_slug: request.record.package_slug,
                plan_id: request.record.plan_id,
                scope_path: request.record.scope_path
              })
            )
            .digest('hex');

          return bootstrap.writeScopeSidecarGuarded({
            scope_hash: request.scope_hash,
            scope_daemon_owned: request.scope_daemon_owned,
            record: {
              managed_by: 'control-plane',
              client: 'vscode_copilot',
              scope_path: request.record.scope_path,
              entry_keys: [request.record.package_id, request.record.plan_id, request.record.scope],
              checksum,
              last_applied_at: request.record.applied_at
            },
            options: {
              ...(request.options?.baseDir ? { baseDir: request.options.baseDir } : {}),
              owner: request.options?.owner ?? 'control-plane',
              allowMerge: request.options?.allowMerge ?? true
            }
          });
        }
      } satisfies InstallRuntimeVerifier;
    })();
```

Note: The `createHash` import at the top of the file (line 1) is already present. The fallback path preserves backward compatibility when `FORGE_RUNTIME_DAEMON_URL` is not set.

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Clean.

**Step 4: Run all control-plane tests**

Run: `npx vitest run apps/control-plane/tests --reporter=verbose`
Expected: All existing tests pass (they inject `runtimeVerifier` directly, bypassing the default wiring).

**Step 5: Commit**

```bash
git add apps/control-plane/src/http-app.ts
git commit -m "feat(control-plane): rewire runtime verifier to use daemon HTTP client when FORGE_RUNTIME_DAEMON_URL is set"
```

---

### Task 9: Delete migrated control-plane runtime config

**Files:**
- Delete: `apps/control-plane/src/runtime-remote-config.ts`
- Delete: `apps/control-plane/tests/runtime-remote-config.test.ts`
- Modify: `apps/control-plane/src/startup-env-validation.ts:1` (remove import of `RuntimeRemoteConfigEnv`)

**Step 1: Check for remaining imports of runtime-remote-config**

Run: `grep -rn "runtime-remote-config" apps/control-plane/src/`

If `http-app.ts` still imports it, remove those import lines (should already be removed in Task 8). If `startup-env-validation.ts` imports `RuntimeRemoteConfigEnv`, replace the type with `Record<string, string | undefined>`.

**Step 2: Delete the files**

```bash
rm apps/control-plane/src/runtime-remote-config.ts
rm apps/control-plane/tests/runtime-remote-config.test.ts
```

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run apps/control-plane/tests --reporter=verbose`
Expected: Clean and all tests pass.

**Step 4: Commit**

```bash
git add -u apps/control-plane/src/runtime-remote-config.ts apps/control-plane/tests/runtime-remote-config.test.ts apps/control-plane/src/startup-env-validation.ts
git commit -m "refactor(control-plane): remove runtime-remote-config, now owned by daemon"
```

---

### Task 10: Update docker-compose and e2e test

**Files:**
- Modify: `docker-compose.yml`
- Modify: `tests/e2e/install-runtime-local.e2e.test.ts`

**Step 1: Add daemon service to docker-compose.yml**

Add after the `qdrant` service:

```yaml
  runtime-daemon:
    build:
      context: .
      dockerfile: apps/runtime-daemon/Dockerfile
    ports:
      - "4100:4100"
    environment:
      FORGE_DAEMON_PORT: "4100"
      FORGE_RUNTIME_LOCAL_SUPERVISOR_ENABLED: "true"
      FORGE_RUNTIME_SCOPE_SIDECAR_OWNERSHIP_ENABLED: "true"
    depends_on:
      - postgres
```

Note: We don't create the Dockerfile yet — this entry documents the intended deployment topology. For local dev, the daemon is started directly via `npm start`.

**Step 2: Update e2e test to exercise HTTP path**

In `tests/e2e/install-runtime-local.e2e.test.ts`, add a second test case that starts the daemon as a subprocess and verifies the HTTP flow. The existing test (in-process bootstrap) remains as a regression test:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';

// ... existing test stays unchanged ...

it('verifies runtime readiness through daemon HTTP endpoint', async () => {
  // This test requires the daemon to be built: npm run build -w apps/runtime-daemon
  const daemonBin = join(import.meta.dirname, '../../apps/runtime-daemon/dist/daemon-main.js');

  let daemon: ChildProcess | null = null;
  try {
    daemon = spawn('node', [daemonBin], {
      env: {
        ...process.env,
        FORGE_DAEMON_PORT: '4199',
        FORGE_RUNTIME_LOCAL_SUPERVISOR_ENABLED: 'true',
        FORGE_RUNTIME_SCOPE_SIDECAR_OWNERSHIP_ENABLED: 'true'
      },
      stdio: 'pipe'
    });

    // Wait for daemon to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('daemon startup timeout')), 5000);
      daemon!.stdout!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('daemon.started')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      daemon!.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Call daemon verify endpoint
    const response = await fetch('http://localhost:4199/v1/runtime/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_id: 'pkg-e2e-http',
        package_slug: 'acme/e2e-http',
        mode: 'local',
        transport: 'stdio',
        trust_state: 'trusted',
        trust_reset_trigger: 'none',
        scope_candidates: [],
        policy_input: {
          org_id: 'org-e2e',
          package_id: 'pkg-e2e-http',
          requested_permissions: [],
          org_policy: {
            mcp_enabled: true,
            server_allowlist: ['pkg-e2e-http'],
            block_flagged: false,
            permission_caps: { maxPermissions: 5, disallowedPermissions: [] }
          },
          enforcement: {
            package_id: 'pkg-e2e-http',
            state: 'none',
            reason_code: null,
            policy_blocked: false,
            source: 'none',
            updated_at: '2026-03-01T14:00:00Z'
          }
        },
        process_command: {
          command: 'node',
          args: [join(import.meta.dirname, '../../apps/runtime-daemon/tests/fixtures/echo-server.mjs')]
        }
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.ready).toBe(true);

    // Verify health endpoint
    const healthResponse = await fetch('http://localhost:4199/health');
    expect(healthResponse.ok).toBe(true);
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
    }
  }
});
```

**Step 3: Run existing e2e test (in-process path)**

Run: `npx vitest run tests/e2e/install-runtime-local.e2e.test.ts --reporter=verbose`
Expected: The existing in-process test still passes. The HTTP test may skip if the daemon isn't built yet.

**Step 4: Commit**

```bash
git add docker-compose.yml tests/e2e/install-runtime-local.e2e.test.ts
git commit -m "feat: add daemon to docker-compose and e2e test for HTTP runtime verification"
```

---

### Task 11: Full integration verification

**Step 1: Build all workspaces**

Run: `npm run build --workspaces`
Expected: Clean build across all packages and apps.

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Clean.

**Step 3: Run all workspace tests**

Run: `npm run test:workspaces`
Expected: All tests pass.

**Step 4: Run e2e tests**

Run: `npm run test:e2e-local`
Expected: All e2e tests pass.

**Step 5: Run the full check suite**

Run: `npm run check`
Expected: Governance check, typecheck, and tests all pass.

**Step 6: Commit any fixups**

If any tests needed adjustment, commit the fixes:

```bash
git add -A
git commit -m "fix: integration fixups for runtime daemon standalone"
```
