# Runtime Preflight and Adapter Contracts Runbook

## Scope
Operational guide for runtime start-order enforcement with env-driven feature flags, remote connector auth/secret resolution, OAuth token exchange, and scope-sidecar ownership protection.

## v1 Adapter Scope Lock
1. GA adapter scope is explicitly locked to `vscode_copilot` + `local` + `stdio`.
2. Remote transports (`sse`, `streamable-http`) remain `planned` (see `docs/compatibility-matrix.md`).
3. Any GA scope expansion requires compatibility-matrix update, decision-log entry, and contract/e2e/integration-db evidence.

## Components
1. Policy preflight contract: `packages/policy-engine/src/index.ts`
2. Runtime pipeline contract: `apps/runtime-daemon/src/index.ts`
3. Runtime bootstrap composition: `apps/runtime-daemon/src/runtime-bootstrap.ts`
4. Remote connectors + deterministic reason codes: `apps/runtime-daemon/src/remote-connectors.ts`
5. OAuth token exchange/cache: `apps/runtime-daemon/src/oauth-token-client.ts`
6. Control-plane runtime flag loader: `apps/control-plane/src/runtime-feature-flags.ts`
7. Control-plane remote config wiring + secret resolver abstraction: `apps/control-plane/src/runtime-remote-config.ts`
8. Control-plane startup env matrix validation: `apps/control-plane/src/startup-env-validation.ts`
9. Control-plane lifecycle orchestration: `apps/control-plane/src/install-lifecycle.ts`

## Runtime order invariant
1. `policy_preflight`
2. `trust_gate`
3. `preflight_checks`
4. `start_or_connect`
5. `health_validate`
6. `supervise`

## Runtime failure taxonomy (standard output contract)
1. `policy_preflight_blocked` / `trust_gate_blocked`
2. `scope_not_found`
3. `adapter_write_failed` / `adapter_remove_failed` / `adapter_<adapter_specific>`
4. `preflight_checks_failed`
5. `start_or_connect_failed`
6. `remote_sse_hook_missing`
7. `remote_streamable_http_hook_missing`
8. `remote_sse_probe_failed`
9. `remote_streamable_http_probe_failed`
10. `health_validate_failed`
11. `supervise_failed`

## Feature-flag env controls
1. `FORGE_RUNTIME_LOCAL_SUPERVISOR_ENABLED`
2. `FORGE_RUNTIME_REMOTE_SSE_ENABLED`
3. `FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED`
4. `FORGE_RUNTIME_SCOPE_SIDECAR_OWNERSHIP_ENABLED`
5. `FORGE_RUNTIME_HARDCODED_VSCODE_PROFILE_PATH`

Accepted boolean values: `1,true,yes,on,0,false,no,off`.

## Remote auth env controls
1. `FORGE_RUNTIME_REMOTE_SSE_URL`
2. `FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL`
3. `FORGE_RUNTIME_REMOTE_AUTH_TYPE` (`api-key` | `bearer` | `oauth2_client_credentials`)
4. `FORGE_RUNTIME_REMOTE_SECRET_REF`
5. `FORGE_RUNTIME_REMOTE_AUTH_HEADER_NAME` (optional, `api-key` mode)
6. `FORGE_RUNTIME_SECRET_REFS_JSON` (JSON object mapping `secret_ref -> secret payload`)

Secret resolution order:
1. primary resolver (if injected)
2. env-map fallback (`FORGE_RUNTIME_SECRET_REFS_JSON`)

## Symptom -> cause -> fix
1. `runtime_feature_flag_invalid:*`
   - Cause: unsupported boolean env literal.
   - Fix: set one of `1,true,yes,on,0,false,no,off`.
2. `remote_auth_failed:secret_ref_not_found`
   - Cause: configured `secret_ref` missing from `FORGE_RUNTIME_SECRET_REFS_JSON`.
   - Fix: add mapping in secret-ref JSON and retry.
3. `remote_auth_failed:oauth_token_exchange_failed`
   - Cause: OAuth client-credentials exchange failed.
   - Fix: validate token endpoint, JSON secret payload fields (`token_url`,`client_id`,`client_secret`), and downstream auth status.
4. `remote_sse_hook_missing` / `remote_streamable_http_hook_missing`
   - Cause: corresponding feature flag disabled or remote wiring absent.
   - Fix: enable required runtime flag and ensure remote resolver/probe dependencies are configured.
5. `control_plane_env_invalid:*`
   - Cause: invalid startup env matrix (for example retrieval bootstrap enabled without required retrieval env).
   - Fix: correct env values according to `.env.example`, then restart control-plane.
6. oauth failure log contains `[REDACTED]` markers
   - Cause: secret-like fragments were detected and sanitized.
   - Fix: use correlation IDs + reason codes for triage; do not attempt to log plaintext secret payloads.

## Verification commands
1. `npm run --workspace @forge/control-plane test -- --run tests/runtime-feature-flags.test.ts`
2. `npm run --workspace @forge/control-plane test -- --run tests/runtime-remote-config.test.ts`
3. `npm run --workspace @forge/control-plane test -- --run tests/startup-env-validation.test.ts`
4. `npm run --workspace @forge/runtime-daemon test`
5. `npm run test:e2e-local`
