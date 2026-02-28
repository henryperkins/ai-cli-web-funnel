# Wave 9 Build Report

Date: 2026-02-28  
Scope: Close profile/bundle orchestration, observability (SLO rollup), governance automation, and Wave 9 closure consistency gaps.

## 1) Step-by-step implementation summary (Step 1..12)

1. Step 1 (traceability + acceptance gates): completed.
   - `docs/wave9-execution-plan.md` includes step matrix, acceptance criteria, and event ownership matrix.
   - `DECISION_LOG.md` includes Wave 9 scope lock (`DLOG-0033`).
2. Step 2 (docs/source reconciliation): completed.
   - Root/docs indexes now reflect Wave 8/9 artifacts, migration range `001..013`, and current runbooks.
   - Stale "pending" language for already-landed artifacts removed from root docs.
3. Step 3 (profile API validation): pre-existing and completed in Wave 8.
   - Profile validation and error taxonomy are already implemented and test-covered.
4. Step 4 (profile install-run orchestration): pre-existing and completed in Wave 8.
   - Run-plan linkage, status progression, and aggregate persistence are implemented and integration-db covered.
5. Step 5 (profile install execution modes): pre-existing and completed in Wave 8.
   - `plan_only` and `apply_verify` are implemented with deterministic replay/conflict behavior.
6. Step 6 (event ownership + metrics disposition): completed.
   - Event ownership matrix is codified.
   - `metrics.aggregate.requested` remains explicitly unsupported with deterministic rejection.
7. Step 7 (SLO rollup foundations): completed.
   - Migration `013_operational_slo_rollup_foundations.sql` landed.
   - Service and tests are in place (`packages/security-governance/src/slo-rollup.ts`, unit and integration-db coverage).
8. Step 8 (SLO rollup operator runner): completed.
   - `scripts/run-slo-rollup.mjs` supports `--mode`, `--from`, `--to`, `--limit` and structured logs.
9. Step 9 (hermetic local stack): completed.
   - `docker-compose.yml` + `scripts/local-stack-up.sh` + `scripts/local-stack-down.sh` provide Postgres/Qdrant local stack bootstrap.
10. Step 10 (test + CI expansion): completed with implemented profile-e2e and ops-smoke paths.
    - Required CI checks are active with explicit profile e2e execution in `.github/workflows/forge-ci.yml` (`npm run test:e2e-local`).
    - DB-backed ops smoke workflow is implemented as non-blocking (`.github/workflows/forge-ops-smoke.yml`, `DLOG-0037`) with fail-closed migration bootstrap (`ON_ERROR_STOP`, no suppressed errors).

11. Step 11 (runbook + governance automation): completed.
    - Governance checker is wired via `npm run check` (`check:governance` -> `scripts/verify-governance-drift.mjs`).
    - SLO runbook SQL/log-field drift corrected to match current schema and script payload keys.
12. Step 12 (governance/reporting closure): completed.

- Wave 9 plan/CI/report docs now agree on Step 10 implemented posture.
- This report is updated with real command outcomes from the closure pass.

## 2) Exact files created/updated

Wave 9 artifacts previously created:

1. `docker-compose.yml`
2. `docs/runbooks/profile-lifecycle-operations.md`
3. `docs/runbooks/slo-rollup-operations.md`
4. `docs/wave8-build-report.md`
5. `docs/wave9-execution-plan.md`
6. `scripts/local-stack-down.sh`
7. `scripts/local-stack-up.sh`
8. `scripts/verify-governance-drift.mjs`
9. `infra/postgres/migrations/013_operational_slo_rollup_foundations.sql`

Updated in this findings-remediation pass:

1. `.github/workflows/forge-ci.yml` (adds explicit `npm run test:e2e-local` CI step)
2. `.github/workflows/forge-ops-smoke.yml` (fail-closed migration bootstrap; removed silent migration failure suppression)
3. `README.md` (Step 10 status reconciliation and archived Wave 9 closure prompt labeling)
4. `docs/ci-verification.md` (Step 10 section title normalized to implemented status)
5. `docs/wave9-execution-plan.md` (Step 10 closure decision updated with CI e2e + fail-closed ops-smoke migration details)
6. `docs/immediate-execution-plans/e9-s1-profile-e2e-ci-plan.md` (execution evidence section added)
7. `docs/immediate-execution-plans/e9-s2-ops-smoke-workflow-plan.md` (execution evidence section added)
8. `docs/immediate-execution-plans/e2-s1-github-connector-plan.md` (execution evidence section added)
9. `docs/application-completion-backlog.md` (Immediate Next Sprint updated to remove already-completed items)
10. `docs/wave9-build-report.md` (this updated closure report)

