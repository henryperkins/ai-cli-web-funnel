# Wave 6 Build Report

Date: 2026-02-28  
Scope: Next implementation wave after Wave 5 prompt in `README.md`.

## 1) Step-by-step implementation summary (Step 1..12)

1. Step 1 (traceability + acceptance gates): completed.
   - Added `docs/wave6-execution-plan.md` with risk/migration/test/governance mapping and acceptance criteria.
   - Added initial Wave 6 scope lock in `DECISION_LOG.md` (`DLOG-0024`).
2. Step 2 (concrete retrieval providers): completed.
   - Added Postgres BM25 retriever, Qdrant semantic retriever, and OpenAI-compatible embedding provider in `packages/ranking/src/`.
   - Added deterministic/fallback/timeout/error tests.
3. Step 3 (retrieval bootstrap startup wiring): completed.
   - Added `apps/control-plane/src/retrieval-bootstrap.ts` and startup helper wiring in `apps/control-plane/src/server.ts`.
   - Updated `apps/control-plane/src/server-main.ts` to provide retrieval bootstrap path.
   - Added readiness-path tests (required/not required/bootstrap failed/bootstrap ready).
4. Step 4 (deterministic catalog ingest runner): completed.
   - Added executable runner `scripts/run-catalog-ingest.mjs` with dry-run/apply modes, deterministic merge-run id fallback, and summary output.
   - Existing integration-db ingest rerun safety coverage retained (`tests/integration-db/catalog-and-lifecycle.integration-db.test.ts`).
5. Step 5 (replace outbox no-op handlers): completed.
   - Added real internal handlers in `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`.
   - Replaced no-op internal mode in `scripts/run-outbox-processor.mjs`.
   - Added unit + integration-db coverage for retry/dead-letter/internal-ledger writes.
6. Step 6 (runtime feature-flag loader): completed.
   - Added env-driven runtime flag loader `apps/control-plane/src/runtime-feature-flags.ts`.
   - Removed hardcoded fallback gate assumptions in default runtime verifier wiring.
7. Step 7 (secret_ref + OAuth integration hardening): completed.
   - Added `apps/control-plane/src/runtime-remote-config.ts` (remote resolver, secret-ref resolver, fetch-backed probe client, OAuth client builder).
   - Added tests for missing `secret_ref`, OAuth exchange failure, and token-cache recovery behavior.
8. Step 8 (lifecycle observability + correlation continuity): completed.
   - Enforced effective correlation-id fallback (`correlation_id -> plan.correlation_id -> plan_id`) in apply/verify paths.
   - Ensured audit/outbox/logging paths share the same effective correlation ID.
9. Step 9 (additive migration for wave capabilities): completed.
   - Added `010_outbox_internal_dispatch_runs.sql` with lock-risk and rollback notes.
   - Added migration contract coverage.
10. Step 10 (end-to-end verification expansion): partially completed.
   - Added integration-db readiness wiring coverage (`tests/integration-db/retrieval-bootstrap-readiness.integration-db.test.ts`).
   - Added integration-db outbox handler execution assertions in `tests/integration-db/outbox-dispatcher.integration-db.test.ts`.
   - Deferred: dedicated e2e-local scenario for full discover->plan->apply->verify with retrieval metadata assertions.
11. Step 11 (runbook/operator refresh): completed.
   - Updated required runbooks with exact commands, failure signatures, and symptom->cause->fix guidance.
12. Step 12 (governance/reporting closure): completed.
   - Added Wave 6 decision log entries (`DLOG-0024`..`DLOG-0027`).
   - Published this report with explicit deferred items and validation boundaries.

## 2) Exact files created/updated

