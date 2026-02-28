# Forge: CurseForge-Style CLI Addon Manager

Forge is a go-between for CLI addon installation workflows.
It targets MCP servers, skills, plugins, and related addons that are currently installed via fragmented copy/paste instructions from GitHub/docs.

Reference model: the CurseForge app flow for WoW addons, adapted for CLI ecosystems.

## Problem

Today the common path is:
1. Search the web for an addon.
2. Find install instructions (if they exist and are current).
3. Copy and paste commands/config by hand.
4. Debug failures with low visibility.

Forge aims to replace that with a deterministic path:
1. Discover addon metadata.
2. Build a safe install plan.
3. Install addon/config changes.
4. Verify the addon is callable at runtime.

## Product Shape (CurseForge Analogy)

1. Searchable addon catalog with normalized metadata.
2. Managed install/update/remove lifecycle.
3. Dependency-aware install planning.
4. Profile-aware config writes for supported clients.
5. Health checks, error classification, and rollback guidance.

## Current Repository State (Post Wave 7 + Wave 8/9 Delivery)

Validated baseline (Wave 7 build report evidence):
1. Discover stage: deterministic catalog ingest domain + executable ingest runner (`scripts/run-catalog-ingest.mjs`) with replay-safe persistence over `registry.packages`, `package_aliases`, `package_merge_runs`, `package_field_lineage`, and `package_identity_conflicts`.
2. Discover API: `GET /v1/packages`, `GET /v1/packages/:package_id`, and `POST /v1/packages/search` with ranking lineage (`embedding_model_version`, `vector_collection_version`) and `semantic_fallback` signaling.
3. Retrieval path: concrete Postgres BM25 retriever, Qdrant semantic retriever, and OpenAI-compatible embedding provider wired into control-plane bootstrap (`apps/control-plane/src/retrieval-bootstrap.ts`).
4. Retrieval sync/backfill path: deterministic projection + fingerprinting + bounded batching via `packages/ranking/src/retrieval-sync.ts` and `scripts/run-retrieval-sync.mjs`.
5. Startup/readiness hardening: fail-closed readiness details for DB and required retrieval bootstrap in `apps/control-plane/src/server.ts`.
6. Plan stage: deterministic install planning with persisted `install_plans`, `install_plan_actions`, and append-only `install_plan_audit`.
7. Apply stage: `POST /v1/install/plans/:plan_id/apply` with replay-safe idempotency and persisted apply attempts.
8. Verify stage: `POST /v1/install/plans/:plan_id/verify` with runtime pipeline stage outcomes, persisted verify attempts, and correlation continuity.
9. Runtime wiring: env-driven runtime feature flags (`apps/control-plane/src/runtime-feature-flags.ts`) plus remote auth + `secret_ref` resolution + OAuth client-credentials integration (`apps/control-plane/src/runtime-remote-config.ts`).
10. Runtime startup env matrix validation (`apps/control-plane/src/startup-env-validation.ts`) with deterministic non-secret validation errors.
11. Filesystem-backed VS Code Copilot adapter: ordered scope writes, atomic temp-write + rename, rollback-on-failure, and sidecar ownership checks.
12. Outbox processing: deterministic processor modes (`dry-run`/`shadow`/`production`) with replay-safe execution ledger and side-effect audit (`infra/postgres/migrations/010_outbox_internal_dispatch_runs.sql`, `011_retrieval_sync_and_dead_letter_ops.sql`).
13. Internal ranking sync execution from outbox (`ranking.sync.requested`) with deterministic side effects and replay-safe effect dedupe.
14. Dead-letter operator tooling (`scripts/run-outbox-dead-letter-replay.mjs`) with explicit confirmation and append-only replay audit trail.
15. CI baseline in `.github/workflows/forge-ci.yml` covering typecheck/test/check/migration verification/integration-db docker flow.
16. Migration set: additive migrations `001..013` with DR-018 verification guard (`scripts/verify-dr018-migration.mjs`) and wave migration contract coverage.

