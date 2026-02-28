**1) What Was Implemented Per Step Number**
1. Step 1: Added deterministic catalog ingest domain service with identity resolution, merge precedence usage, field lineage, and conflict fingerprint generation (`@forge/catalog`).
2. Step 2: Added catalog Postgres adapters for `registry.packages`, `package_aliases`, `package_merge_runs`, `package_field_lineage`, and `package_identity_conflicts` with transactional, rerun-safe upserts.
3. Step 3: Added catalog API routes in control-plane for list/detail/search and wired ranking lineage metadata plus `semantic_fallback`.
4. Step 4: Added additive migration `009_install_lifecycle_foundations.sql` for lifecycle planning/audit/apply/verify persistence.
5. Step 5: Added install planner service and endpoints `POST /v1/install/plans` + `GET /v1/install/plans/:plan_id` with deterministic action planning and audit writes.
6. Step 6: Replaced in-memory VS Code Copilot adapter persistence with filesystem-backed atomic write + rollback behavior and ownership enforcement.
7. Step 7: Added apply execution endpoint `POST /v1/install/plans/:plan_id/apply` with persisted attempt status and outbox publication.
8. Step 8: Added verify execution endpoint `POST /v1/install/plans/:plan_id/verify` with persisted stage outcomes/readiness and deterministic reason codes.
9. Step 9: Added runnable control-plane server bootstrap + entrypoint with env config loading and fail-closed readiness checks.
10. Step 10: Added DB-backed reporter signature verifier semantics (`active`/`revoked`) and wired it into server bootstrap.
11. Step 11: Extended deterministic outbox dispatcher and processor support to lifecycle events (`install.plan.created`, `install.apply.*`, `install.verify.*`).
12. Step 12: Expanded integration-db/contract/e2e coverage for lifecycle paths and completed docs/governance closure updates.

**2) Exact Files Created/Updated**
- Apps (`apps/`)
  - Created: [apps/control-plane/src/catalog-routes.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/catalog-routes.ts)
  - Created: [apps/control-plane/src/install-lifecycle.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/install-lifecycle.ts)
  - Created: [apps/control-plane/src/server.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/server.ts)
  - Created: [apps/control-plane/src/server-main.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/server-main.ts)
  - Updated: [apps/control-plane/src/http-app.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/http-app.ts)
  - Updated: [apps/control-plane/src/index.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/index.ts)
  - Updated: [apps/control-plane/package.json](/home/azureuser/ai-cli-web-funnel/apps/control-plane/package.json)
  - Updated: [apps/control-plane/tests/http-app.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/http-app.test.ts)
  - Created: [apps/control-plane/tests/install-lifecycle.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/install-lifecycle.test.ts)
  - Created: [apps/control-plane/tests/server.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/server.test.ts)
  - Updated: [apps/copilot-vscode-adapter/src/index.ts](/home/azureuser/ai-cli-web-funnel/apps/copilot-vscode-adapter/src/index.ts)
  - Updated: [apps/copilot-vscode-adapter/tests/adapter-contract.test.ts](/home/azureuser/ai-cli-web-funnel/apps/copilot-vscode-adapter/tests/adapter-contract.test.ts)
- Packages (`packages/`)
  - Created: [packages/catalog/src/index.ts](/home/azureuser/ai-cli-web-funnel/packages/catalog/src/index.ts)
  - Created: [packages/catalog/src/postgres-adapters.ts](/home/azureuser/ai-cli-web-funnel/packages/catalog/src/postgres-adapters.ts)
  - Created: [packages/catalog/package.json](/home/azureuser/ai-cli-web-funnel/packages/catalog/package.json)
  - Created: [packages/catalog/tsconfig.json](/home/azureuser/ai-cli-web-funnel/packages/catalog/tsconfig.json)
  - Created: [packages/catalog/tests/ingest.test.ts](/home/azureuser/ai-cli-web-funnel/packages/catalog/tests/ingest.test.ts)
  - Created: [packages/catalog/tests/postgres-adapters.test.ts](/home/azureuser/ai-cli-web-funnel/packages/catalog/tests/postgres-adapters.test.ts)
  - Created: [packages/security-governance/src/outbox-dispatcher.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/outbox-dispatcher.ts)
  - Updated: [packages/security-governance/src/index.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/index.ts)
  - Created: [packages/security-governance/tests/outbox-dispatcher.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/outbox-dispatcher.test.ts)
- Migrations (`infra/postgres/migrations/`)
  - Created: [infra/postgres/migrations/009_install_lifecycle_foundations.sql](/home/azureuser/ai-cli-web-funnel/infra/postgres/migrations/009_install_lifecycle_foundations.sql)