Created:
1. `docs/wave6-execution-plan.md`
2. `docs/wave6-build-report.md`
3. `packages/ranking/src/postgres-bm25-retriever.ts`
4. `packages/ranking/src/qdrant-semantic-retriever.ts`
5. `packages/ranking/src/embedding-provider.ts`
6. `packages/ranking/tests/postgres-bm25-retriever.test.ts`
7. `packages/ranking/tests/qdrant-semantic-retriever.test.ts`
8. `packages/ranking/tests/embedding-provider.test.ts`
9. `apps/control-plane/src/retrieval-bootstrap.ts`
10. `apps/control-plane/src/runtime-feature-flags.ts`
11. `apps/control-plane/src/runtime-remote-config.ts`
12. `apps/control-plane/tests/retrieval-bootstrap.test.ts`
13. `apps/control-plane/tests/runtime-feature-flags.test.ts`
14. `apps/control-plane/tests/runtime-remote-config.test.ts`
15. `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`
16. `packages/security-governance/tests/internal-outbox-dispatch-handlers.test.ts`
17. `infra/postgres/migrations/010_outbox_internal_dispatch_runs.sql`
18. `tests/contract/migration-wave6.contract.test.ts`
19. `tests/integration-db/retrieval-bootstrap-readiness.integration-db.test.ts`
20. `scripts/run-catalog-ingest.mjs`

Updated:
1. `DECISION_LOG.md`
2. `README.md` (existing Wave 6 prompt reused; no prompt contract changes)
3. `package.json`
4. `packages/ranking/src/index.ts`
5. `packages/ranking/package.json`
6. `apps/control-plane/src/server.ts`
7. `apps/control-plane/src/server-main.ts`
8. `apps/control-plane/src/http-app.ts`
9. `apps/control-plane/src/install-lifecycle.ts`
10. `scripts/run-outbox-processor.mjs`
11. `packages/security-governance/src/index.ts`
12. `tests/integration-db/helpers/postgres.ts`
13. `tests/integration-db/outbox-dispatcher.integration-db.test.ts`
14. `docs/runbooks/semantic-retrieval-incident-fallback.md`
15. `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
16. `docs/runbooks/runtime-preflight-and-adapter-contracts.md`
17. `docs/runbooks/install-lifecycle-vscode-copilot-local.md`

## 3) Migration list with lock-risk and rollback notes

1. `010_outbox_internal_dispatch_runs.sql`
   - Lock risk: catalog locks only for table/index creation; no table rewrite.
   - Rollback strategy: forward compensation preferred; if emergency rollback needed, stop outbox processor first, archive rows, then drop relation.

## 4) Commands executed with pass/fail results

1. `npm run typecheck` -> PASS
2. `npm run test` -> PASS
3. `npm run check` -> PASS
4. `npm run verify:migrations:dr018` -> PASS
5. `npm run test:e2e-local` -> PASS
6. `npm run test:integration-db:docker` -> PASS
7. `npm run run:outbox -- --mode dry-run --limit 25` -> FAIL (environment blocker: `FORGE_DATABASE_URL or DATABASE_URL is required`)
8. Targeted suites:
   - `npm run --workspace @forge/ranking test` -> PASS
   - `npm run --workspace @forge/security-governance test` -> PASS
   - `npm run --workspace @forge/control-plane test` -> PASS

## 5) Deferred items with explicit rationale

1. Dedicated e2e-local full-flow scenario (`discover->plan->apply->verify`) with retrieval metadata assertion was deferred.
   - Rationale: integration-db coverage was prioritized first for retrieval bootstrap + outbox execution correctness; dedicated local e2e orchestration should be added as a follow-up without blocking current hardening.

## 6) Explicit governance statement

No AQ/MQ/DR status was silently changed from Open/Proposed to Approved in this wave.

## 7) Updated discover/plan/apply/verify coverage matrix

1. Discover:
   - concrete BM25 + semantic provider modules,
   - retrieval bootstrap startup gating and readiness diagnostics,
   - deterministic catalog ingest execution script.
2. Plan:
   - correlation continuity hardening in lifecycle logs/audit/outbox payloads.
3. Apply:
   - internal outbox dispatch handlers now perform real replay-safe persistence.
4. Verify:
   - runtime feature-flag/env + remote auth resolution path validated;
   - readiness checks expanded with retrieval-bootstrap integration-db assertions.

## 8) Operational readiness notes

Production-ready now:
1. Concrete retrieval provider path with fail-closed bootstrap checks.
2. Internal outbox dispatch mode with persistent replay-safe audit ledger.
3. Env-driven runtime gates and remote auth/secret wiring with deterministic failure codes.
4. Wave 6 migration + contract/integration coverage.

Still gated/deferred:
1. Full local e2e discover->plan->apply->verify retrieval-metadata assertion.
2. `run:outbox` local dry-run requires explicit DB env configuration in operator environment.