## 3) Migration list with lock-risk and rollback notes

1. `013_operational_slo_rollup_foundations.sql`
   - Lock risk: catalog locks only for additive table/index creation; no table rewrites.
   - Rollback strategy: prefer forward compensation; if emergency rollback is required, stop SLO rollup writers before archiving and dropping new relations.

No additional migrations were introduced in this closure pass.

## 4) Commands executed with pass/fail results

1. `npm run typecheck` -> PASS
2. `npm run test` -> PASS
3. `npm run check` -> PASS (`check:governance` now executes `scripts/verify-governance-drift.mjs`)
4. `npm run verify:migrations:dr018` -> PASS
5. `npm run test:e2e-local` -> PASS (3 files, 8 tests)
6. `npm run test:integration-db:docker` -> PASS (7 files, 23 tests)
7. `npm run test --workspace @forge/catalog` -> PASS (4 files, 21 tests)

Integration-db closure notes:

1. Post-remediation docker run completed cleanly (7 files, 23 tests) with no migration or fixture failures.

## 5) Step 10 closure implementation notes

1. Profile-specific e2e scenario is implemented.
   - Evidence: `tests/e2e/profile-lifecycle-local.e2e.test.ts` and `.github/workflows/forge-ci.yml` (`npm run test:e2e-local`).
   - Decision reference: `DECISION_LOG.md` (`DLOG-0036`).
2. DB-backed ops smoke workflow is implemented as non-blocking/manual+nightly automation.
   - Evidence: `.github/workflows/forge-ops-smoke.yml` and `docs/ci-verification.md` Step 10 section.
   - Migration bootstrap now fails closed (`ON_ERROR_STOP`, no `|| true`, no stderr suppression).
   - Decision reference: `DECISION_LOG.md` (`DLOG-0037`).

## 6) Explicit governance statement

No AQ/MQ/DR status was silently changed from Open/Proposed to Approved. Governance drift checks remain enforced in `npm run check`.

## 7) Updated discover/plan/install/verify coverage matrix

1. Discover: catalog search + ranking lineage, with SLO coverage for semantic fallback rate.
2. Plan: deterministic install planning plus profile multi-package orchestration.
3. Install: apply flow and profile `plan_only`/`apply_verify` execution paths with replay semantics.
4. Verify: per-plan verify attempts and profile run verify outcomes with SLO rollup visibility.

## 8) Operational readiness notes

Production-ready now:

1. Profile lifecycle API (create/list/get/export/import/install/install-run lookup).
2. SLO rollup persistence + operator runner.
3. Governance drift checker integrated into `npm run check`.
4. Hermetic local Postgres/Qdrant operator stack.

Still gated:

1. None in Step 10 scope; workflow remains intentionally non-blocking by design.

## 9) Environment requirement matrix

| Command / Service                                | Required env                           | Optional env                                                       |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| `npm run check`                                  | none                                   | none                                                               |
| `npm run verify:migrations:dr018`                | none                                   | none                                                               |
| `npm run test:e2e-local`                         | none                                   | none                                                               |
| `npm run test:integration-db:docker`             | Docker runtime                         | none                                                               |
| `node scripts/run-slo-rollup.mjs --mode dry-run` | `FORGE_DATABASE_URL` or `DATABASE_URL` | `SLO_ROLLUP_MODE`, `SLO_ROLLUP_LIMIT`, `--from`, `--to`, `--limit` |
| Profile API endpoints                            | `FORGE_DATABASE_URL` or `DATABASE_URL` | `FORGE_HOST`, `FORGE_PORT`                                         |

## 10) Event-family ownership matrix

| Event Type                               | Family        | Producer                          | Dispatcher        | Handler                           | Side Effects                                                |
| ---------------------------------------- | ------------- | --------------------------------- | ----------------- | --------------------------------- | ----------------------------------------------------------- |
| fraud.reconcile.requested                | Fraud         | security-governance ingestion     | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| ranking.sync.requested                   | Ranking       | catalog ingest outbox             | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects + retrieval_sync_documents |
| security.report.accepted                 | Security      | signed reporter ingestion         | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| security.enforcement.recompute.requested | Security      | signed reporter ingestion         | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| install.plan.created                     | Install       | POST /v1/install/plans            | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| install.apply.succeeded                  | Install       | POST /v1/install/plans/:id/apply  | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| install.apply.failed                     | Install       | POST /v1/install/plans/:id/apply  | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| install.verify.succeeded                 | Install       | POST /v1/install/plans/:id/verify | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| install.verify.failed                    | Install       | POST /v1/install/plans/:id/verify | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects                            |
| metrics.aggregate.requested              | (unsupported) | —                                 | REJECTED          | —                                 | Throws unsupported_event_type error                         |

