# Wave 7 Build Report

Date: 2026-02-28  
Scope: Wave 7 operations hardening from the `README.md` Wave 7 prompt.

## 1) Step-by-step implementation summary (Step 1..12)

1. Step 1 (traceability + acceptance gates): completed.
   - Added `docs/wave7-execution-plan.md` with risk/migration/test/governance matrix and acceptance criteria.
   - Added Wave 7 scope lock in `DECISION_LOG.md` (`DLOG-0028`).
2. Step 2 (deferred full-flow local e2e): completed.
   - Added `tests/e2e/discover-plan-apply-verify-local.e2e.test.ts`.
   - Single scenario now asserts discover search metadata (`semantic_fallback`, lineage fields) plus plan replay + apply + verify progression.
3. Step 3 (retrieval sync/backfill pipeline): completed.
   - Added `packages/ranking/src/retrieval-sync.ts` with deterministic projection, fingerprinting, bounded batch/cursor support, and Qdrant writer integration.
   - Added `scripts/run-retrieval-sync.mjs` with `dry-run`/`apply`, `--limit`, `--cursor`, and package filters.
4. Step 4 (`ranking.sync.requested` real execution): completed.
   - Internal outbox handler now invokes ranking sync executor hook and records result side effects.
   - Outbox processor now wires retrieval sync execution for ranking events in internal dispatch mode.
5. Step 5 (promote internal handlers beyond ledger-only): completed.
   - Added side-effect persistence path (`outbox_internal_dispatch_effects`) for fraud/security/install/ranking handler families.
6. Step 6 (dead-letter replay/requeue tooling): completed.
   - Added `packages/security-governance/src/dead-letter-requeue.ts` and `scripts/run-outbox-dead-letter-replay.mjs`.
   - Requeue mutation requires explicit `--confirm true` and writes append-only replay audit rows.
7. Step 7 (runtime secret resolver abstraction): completed.
   - Added provider-first secret resolver with env fallback in `apps/control-plane/src/runtime-remote-config.ts`.
   - Added oauth failure-log redaction for secret-like fragments.
8. Step 8 (env contract + startup validation): completed.
   - Expanded `.env.example` for retrieval/runtime/outbox contract.
   - Added deterministic startup env matrix validation in `apps/control-plane/src/startup-env-validation.ts` and wired into `loadControlPlaneEnvConfig`.
9. Step 9 (additive migration for Wave 7): completed.
   - Added `infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql`.
   - Added migration contract coverage in `tests/contract/migration-wave7.contract.test.ts`.
10. Step 10 (CI automation): completed.
   - Added `.github/workflows/forge-ci.yml` with baseline checks and integration-db docker flow.
   - Added `docs/ci-verification.md` for required checks and blocker interpretation.
11. Step 11 (runbook refresh): completed.
   - Updated required runbooks and added:
     - `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
     - `docs/runbooks/outbox-dead-letter-requeue.md`
12. Step 12 (governance/reporting closure): completed.
   - Added Wave 7 decision entries (`DLOG-0028`..`DLOG-0032`).
   - Published this report with explicit blocker/deferred notes.

## 2) Exact files created/updated

Created:
1. `.github/workflows/forge-ci.yml`
2. `apps/control-plane/src/startup-env-validation.ts`
3. `apps/control-plane/tests/startup-env-validation.test.ts`
4. `docs/ci-verification.md`
5. `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
6. `docs/runbooks/outbox-dead-letter-requeue.md`
7. `docs/wave7-execution-plan.md`
8. `docs/wave7-build-report.md`
9. `infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql`
10. `packages/ranking/src/retrieval-sync.ts`
11. `packages/ranking/tests/retrieval-sync.test.ts`
12. `packages/security-governance/src/dead-letter-requeue.ts`
13. `scripts/run-retrieval-sync.mjs`
14. `scripts/run-outbox-dead-letter-replay.mjs`
15. `tests/contract/migration-wave7.contract.test.ts`
16. `tests/e2e/discover-plan-apply-verify-local.e2e.test.ts`
17. `tests/integration-db/dead-letter-requeue.integration-db.test.ts`

