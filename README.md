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

## Current Repository State (Post Wave 7 + Wave 8 Foundations + In-Progress Wave 9)

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

Wave 9 additions (in-progress):
1. Operational SLO rollup module (`packages/security-governance/src/slo-rollup.ts`) with deterministic metric computation across 7 SLO metric families.
2. Additive migration `013_operational_slo_rollup_foundations.sql` introducing `operational_slo_rollup_runs` and `operational_slo_snapshots`.
3. SLO rollup operator runner (`scripts/run-slo-rollup.mjs`) with `--mode dry-run|production`, `--from`, `--to`, `--limit`, deterministic run IDs, and structured logs.
4. SLO rollup unit tests (`packages/security-governance/tests/slo-rollup.test.ts`) and integration-db tests (`tests/integration-db/slo-rollup.integration-db.test.ts`).
5. Event ownership matrix codified in `docs/wave9-execution-plan.md` with producer→dispatcher→handler→side-effects mapping for all 9 supported event types plus explicit `metrics.aggregate.requested` non-support.
6. Hermetic local dependency stack via `docker-compose.yml` (Postgres 16 + Qdrant) with bootstrap/teardown scripts.
7. Wave 9 execution plan (`docs/wave9-execution-plan.md`) with step matrix, acceptance gates, and validation commands.

Current verified baseline:
1. `npm run typecheck` passes.
2. `npm run test` passes.
3. `npm run check` passes.
4. `npm run verify:migrations:dr018` passes.
5. `npm run test:e2e-local` passes.
6. `npm run test:integration-db:docker` passes.

Known gaps (Wave 9 in-progress):
1. Governance automation gap: AQ/MQ/DR status boundaries are documented but still rely on manual discipline (no CI-enforced contract check for silent status drift). Governance drift checker script pending.
2. Runbook gap: profile operations, SLO rollup, and event-family ownership runbooks not yet published.
3. Build report gap: Wave 8 and Wave 9 build reports not yet published.
4. CI expansion gap: SLO rollup integration-db test not yet wired into docker CI flow; ops smoke workflow pending.

Important governance boundary:
1. DR/AQ/MQ statuses remain `Proposed` / `Open` unless explicitly approved.

## Documentation Map

1. Product and architecture decisions: `application_decision_records.md`
2. Open architecture/product questions: `application_master_open_questions.md`, `master_open_questions.md`
3. Execution guardrails: `OPEN_QUESTIONS_TRACKER.md`, `DECISION_LOG.md`
4. Operational runbooks: `docs/runbooks/`
5. CI and validation contract: `docs/ci-verification.md`
6. Prior wave summaries:
   - `docs/wave3-build-report.md`
   - `docs/wave4-build-report.md`
   - `docs/wave5-build-report.md`
   - `docs/wave6-build-report.md`
   - `docs/wave7-build-report.md`
7. Execution plans: `docs/wave6-execution-plan.md`, `docs/wave7-execution-plan.md`, `docs/wave9-execution-plan.md`

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
npm run run:control-plane
node scripts/run-slo-rollup.mjs --mode dry-run --from 2026-02-28T00:00:00Z --to 2026-02-28T12:00:00Z --limit 100
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
6. Wave 8 build report pending (profile/bundle foundations complete in source).
7. Wave 9 build report pending (SLO rollup, docker-compose, governance automation in progress).

## Next Steps Build Prompt (Wave 9)

Use the prompt below for the next implementation wave (Wave 9). It is based on current source + docs status as of **2026-02-28**.