- Scripts / root config
  - Updated: [scripts/run-outbox-processor.mjs](/home/azureuser/ai-cli-web-funnel/scripts/run-outbox-processor.mjs)
  - Updated: [package.json](/home/azureuser/ai-cli-web-funnel/package.json)
  - Updated: [package-lock.json](/home/azureuser/ai-cli-web-funnel/package-lock.json)
- Tests (`tests/`)
  - Created: [tests/integration-db/catalog-and-lifecycle.integration-db.test.ts](/home/azureuser/ai-cli-web-funnel/tests/integration-db/catalog-and-lifecycle.integration-db.test.ts)
  - Created: [tests/integration-db/outbox-dispatcher.integration-db.test.ts](/home/azureuser/ai-cli-web-funnel/tests/integration-db/outbox-dispatcher.integration-db.test.ts)
  - Created: [tests/e2e/install-runtime-local.e2e.test.ts](/home/azureuser/ai-cli-web-funnel/tests/e2e/install-runtime-local.e2e.test.ts)
  - Created: [tests/contract/migration-wave5.contract.test.ts](/home/azureuser/ai-cli-web-funnel/tests/contract/migration-wave5.contract.test.ts)
- Docs / governance
  - Updated: [README.md](/home/azureuser/ai-cli-web-funnel/README.md)
  - Updated: [DECISION_LOG.md](/home/azureuser/ai-cli-web-funnel/DECISION_LOG.md)
  - Updated: [docs/README.md](/home/azureuser/ai-cli-web-funnel/docs/README.md)
  - Updated: [docs/runbooks/README.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/README.md)
  - Created: [docs/runbooks/install-lifecycle-vscode-copilot-local.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/install-lifecycle-vscode-copilot-local.md)
  - Updated: [docs/runbooks/migration-rollout-and-rollback.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/migration-rollout-and-rollback.md)

**3) Migration List With Lock-Risk and Rollback Notes**
1. [009_install_lifecycle_foundations.sql](/home/azureuser/ai-cli-web-funnel/infra/postgres/migrations/009_install_lifecycle_foundations.sql)
2. Lock risk: `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` only; brief catalog locks, no table rewrite DDL.
3. Rollback notes: forward-compensation only; stop lifecycle writers first, archive lifecycle data, then compensate with additive migration instead of destructive down migration.

**4) Test Commands Executed With Pass/Fail Summary**
1. `npm run typecheck` -> Pass.
2. `npm run test` -> Pass.
3. `npm run check` -> Pass.
4. `npm run verify:migrations:dr018` -> Pass.
5. `npm run test:e2e-local` -> Pass.
6. `npm run test:integration-db:docker` -> Pass.
7. `npm run test:integration-db` (within docker script uses `--maxWorkers=1`) -> Pass.

**5) Deferred Items With Rationale**
1. None for Wave 5 scope. All Step 1..12 deliverables in the Wave 5 prompt were implemented and validated.

**6) DR/AQ/MQ Status Confirmation**
1. Confirmed: DR/AQ/MQ approval statuses were not silently changed; governance records remain in current Proposed/Open posture unless explicitly approved.

**7) discover/plan/apply/verify Coverage Matrix (Evidence)**
1. discover:
   - Endpoints: `GET /v1/packages`, `GET /v1/packages/:package_id`, `POST /v1/packages/search`.
   - Tables: `registry.packages`, `package_aliases`, `package_merge_runs`, `package_field_lineage`, `package_identity_conflicts`.
   - Tests: `packages/catalog/tests/ingest.test.ts`, `tests/integration-db/catalog-and-lifecycle.integration-db.test.ts`.
2. plan:
   - Endpoints: `POST /v1/install/plans`, `GET /v1/install/plans/:plan_id`.
   - Tables: `install_plans`, `install_plan_actions`, `install_plan_audit`.
   - Tests: `apps/control-plane/tests/install-lifecycle.test.ts`, `tests/integration-db/catalog-and-lifecycle.integration-db.test.ts`.
3. apply:
   - Endpoint: `POST /v1/install/plans/:plan_id/apply`.
   - Tables: `install_apply_attempts`, action status updates in `install_plan_actions`, audit appends in `install_plan_audit`, replay records in `ingestion_idempotency_records`.
   - Tests: `apps/copilot-vscode-adapter/tests/adapter-contract.test.ts`, `tests/e2e/install-runtime-local.e2e.test.ts`, `tests/integration-db/catalog-and-lifecycle.integration-db.test.ts`.
4. verify:
   - Endpoint: `POST /v1/install/plans/:plan_id/verify`.
   - Tables: `install_verify_attempts`, plan status transitions in `install_plans`, audit appends in `install_plan_audit`.
   - Tests: `apps/control-plane/tests/http-app.test.ts`, `tests/e2e/install-runtime-local.e2e.test.ts`, `tests/integration-db/catalog-and-lifecycle.integration-db.test.ts`.