Wave 8 foundations (in-source, pre-report):
1. Profile/bundle contract types (`packages/shared-contracts/src/profiles.ts`) are exported and consumed by control-plane profile routes.
2. Profile API routes in control-plane: `GET/POST /v1/profiles`, `GET /v1/profiles/:id`, `GET /v1/profiles/:id/export`, `POST /v1/profiles/import`, `POST /v1/profiles/:id/install`, `GET /v1/profiles/install-runs/:run_id`.
3. Profile API validation: strict input validation (UUID format, bounds, enum checks, `MAX_PROFILE_PACKAGES=200`), error taxonomy matching existing API style.
4. Profile install-run orchestration: `profile_install_run_plans` linkage, status progression (`running`→`completed`/`failed`), aggregate counts from persisted per-plan outcomes.
5. Profile install execution modes: `plan_only` (default) and `apply_verify` with idempotent replay-safe behavior.
6. Postgres profile adapters (`apps/control-plane/src/profile-postgres-adapters.ts`) with install-run persistence.
7. Additive migration `012_profile_bundle_foundations.sql` introducing `profiles`, `profile_packages`, `profile_install_runs`, `profile_install_run_plans`, and `profile_audit`.
8. Integration-db profile bundle coverage (`tests/integration-db/profile-bundle.integration-db.test.ts`).
9. Deterministic outbox dispatcher supports `security.report.accepted` (plus existing lifecycle/ranking/security event families).

Wave 9 closure artifacts:
1. Operational SLO rollup module (`packages/security-governance/src/slo-rollup.ts`) with deterministic metric computation across 7 SLO metric families.
2. Additive migration `013_operational_slo_rollup_foundations.sql` introducing `operational_slo_rollup_runs` and `operational_slo_snapshots`.
3. SLO rollup operator runner (`scripts/run-slo-rollup.mjs`) with `--mode dry-run|production`, `--from`, `--to`, `--limit`, deterministic run IDs, and structured logs.
4. SLO rollup unit tests (`packages/security-governance/tests/slo-rollup.test.ts`) and integration-db tests (`tests/integration-db/slo-rollup.integration-db.test.ts`).
5. Event ownership matrix codified in `docs/wave9-execution-plan.md` with producer→dispatcher→handler→side-effects mapping for all 9 supported event types plus explicit `metrics.aggregate.requested` non-support.
6. Hermetic local dependency stack via `docker-compose.yml` (Postgres 16 + Qdrant) with bootstrap/teardown scripts.
7. Wave 9 execution plan (`docs/wave9-execution-plan.md`) with step matrix, acceptance gates, validation commands, and event ownership matrix.
8. Wave 9 build report (`docs/wave9-build-report.md`) and Wave 8 build report (`docs/wave8-build-report.md`) published with evidence and deferrals.

Current verified baseline:
1. `npm run typecheck` passes.
2. `npm run test` passes.
3. `npm run check` passes.
4. `npm run verify:migrations:dr018` passes.
5. `npm run test:e2e-local` passes.
6. `npm run test:integration-db:docker` passes.

Known open items:
1. Step 10 closure is implemented:
   - `forge-ci.yml` now runs `npm run test:e2e-local` (includes profile lifecycle e2e coverage).
   - `.github/workflows/forge-ops-smoke.yml` runs non-blocking manual/nightly dry-run ops smoke checks.
2. Remaining post-wave closure items are product/release workflow items (`E9-S3`, `E9-S4`) rather than CI-path implementation gaps.

Important governance boundary:
1. DR/AQ/MQ statuses remain `Proposed` / `Open` unless explicitly approved.

## Documentation Map

1. Product and architecture decisions: `application_decision_records.md`
2. Open architecture/product questions: `application_master_open_questions.md`, `master_open_questions.md`
3. Execution guardrails: `OPEN_QUESTIONS_TRACKER.md`, `DECISION_LOG.md`
4. Operational runbooks:
   - `docs/runbooks/profile-lifecycle-operations.md`
   - `docs/runbooks/slo-rollup-operations.md`
   - `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
   - `docs/runbooks/outbox-dead-letter-requeue.md`
   - `docs/runbooks/semantic-retrieval-incident-fallback.md`
   - `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