## 11) Profile lifecycle coverage matrix

| Operation       | Endpoint                              | Test Evidence                                                |
| --------------- | ------------------------------------- | ------------------------------------------------------------ |
| create          | POST /v1/profiles                     | `tests/integration-db/profile-bundle.integration-db.test.ts` |
| list            | GET /v1/profiles                      | `tests/integration-db/profile-bundle.integration-db.test.ts` |
| get             | GET /v1/profiles/:id                  | `tests/integration-db/profile-bundle.integration-db.test.ts` |
| export          | GET /v1/profiles/:id/export           | `tests/integration-db/profile-bundle.integration-db.test.ts` |
| import          | POST /v1/profiles/import              | `tests/integration-db/profile-bundle.integration-db.test.ts` |
| install         | POST /v1/profiles/:id/install         | `tests/integration-db/profile-bundle.integration-db.test.ts` |
| get-install-run | GET /v1/profiles/install-runs/:run_id | `tests/integration-db/profile-bundle.integration-db.test.ts` |

## 12) SLO coverage table

| Metric Key                                 | Calculation Source                                                                                | Validation Evidence   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------- |
| outbox.dispatch.dead_letter_rate           | `ingestion_outbox` (`status='dead_letter'` / total)                                               | unit + integration-db |
| retrieval.semantic_fallback.rate           | `raw_events` (`semantic_fallback=true` search.query / total search.query)                         | unit                  |
| install.apply.success_rate                 | `install_apply_attempts` (`status='succeeded'` / total)                                           | unit                  |
| install.verify.success_rate                | `install_verify_attempts` (`status='succeeded'` / total)                                          | unit                  |
| install.lifecycle.replay_ratio             | `install_plan_audit` (`idempotent_replay=true` / total apply+verify)                              | unit                  |
| profile.install_run.success_rate           | `profile_install_runs` (`status='succeeded'` / total)                                             | unit                  |
| governance.recompute.dispatch_success_rate | `outbox_internal_dispatch_runs` / `ingestion_outbox` (`security.enforcement.recompute.requested`) | unit                  |

## 13) Final acceptance check (Step 2/10/11/12)

| Step                                      | Status                                 | Evidence                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 2 (docs/source reconciliation)       | Satisfied                              | `README.md`, `docs/README.md`, `docs/runbooks/README.md` updated to current state                                                                                 |
| Step 10 (test + CI expansion)             | Satisfied with implementation evidence | `tests/e2e/profile-lifecycle-local.e2e.test.ts`, `.github/workflows/forge-ci.yml`, `.github/workflows/forge-ops-smoke.yml`, `docs/ci-verification.md`, `DECISION_LOG.md` (`DLOG-0036`, `DLOG-0037`) |
| Step 11 (runbook + governance automation) | Satisfied                              | governance checker wired in `package.json`, SLO runbook drift corrected                                                                                           |
| Step 12 (governance/reporting closure)    | Satisfied                              | corrected `docs/wave9-build-report.md` with real command outcomes                                                                                                 |

## 14) Findings Closure Matrix (Immediate Plan Review)

| Finding | Resolution | Evidence |
| ------- | ---------- | -------- |
| E9-S1 completion claim not backed by CI wiring | Added explicit `npm run test:e2e-local` step to required CI workflow | `.github/workflows/forge-ci.yml`; `npm run test:e2e-local` PASS |
| Ops smoke could silently pass failed migrations | Removed migration error suppression and enforced `psql -v ON_ERROR_STOP=1` | `.github/workflows/forge-ops-smoke.yml` |
| Root docs inconsistent with implemented Step 10 status | Reconciled root + plan/docs language to implemented posture | `README.md`, `docs/ci-verification.md`, `docs/wave9-execution-plan.md` |
| Completed immediate plans missing execution evidence | Added per-plan execution notes with changed files, commands, results, and deferred items | `docs/immediate-execution-plans/e9-s1-profile-e2e-ci-plan.md`, `docs/immediate-execution-plans/e9-s2-ops-smoke-workflow-plan.md`, `docs/immediate-execution-plans/e2-s1-github-connector-plan.md` |
| Backlog immediate sprint listed completed items | Updated next sprint items to unresolved stories | `docs/application-completion-backlog.md` |
