# Install Lifecycle (VS Code Copilot Local) Runbook

## Scope
Operational guide for discover -> plan -> apply/update/remove/rollback -> verify in `vscode_copilot` + `local` mode, including replay-safe idempotency, outbox continuity, and remove/rollback recovery hardening.

## Components
1. Catalog ingest + persistence:
   - `packages/catalog/src/index.ts`
   - `packages/catalog/src/postgres-adapters.ts`
   - `scripts/run-catalog-ingest.mjs`
2. Control-plane routes/lifecycle/runtime wiring:
   - `apps/control-plane/src/http-app.ts`
   - `apps/control-plane/src/catalog-routes.ts`
   - `apps/control-plane/src/install-lifecycle.ts`
   - `apps/control-plane/src/server.ts`
   - `apps/control-plane/src/retrieval-bootstrap.ts`
3. Filesystem-backed adapter:
   - `apps/copilot-vscode-adapter/src/index.ts`
4. Persistence migrations:
   - `infra/postgres/migrations/009_install_lifecycle_foundations.sql`
   - `infra/postgres/migrations/014_install_lifecycle_remove_rollback_states.sql`
   - `infra/postgres/migrations/010_outbox_internal_dispatch_runs.sql`
   - `infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql`
5. Outbox processing:
   - `scripts/run-outbox-processor.mjs`
   - `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`
6. Retrieval sync and dead-letter tooling:
   - `scripts/run-retrieval-sync.mjs`
   - `scripts/run-outbox-dead-letter-replay.mjs`

## Endpoints
1. Discover:
   - `GET /v1/packages`
   - `GET /v1/packages/:package_id`
   - `POST /v1/packages/search`
2. Plan:
   - `POST /v1/install/plans`
   - `GET /v1/install/plans/:plan_id`
3. Apply/update/remove/rollback:
   - `POST /v1/install/plans/:plan_id/apply`
   - `POST /v1/install/plans/:plan_id/install` (alias)
   - `POST /v1/install/plans/:plan_id/update`
   - `POST /v1/install/plans/:plan_id/remove`
   - `POST /v1/install/plans/:plan_id/uninstall` (alias)
   - `POST /v1/install/plans/:plan_id/rollback`
4. Verify:
   - `POST /v1/install/plans/:plan_id/verify`

## Idempotency contract
1. `POST:/v1/install/plans`
2. `POST:/v1/install/plans/:id/apply`
3. `POST:/v1/install/plans/:id/update`
4. `POST:/v1/install/plans/:id/remove`
5. `POST:/v1/install/plans/:id/rollback`
6. `POST:/v1/install/plans/:id/verify`

Invariant:
1. same key + same hash => replay
2. same key + different hash => conflict

## Correlation continuity contract
1. `createPlan`: correlation defaults to `plan_id` when request header is absent.
2. `applyPlan` and `verifyPlan`: correlation falls back to persisted plan correlation, then `plan_id`.
3. audit rows and outbox payloads share the same effective correlation ID.

## Preflight
1. Apply migrations `001..015` (lifecycle state extension is in `014`).
2. Set DB env: `FORGE_DATABASE_URL` (or `DATABASE_URL`).
3. If retrieval is required, set:
   - `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true`
   - retrieval env vars from semantic runbook.
4. Keep governance statuses unchanged (Open/Proposed remain unchanged unless separately approved).

## Operator commands
1. Catalog ingest dry-run:
   - `npm run run:catalog-ingest -- --mode dry-run --input <path-to-json>`
   - Connector-mode examples:
     - `npm run run:catalog-ingest -- --mode dry-run --source github --input <github-fixture.json>`
     - `npm run run:catalog-ingest -- --mode dry-run --source npm --input <npm-packages.json>`
     - `npm run run:catalog-ingest -- --mode dry-run --source pypi --input <pypi-projects.json>`
2. Catalog ingest apply:
   - `npm run run:catalog-ingest -- --mode apply --input <path-to-json>`
3. Start control-plane:
   - `npm run run:control-plane`
4. Outbox dry-run:
   - `npm run run:outbox -- --mode dry-run --limit 25`
5. Outbox production with internal handlers:
   - `OUTBOX_INTERNAL_DISPATCH=true npm run run:outbox -- --mode production --limit 100`
6. Retrieval sync dry-run:
   - `npm run run:retrieval-sync -- --mode dry-run --limit 25`
7. Retrieval sync apply:
   - `npm run run:retrieval-sync -- --mode apply --limit 100`
8. List dead-letter jobs:
   - `npm run run:outbox-dead-letter -- --action list --limit 50`
9. Requeue dead-letter jobs (explicit confirm):
   - `npm run run:outbox-dead-letter -- --action requeue --event-type install.verify.failed --confirm true --reason operator_fix_applied`

## Readiness and failure signatures
1. `db_connectivity_failed:*`
2. `retrieval_bootstrap_failed:*`
3. `runtime_feature_flag_invalid:*`
4. `remote_auth_failed:secret_ref_not_found`
5. `remote_auth_failed:oauth_token_exchange_failed`
6. `scope_not_daemon_owned`
7. `scope_write_failed` / `scope_write_rolled_back`
8. `outbox.ranking_sync.failed`
9. `outbox.dead_letter.operation_failed`
10. `update_invalid_plan_state`
11. `remove_invalid_plan_state`
12. `remove_dependency_blocked`
13. `rollback_invalid_plan_state`
14. `rollback_source_attempt_missing`
15. `trust_gate_blocked`
16. `adapter_remove_failed`
17. `rollback_cleanup_ok` / `rollback_restore_ok`

## Operator procedures: remove and rollback
1. Remove happy path:
   - call `POST /v1/install/plans/:plan_id/remove` with `idempotency-key`.
   - expect `status=remove_succeeded` and outbox `install.remove.succeeded`.
2. Remove dependency-safe guard:
   - when package is still required by profiles, response returns `remove_dependency_blocked`.
   - resolve required references before retrying remove.
3. Rollback for failed update/apply:
   - call `POST /v1/install/plans/:plan_id/rollback`.
   - expected mode is `cleanup_partial_install`.
4. Rollback for failed remove:
   - expected mode is `restore_removed_entries`.
5. Replay/conflict guard:
   - same idempotency key + same payload => replay.
   - same idempotency key + different payload hash => conflict.

## Migration verification coverage for 014
1. Contract test:
   - `npx vitest run tests/contract/migration-wave10.contract.test.ts`
2. Integration-db coverage:
   - `npx vitest run tests/integration-db/catalog-and-lifecycle.integration-db.test.ts --maxWorkers=1`
   - `npm run test:integration-db:docker`

## Validation commands
1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`
7. `npm run run:retrieval-sync -- --mode dry-run --limit 25`
8. `npm run run:outbox-dead-letter -- --action list --limit 25`