```text
You are an implementation agent working in /home/azureuser/ai-cli-web-funnel.

Mission:
Deliver Wave 9 by closing profile/bundle orchestration, observability, and governance-automation gaps so Forge can run discover/plan/install/verify plus profile-based multi-package workflows with production-grade operator confidence.

North-star loop:
1. discover
2. plan
3. install
4. verify

Every step in this build must explicitly improve one or more loop stages.

Current ground truth (do not reinterpret):
1. Discover/plan/install/verify HTTP paths are implemented in `apps/control-plane/src/http-app.ts`, with lifecycle orchestration in `apps/control-plane/src/install-lifecycle.ts`.
2. Catalog read/search routes are live with ranking lineage and semantic fallback metadata (`apps/control-plane/src/catalog-routes.ts`, `packages/ranking/src/index.ts`).
3. Retrieval bootstrap is concretely wired (`apps/control-plane/src/retrieval-bootstrap.ts`, `apps/control-plane/src/server-main.ts`) and can fail-close readiness when `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true`.
4. Retrieval sync/backfill is implemented (`packages/ranking/src/retrieval-sync.ts`, `scripts/run-retrieval-sync.mjs`) and ranking outbox execution path exists.
5. Runtime verifier wiring is env-driven for flags + remote auth + secret-ref + OAuth (`apps/control-plane/src/runtime-feature-flags.ts`, `apps/control-plane/src/runtime-remote-config.ts`) with startup env matrix validation in `apps/control-plane/src/startup-env-validation.ts`.
6. Outbox processor supports `dry-run`/`shadow`/`production` and internal side-effect persistence (`scripts/run-outbox-processor.mjs`, `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`, migrations `010` and `011`).
7. Signed security report ingestion publishes `security.report.accepted` and `security.enforcement.recompute.requested` events (`packages/security-governance/src/index.ts`), and dispatcher support for `security.report.accepted` exists (`packages/security-governance/src/outbox-dispatcher.ts`).
8. Profile bundle foundations exist in source: profile routes, adapters, contracts, and additive migration `012_profile_bundle_foundations.sql`.
9. Profile install foundations currently create per-package plans, but profile run-plan linkage/status advancement is incomplete for full apply/verify lifecycle accounting.
10. Baseline validation currently passes (Wave 7 evidence): `npm run typecheck`, `npm run test`, `npm run check`, `npm run verify:migrations:dr018`, `npm run test:e2e-local`, `npm run test:integration-db:docker`.
11. CI currently enforces baseline + integration-db docker flow only; no explicit governance drift checker or profile-flow-specific gate exists.

Non-negotiable constraints:
1. Do not silently change AQ/MQ/DR status from Open/Proposed to Approved.
2. Keep additive forward-only migrations; include lock-risk and rollback notes in migration headers.
3. Preserve idempotency semantics everywhere: same key + same hash => replay, same key + different hash => conflict.
4. Keep privacy constraints intact (no raw IP/fingerprint/raw user-agent/raw install command persistence).
5. Never persist plaintext remote secrets; persist secret_ref only.
6. Keep compatibility bridge posture for registry.packages/public.registry_packages until explicit governance approval changes it.
7. Treat missing env/dependency blockers as explicit blockers, not silent regressions (for example missing DB URL or unavailable Qdrant).
8. Do not weaken deterministic outbox safety invariants (`dedupe_key`, replay ledger, effect dedupe).
9. Keep profile and install lifecycle changes backward compatible for existing `/v1/install/plans/*` clients.
10. Keep unsupported-event behavior explicit for unknown event families.

Implementation steps:

Step 1: Establish Wave 9 traceability and acceptance gates
1. Create `docs/wave9-execution-plan.md` with one row per step including:
   - target loop stage(s): discover/plan/install/verify
   - risk level
   - migration impact
   - required tests
   - related AQ/MQ/DR IDs
2. Define hard acceptance criteria for each step before code changes begin.

Deliverables:
1. `docs/wave9-execution-plan.md`
2. Updated `DECISION_LOG.md` entry for initial Wave 9 scope lock

Step 2: Reconcile docs with actual source state
1. Update `README.md` and `docs/README.md` to accurately reflect:
   - profile/bundle foundations and migration `012`
   - supported deterministic outbox event families
   - current verified baseline vs in-progress work
2. Add explicit "what is implemented vs what is verified" boundaries to avoid ambiguous claims.

Deliverables:
1. Updated root and docs index documentation
2. Drift note section in `docs/wave9-execution-plan.md` linking source evidence

Step 3: Harden profile API contract and request validation
1. Add strict validation for profile create/import/install inputs (required fields, package order uniqueness, UUID format checks, bounds).
2. Ensure list endpoints support bounded pagination/filtering safely and deterministically.
3. Add explicit error taxonomy for profile endpoints matching existing API style.

Deliverables:
1. Updated `apps/control-plane/src/http-app.ts` and `apps/control-plane/src/profile-routes.ts`
2. Expanded unit tests for profile route validation and error mapping

Step 4: Complete profile install-run orchestration accounting
1. Persist `profile_install_run_plans` links for each created install plan.
2. Advance per-plan statuses (`planned -> applied -> verified` or `failed/skipped`) from lifecycle outcomes.
3. Ensure profile run aggregate counts and final statuses are derived from persisted per-plan outcomes, not only in-memory counters.
4. Keep replay-safe behavior for duplicate requests.

Deliverables:
1. Updated `apps/control-plane/src/profile-routes.ts` and `apps/control-plane/src/profile-postgres-adapters.ts`
2. Integration-db coverage proving run-plan linkage and status progression

Step 5: Add optional profile install execution mode for full lifecycle
1. Introduce explicit install mode semantics (`plan_only` default, optional `apply_verify`) for profile install calls.
2. When `apply_verify` is enabled, run plan -> apply -> verify per package with deterministic idempotency and persisted attempt linkage.
3. Preserve backward compatibility for current behavior.

Deliverables:
1. Updated profile install service and API contract docs
2. Tests covering both modes and replay/conflict behavior

Step 6: Close event-family ownership and `metrics.aggregate.requested` contract drift
1. Build an event ownership matrix mapping producer -> dispatcher path -> handler -> side effects.
2. Decide and codify disposition for `metrics.aggregate.requested`:
   - implement producer + handler path, or
   - remove contract surface and document explicit non-support.
3. Keep unsupported unknown event behavior deterministic and test-covered.

Deliverables:
1. Updated event ownership docs in `docs/wave9-execution-plan.md`
2. Corresponding code/tests for chosen `metrics.aggregate.requested` path

Step 7: Introduce operational SLO rollup foundations
1. Define Wave 9 SLO metrics for:
   - outbox dispatch success/failure/dead-letter rate
   - retrieval semantic fallback rate
   - install apply/verify success and replay ratio
   - profile install run completion/partial-failure rate
   - governance recompute latency
2. Add additive persistence for SLO snapshots and rollup metadata.
3. Implement deterministic rollup service that reads operational tables and writes snapshot rows.

Deliverables:
1. New SLO rollup module(s) under `packages/security-governance/src/` (or justified location)
2. Additive migration `infra/postgres/migrations/013_*.sql`
3. Contract and integration-db tests for rollup determinism

Step 8: Add first-class operator runner for SLO rollups
1. Add script (for example `scripts/run-slo-rollup.mjs`) with `dry-run` and `production` modes.
2. Include bounded window flags (`--from`, `--to`, `--limit`) and deterministic run IDs.
3. Emit structured logs with non-secret payloads and explicit failure class.

Deliverables:
1. New operator script under `scripts/`
2. Script-level tests and usage docs

Step 9: Build hermetic local dependency stack for operator flows
1. Add reproducible local stack (Postgres + Qdrant + optional embedding stub/proxy) for end-to-end operator commands.
2. Provide one-command bootstrap/teardown scripts.
3. Ensure retrieval sync, outbox, dead-letter, and SLO rollup commands can run in this stack without manual secret hunting.

Deliverables:
1. Local stack assets (`docker-compose` and helper scripts/docs)
2. Updated `.env.example` and setup instructions

Step 10: Expand tests and CI coverage for Wave 9 capabilities
1. Keep required baseline checks intact.
2. Add required contract checks for migration `012` (and any `013` migration added in this wave).
3. Add integration-db coverage for profile install run-plan linkage and status progression.
4. Add e2e/local scenario for profile create -> install -> verify visibility.
5. Add non-required but automated ops smoke workflow (nightly/manual) that runs hermetic retrieval-sync + outbox + dead-letter + SLO rollup dry-runs.

Deliverables:
1. New/updated tests under `tests/contract`, `tests/integration-db`, and `tests/e2e`
2. Updated `.github/workflows/forge-ci.yml` and `docs/ci-verification.md`

Step 11: Runbook and governance automation refresh
1. Update runbooks to include profile operations, event-family ownership decisions, and SLO rollup operations:
   - `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
   - `docs/runbooks/outbox-dead-letter-requeue.md`
   - `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
   - `docs/runbooks/semantic-retrieval-incident-fallback.md`
   - add a new profile lifecycle runbook if needed
2. Include exact commands and troubleshooting matrix (`symptom -> cause -> fix`).
3. Add a lightweight checker script to detect silent AQ/MQ/DR status changes without corresponding decision-log updates.
4. Wire the checker into `npm run check` or CI as agreed in the execution plan.

Deliverables:
1. Updated runbooks with Wave 9 operator paths
2. Governance consistency checker + CI/check integration notes

Step 12: Governance and reporting closure for Wave 9
1. Update `DECISION_LOG.md` with implementation-time decisions and linked AQ/MQ/DR IDs.
2. Keep unresolved governance items in Open/Proposed status.
3. Publish `docs/wave9-build-report.md` with evidence-based status and explicit deferred/blocker items.

Deliverables:
1. `DECISION_LOG.md` updates
2. `docs/wave9-build-report.md`

Validation checklist (must run and report):
1. npm run typecheck
2. npm run test
3. npm run check
4. npm run verify:migrations:dr018
5. npm run test:e2e-local
6. npm run test:integration-db:docker
7. npx vitest run tests/integration-db/profile-bundle.integration-db.test.ts --maxWorkers=1
8. npx vitest run tests/integration-db/outbox-dispatcher.integration-db.test.ts --maxWorkers=1
9. npx vitest run tests/contract --maxWorkers=1
10. npm run run:catalog-ingest -- --mode dry-run --input <fixture-json>
11. npm run run:retrieval-sync -- --mode dry-run --limit 25
12. npm run run:outbox -- --mode dry-run --limit 25
13. npm run run:outbox-dead-letter -- --action list --limit 25
14. Any new Wave 9 SLO rollup dry-run command(s)
15. Any new targeted Wave 9 suites introduced during implementation

Required final report format:
1. Step-by-step implementation summary mapped to Step 1..12
2. Exact files created/updated
3. Migration list with lock-risk and rollback notes
4. Commands executed with pass/fail results
5. Deferred items with explicit rationale
6. Explicit governance statement: no silent Open/Proposed -> Approved changes
7. Updated discover/plan/install/verify coverage matrix
8. Operational readiness notes (what is production-ready vs still gated)
9. Environment requirement matrix (required vs optional env vars by command/service)
10. Event-family ownership matrix (producer -> dispatcher -> handler -> side effects)
11. Profile lifecycle coverage matrix (`create/list/get/export/import/install/get-install-run`) with test evidence
12. SLO coverage table with calculation source and validation evidence
```