Updated:
1. `.env.example`
2. `DECISION_LOG.md`
3. `README.md`
4. `apps/control-plane/src/http-app.ts`
5. `apps/control-plane/src/runtime-remote-config.ts`
6. `apps/control-plane/src/server.ts`
7. `apps/control-plane/tests/runtime-remote-config.test.ts`
8. `docs/README.md`
9. `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
10. `docs/runbooks/install-lifecycle-vscode-copilot-local.md`
11. `docs/runbooks/runtime-preflight-and-adapter-contracts.md`
12. `docs/runbooks/semantic-retrieval-incident-fallback.md`
13. `package.json`
14. `packages/ranking/package.json`
15. `packages/ranking/src/index.ts`
16. `packages/security-governance/package.json`
17. `packages/security-governance/src/index.ts`
18. `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`
19. `packages/security-governance/tests/internal-outbox-dispatch-handlers.test.ts`
20. `scripts/run-outbox-processor.mjs`
21. `tests/integration-db/helpers/postgres.ts`
22. `tests/integration-db/outbox-dispatcher.integration-db.test.ts`

## 3) Migration list with lock-risk and rollback notes

1. `011_retrieval_sync_and_dead_letter_ops.sql`
   - Lock risk: catalog locks only for additive table/index creation; no table rewrites.
   - Rollback strategy: forward compensation preferred; if emergency rollback is required, stop outbox/retrieval sync workers first, archive rows, then drop new relations.

## 4) Commands executed with pass/fail results

1. `npm run typecheck` -> PASS
2. `npm run test` -> PASS
3. `npm run check` -> PASS
4. `npm run verify:migrations:dr018` -> PASS
5. `npm run test:e2e-local` -> PASS
6. `npm run test:integration-db:docker` -> PASS
7. `npm run run:outbox -- --mode dry-run --limit 25` -> FAIL (environment blocker: `FORGE_DATABASE_URL or DATABASE_URL is required`)
8. `npm run run:catalog-ingest -- --mode dry-run --input /tmp/wave7-catalog-fixture.json` -> PASS
9. `npm run run:retrieval-sync -- --mode dry-run --limit 25` -> FAIL (environment blocker: `FORGE_DATABASE_URL or DATABASE_URL is required`)
10. `npm run run:outbox-dead-letter -- --action list --limit 25` -> FAIL (environment blocker: `FORGE_DATABASE_URL or DATABASE_URL is required`)
11. Targeted suites:
   - `npm run --workspace @forge/ranking test` -> PASS
   - `npm run --workspace @forge/security-governance test` -> PASS
   - `npm run --workspace @forge/control-plane test` -> PASS
   - `npm run test:integration-contract` -> PASS

## 5) Deferred items with explicit rationale

1. No code-path deferred items remain from the Wave 7 prompt.
2. Environment-gated operator commands remain blocked without local DB URL configuration (`FORGE_DATABASE_URL`/`DATABASE_URL`), but this is an execution-environment prerequisite rather than implementation debt.

## 6) Explicit governance statement

No AQ/MQ/DR status was silently changed from Open/Proposed to Approved in this wave.

## 7) Updated discover/plan/apply/verify coverage matrix

1. Discover:
   - retrieval sync service + script with deterministic projection/fingerprints;
   - ranking outbox sync execution path and retrieval metadata e2e assertions.
2. Plan:
   - full-flow local e2e plan creation + replay coverage;
   - install lifecycle side-effect recording in internal dispatch operations.
3. Apply:
   - internal outbox handlers now persist deterministic side effects beyond run ledger;
   - dead-letter replay tooling for controlled requeue.
4. Verify:
   - startup env matrix validation for retrieval/runtime combinations;
   - runtime secret resolver fallback + oauth failure-log redaction.

## 8) Operational readiness notes

Production-ready now:
1. Retrieval sync/backfill execution path with bounded batches and fingerprint skip logic.
2. Internal outbox deterministic side-effect audit path across event families.
3. Dead-letter list/requeue operations with explicit confirmation + replay audit trail.
4. CI workflow enforcing baseline checks and integration-db docker validation.

Still gated:
1. Operator dry-run commands requiring a configured DB URL in the local shell (`run:outbox`, `run:retrieval-sync`, `run:outbox-dead-letter`).

## 9) Environment requirement matrix

| Command / Service | Required env | Optional env |
| --- | --- | --- |
| `npm run run:control-plane` | `FORGE_DATABASE_URL` or `DATABASE_URL` | `FORGE_HOST`, `FORGE_PORT` |
| `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true npm run run:control-plane` | above + `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, (`EMBEDDING_API_KEY` or `OPENAI_API_KEY`) | `EMBEDDING_API_BASE_URL` |
| `npm run run:retrieval-sync -- --mode dry-run ...` | `FORGE_DATABASE_URL` or `DATABASE_URL` | `--cursor`, `--package-ids`, `RETRIEVAL_SYNC_LIMIT` |
| `npm run run:retrieval-sync -- --mode apply ...` | dry-run requirements + retrieval/Qdrant/embedding envs above | `EMBEDDING_API_BASE_URL` |
| `npm run run:outbox -- --mode dry-run ...` | `FORGE_DATABASE_URL` or `DATABASE_URL` | `OUTBOX_JOB_LIMIT`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_RETRY_BACKOFF_SECONDS` |
| `OUTBOX_INTERNAL_DISPATCH=true npm run run:outbox -- --mode production ...` | dry-run requirements + `OUTBOX_INTERNAL_DISPATCH=true` + retrieval/Qdrant/embedding envs for ranking sync events | `OUTBOX_RANKING_SYNC_LIMIT` |
| `OUTBOX_DISPATCH_ENDPOINT=... npm run run:outbox -- --mode production ...` | dry-run requirements + `OUTBOX_DISPATCH_ENDPOINT` | `OUTBOX_DISPATCH_BEARER_TOKEN` |
| `npm run run:outbox-dead-letter -- --action list ...` | `FORGE_DATABASE_URL` or `DATABASE_URL` | filters (`--event-type`, `--dedupe-key`, `--created-from`, `--created-to`, `--limit`) |
| `npm run run:outbox-dead-letter -- --action requeue ... --confirm true` | list requirements + `--confirm true` | `--reason`, `--requested-by`, `--correlation-id` |
