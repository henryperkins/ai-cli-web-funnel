# Runtime Daemon Standalone Process Design

**Date:** 2026-03-08
**Status:** Approved
**Goal:** Close portfolio gaps by making the runtime daemon a production-ready standalone process with concrete implementations for process launching and remote probing.

## Context

The portfolio describes "control-plane plus runtime daemon" as two separate concerns. In reality, the daemon exists as a library (`@forge/runtime-daemon`) consumed in-process by the control-plane. Three gaps exist:

1. **No daemon entry point** — no `daemon-main.ts` or runnable process.
2. **No concrete process launcher** — `LocalSupervisorProcessLauncher` is an interface with only test stubs.
3. **No concrete remote probe client** — `RemoteProbeClient` is an interface with only test stubs.

Additionally, the control-plane contains runtime wiring (`runtime-remote-config.ts`) that belongs in the daemon.

## Design

### Daemon HTTP API

Raw `node:http` server (same pattern as control-plane). Default port from `FORGE_DAEMON_PORT` env var.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/runtime/start` | Execute the 7-stage pipeline for a package |
| `POST` | `/v1/runtime/verify` | Alias for start, used by control-plane verify step |
| `POST` | `/v1/runtime/stop` | Gracefully stop a supervised process by package_id |
| `GET` | `/v1/runtime/status/:package_id` | Current status of a supervised process |
| `GET` | `/health` | Liveness (always 200 if process running) |
| `GET` | `/ready` | Readiness (200 after startup; 503 during init or dependency failure) |

Request body for `/start` and `/verify` extends `RuntimeStartRequest`:

```typescript
interface DaemonStartRequest extends RuntimeStartRequest {
  process_command?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
}
```

Response body is `RuntimePipelineResult` as-is.

Supervised processes tracked in a `Map<string, SupervisedProcess>` for status queries and graceful shutdown.

### Concrete `child_process` Launcher

New file: `apps/runtime-daemon/src/stdio-process-launcher.ts`

Implements `LocalSupervisorProcessLauncher`:

- `launch()` calls `child_process.spawn(command, args, { env, cwd, stdio: 'pipe' })` using `process_command` from the request.
- Returns `LocalSupervisorProcessHandle`:
  - `waitForExit()` wraps child `exit` event in a Promise, resolves with `{ code, signal }`.
  - `healthCheck()` sends an MCP initialize request over stdin/stdout and waits for a valid response within a configurable timeout (default 5000ms).
- Stderr captured and forwarded to structured logger.
- On spawn failure (ENOENT, EACCES), returns a handle whose `healthCheck()` returns `false` and `waitForExit()` resolves with `code: 1`. No thrown exceptions.
- Each launched process registered in the daemon's supervised process map.

```typescript
interface StdioProcessLauncherOptions {
  logger?: RuntimeBootstrapLogger;
  defaultTimeoutMs?: number;
}
```

### Concrete `RemoteProbeClient`

New file: `apps/runtime-daemon/src/http-probe-client.ts`

- `probeSse(url, headers)` — GET with `Accept: text/event-stream`. Success if 2xx and correct content-type. Aborts via `AbortSignal.timeout()` (default 5000ms).
- `probeStreamableHttp(url, headers)` — POST with empty MCP JSON-RPC initialize body and `Accept: application/json, text/event-stream`. Success if 2xx.
- Network errors return `{ ok: false, details: error.message }`. No thrown exceptions.

```typescript
interface HttpProbeClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: RuntimeBootstrapLogger;
}
```

### Daemon Entry Point

New file: `apps/runtime-daemon/src/daemon-main.ts`

**Startup sequence:**
1. Validate required env vars.
2. Resolve feature flags from env.
3. Construct dependencies: policy client, stdio process launcher, remote resolver, secret resolver, HTTP probe client, OAuth token client.
4. Create `RuntimeDaemonBootstrap`.
5. Create HTTP app, bind to port.
6. Log structured startup message.

**Signal handling:**
- SIGINT/SIGTERM trigger graceful shutdown.
- Stop accepting requests, SIGTERM all supervised child processes, wait up to 10s, SIGKILL stragglers, close HTTP server, exit.

**Structured logging:**
- JSON to stdout: `{ event_name, occurred_at, payload }`.
- Events: startup, shutdown, process launch/crash/restart, health transitions, incoming requests.

### Control-Plane HTTP Client

New file: `apps/control-plane/src/runtime-daemon-client.ts`

Implements `InstallRuntimeVerifier`:

```typescript
interface RuntimeDaemonClientOptions {
  daemonUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
```

- `run(request)` — POSTs to `${daemonUrl}/v1/runtime/verify`. Deserializes `RuntimePipelineResult`. On failure, returns synthetic result with `ready: false`.
- `writeScopeSidecarGuarded(request)` — Stays local in the control-plane (filesystem operations on the control-plane host for VS Code paths).

**Wiring in `http-app.ts`:**
- `FORGE_RUNTIME_DAEMON_URL` set → use HTTP client.
- Not set → fall back to in-process `createRuntimeDaemonBootstrap` (backward compatible for local dev).

### Responsibility Migration

Runtime wiring factories (`createFetchBackedRemoteProbeClient`, `createRuntimeRemoteResolverFromEnv`, `createSecretRefResolverFromEnv`, `createRuntimeOAuthTokenClientFromEnv`) move from control-plane to daemon. The control-plane's only runtime dependency becomes `FORGE_RUNTIME_DAEMON_URL`.

## File Inventory

### New files (daemon)

| File | Purpose |
|---|---|
| `apps/runtime-daemon/src/daemon-main.ts` | Process entry point |
| `apps/runtime-daemon/src/daemon-http-app.ts` | HTTP routing |
| `apps/runtime-daemon/src/stdio-process-launcher.ts` | `child_process.spawn` launcher |
| `apps/runtime-daemon/src/http-probe-client.ts` | `fetch`-based probe client |
| `apps/runtime-daemon/src/daemon-env-validation.ts` | Env var validation |
| `apps/runtime-daemon/tests/stdio-process-launcher.test.ts` | |
| `apps/runtime-daemon/tests/http-probe-client.test.ts` | |
| `apps/runtime-daemon/tests/daemon-http-app.test.ts` | |
| `apps/runtime-daemon/tests/daemon-shutdown.test.ts` | |

### New files (control-plane)

| File | Purpose |
|---|---|
| `apps/control-plane/src/runtime-daemon-client.ts` | HTTP client for daemon |
| `apps/control-plane/tests/runtime-daemon-client.test.ts` | |

### Modified files

| File | Change |
|---|---|
| `apps/runtime-daemon/package.json` | Add `"start"` script, `"./daemon-main"` export |
| `apps/runtime-daemon/src/index.ts` | Add `process_command` to `RuntimeStartRequest` |
| `apps/control-plane/src/http-app.ts` | Replace inline bootstrap wiring with daemon URL check |
| `docker-compose.yml` | Add `runtime-daemon` service |
| `tests/e2e/install-runtime-local.e2e.test.ts` | Exercise the HTTP path |

### Deleted files

| File | Reason |
|---|---|
| `apps/control-plane/src/runtime-remote-config.ts` | Replaced by daemon-owned wiring + HTTP client |
| `apps/control-plane/tests/runtime-remote-config.test.ts` | Tests move to daemon |

## Testing Strategy

**Daemon unit tests:** Stdio launcher (real subprocess against trivial Node script), HTTP probe client (injected fetch fakes), HTTP app routing (in-memory bootstrap), shutdown behavior.

**Control-plane unit tests:** HTTP client (injected fetch fakes) — correct body, response deserialization, error handling.

**E2E:** Updated `install-runtime-local.e2e.test.ts` starts daemon as real subprocess, runs full lifecycle through HTTP client.

**No new integration-db tests** — daemon does not touch the database.

## Type Changes

```typescript
// Addition to RuntimeStartRequest in apps/runtime-daemon/src/index.ts
export interface RuntimeStartRequest {
  // ... existing fields ...
  process_command?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
}
```

No breaking changes to existing types. The `process_command` field is optional.