5. CI and validation contract: `docs/ci-verification.md`
6. Wave build reports:
   - `docs/wave3-build-report.md`
   - `docs/wave4-build-report.md`
   - `docs/wave5-build-report.md`
   - `docs/wave6-build-report.md`
   - `docs/wave7-build-report.md`
   - `docs/wave8-build-report.md`
   - `docs/wave9-build-report.md`
7. Execution plans: `docs/wave6-execution-plan.md`, `docs/wave7-execution-plan.md`, `docs/wave9-execution-plan.md`
8. Application completion backlog: `docs/application-completion-backlog.md`
9. Immediate execution plans: `docs/immediate-execution-plans/README.md`

## Commands

```bash
npm install
npm run typecheck
npm run test
npm run check
npm run verify:migrations:dr018
npm run test:integration-db
npm run test:integration-db:docker
npm run test:e2e-local
npm run run:retrieval-sync -- --mode dry-run --limit 25
npm run run:outbox -- --mode dry-run --limit 25
npm run run:outbox-dead-letter -- --action list --limit 25
npm run run:slo-rollup -- --mode dry-run --from 2026-02-28T00:00:00Z --to 2026-02-28T12:00:00Z --limit 100
npm run run:control-plane
scripts/local-stack-up.sh    # Bootstrap Postgres + Qdrant via docker-compose
scripts/local-stack-down.sh  # Tear down local stack (preserves volumes)
```

## Integration DB Prerequisites

1. `npm run test:integration-db` requires `FORGE_INTEGRATION_DB_URL` pointing to a Postgres instance with migrations applied.
2. `npm run test:integration-db:docker` provisions an ephemeral Docker Postgres instance, applies migrations `001..013`, and runs the integration-db suite automatically.

## Wave Build Reports

1. `docs/wave3-build-report.md`
2. `docs/wave4-build-report.md`
3. `docs/wave5-build-report.md`
4. `docs/wave6-build-report.md`
5. `docs/wave7-build-report.md`
6. `docs/wave8-build-report.md`
7. `docs/wave9-build-report.md`

## Archived Build Prompt (Wave 9 Closure)

This prompt is retained as the historical closure implementation record from **2026-02-28**. Step 10 CI decisions in this prompt are now implemented.

