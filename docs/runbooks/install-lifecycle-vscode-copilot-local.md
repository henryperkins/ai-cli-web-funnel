# Install Lifecycle (VS Code Copilot Local) Runbook

## Scope
Operational guide for discover -> plan -> apply -> verify in `vscode_copilot` + `local` mode, including Wave 7 retrieval-sync and dead-letter recovery hardening.

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
3. Apply:
   - `POST /v1/install/plans/:plan_id/apply`
4. Verify:
   - `POST /v1/install/plans/:plan_id/verify`

## Idempotency contract
1. `POST:/v1/install/plans`
2. `POST:/v1/install/plans/:id/apply`
3. `POST:/v1/install/plans/:id/verify`

Invariant:
1. same key + same hash => replay
2. same key + different hash => conflict

## Correlation continuity contract
1. `createPlan`: correlation defaults to `plan_id` when request header is absent.
2. `applyPlan` and `verifyPlan`: correlation falls back to persisted plan correlation, then `plan_id`.
3. audit rows and outbox payloads share the same effective correlation ID.

## Preflight
1. Apply migrations `001..011`.
2. Set DB env: `FORGE_DATABASE_URL` (or `DATABASE_URL`).
3. If retrieval is required, set:
   - `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true`
   - retrieval env vars from semantic runbook.
4. Keep governance statuses unchanged (Open/Proposed remain unchanged unless separately approved).

## Operator commands
1. Catalog ingest dry-run:
   - `npm run run:catalog-ingest -- --mode dry-run --input <path-to-json>`
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

## Validation commands
1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`
7. `npm run run:retrieval-sync -- --mode dry-run --limit 25`
8. `npm run run:outbox-dead-letter -- --action list --limit 25`