```text
You are an implementation agent working in /home/azureuser/ai-cli-web-funnel.

Mission:
Close Wave 9 with documentation/code parity, governance gate correctness, and explicit CI-scope decisions.

North-star loop:
1. discover
2. plan
3. install
4. verify

Every step in this build must explicitly improve one or more loop stages.

Current ground truth (do not reinterpret):
1. Governance checker script exists at `scripts/verify-governance-drift.mjs` and must be used by `npm run check`.
2. Wave 8/9 artifacts are already present: `docs/wave8-build-report.md`, `docs/wave9-build-report.md`, `docs/wave9-execution-plan.md`, profile and SLO runbooks, migration `013`.
3. Required CI checks are baseline + integration-db docker flow + `test:e2e-local` in `forge-ci.yml`; ops smoke automation is implemented as a non-blocking workflow.
4. SLO rollup runtime emits logs from `scripts/run-slo-rollup.mjs` with payload keys such as `metric_count`, `persisted`, and `failure_class`.
5. SLO snapshots schema uses `metric_key`, `ratio`, `numerator`, `denominator`, `sample_size`, and `metadata`.

Non-negotiable constraints:
1. Do not silently change AQ/MQ/DR status from Open/Proposed to Approved.
2. Keep additive forward-only migrations; include lock-risk and rollback notes in migration headers.
3. Preserve idempotency semantics everywhere: same key + same hash => replay, same key + different hash => conflict.
4. Keep privacy constraints intact (no raw IP/fingerprint/raw user-agent/raw install command persistence).
5. Never persist plaintext remote secrets; persist secret_ref only.
6. Keep compatibility bridge posture for registry.packages/public.registry_packages until explicit governance approval changes it.
7. Treat missing env/dependency blockers as explicit blockers, not silent regressions (for example missing DB URL or unavailable Qdrant).
8. Do not weaken deterministic outbox safety invariants (`dedupe_key`, replay ledger, effect dedupe).
9. Keep documentation statements bounded to verified evidence.
10. Keep unsupported-event behavior explicit for unknown event families.

Implementation steps:

Step 1: Fix governance gate wiring
1. Update `package.json` so `check:governance` calls `node scripts/verify-governance-drift.mjs`.
2. Confirm `npm run check` executes governance drift detection before typecheck/test.

Deliverables:
1. Updated `package.json`
2. Evidence from `npm run check`

Step 2: Reconcile root docs with actual state
1. Update `README.md` Wave 9 status and known gaps to remove stale “pending” language for already-implemented artifacts.
2. Keep only truly open items, especially Step 10 CI decision items.
3. Ensure Wave 8/9 reports, runbooks, migration range (`001..013`), and test ranges are accurate.

Deliverables:
1. Updated `README.md`
2. Updated `docs/README.md` and `docs/runbooks/README.md`

Step 3: Fix runbook/schema drift
1. Update SLO runbook SQL examples to match actual columns (`metric_key`, `ratio`, etc.).
2. Update log field documentation to match script payload keys (`metric_count`, `persisted`, `failure_class`, `error_message`).
3. Keep runbook examples executable against current schema.

Deliverables:
1. Updated `docs/runbooks/slo-rollup-operations.md`

Step 4: Close Step 10 CI gap explicitly
1. Decide one path and document it consistently:
   - implement profile-specific e2e + ops smoke workflow now, or
   - formally defer both with rationale and ownership.
2. Keep the chosen path consistent across:
   - `docs/wave9-execution-plan.md`
   - `docs/ci-verification.md`
   - `docs/wave9-build-report.md`

Deliverables:
1. Updated plan/report/CI docs with one coherent Step 10 position
2. `DECISION_LOG.md` entry if deferring

Step 5: Re-run and capture verification evidence
1. Run:
   - `npm run typecheck`
   - `npm run test`
   - `npm run check`
   - `npm run verify:migrations:dr018`
   - `npm run test:e2e-local`
2. If environment permits, run `npm run test:integration-db:docker`.
3. Record actual outcomes (PASS/FAIL/BLOCKED with exact blocker reason).

Deliverables:
1. Evidence-ready command result list for closure report

Step 6: Publish corrected Wave 9 closure report
1. Update `docs/wave9-build-report.md` using fresh command outcomes.
2. Include open/deferred items with rationale and ownership.
3. State acceptance status for Step 2/10/11/12 (satisfied or explicitly deferred).

Deliverables:
1. Updated `docs/wave9-build-report.md`

Validation checklist (must run and report):
1. npm run typecheck
2. npm run test
3. npm run check
4. npm run verify:migrations:dr018
5. npm run test:e2e-local
6. npm run test:integration-db:docker (if environment permits)
7. npm run run:slo-rollup -- --mode dry-run --from <iso> --to <iso> --limit 100 (if DB is available)
8. node scripts/verify-governance-drift.mjs

Required final report format:
1. Step-by-step implementation summary mapped to Step 1..6
2. Exact files created/updated
3. Migration list with lock-risk and rollback notes
4. Commands executed with pass/fail results
5. Deferred items with explicit rationale
6. Explicit governance statement: no silent Open/Proposed -> Approved changes
7. Updated discover/plan/install/verify coverage matrix
8. Operational readiness notes (what is production-ready vs still gated)
9. Environment requirement matrix (required vs optional env vars by command/service)
10. Acceptance criteria status for Step 2/10/11/12
```
