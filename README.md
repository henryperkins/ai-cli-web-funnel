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

## Current Repository State (Post Wave 7)

Implemented in source + tests:
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
16. Migration set: additive migrations `001..011` with DR-018 verification guard (`scripts/verify-dr018-migration.mjs`) and Wave 7 migration contract coverage.

Current verified baseline:
1. `npm run typecheck` passes.
2. `npm run test` passes.
3. `npm run check` passes.
4. `npm run verify:migrations:dr018` passes.
5. `npm run test:e2e-local` passes.
6. `npm run test:integration-db:docker` passes.

Known gaps to drive the next wave:
1. Event-family mismatch: `security.report.accepted` is produced by signed-report ingestion, but deterministic internal dispatch does not support it (risk: `unsupported_event_type` when `OUTBOX_INTERNAL_DISPATCH=true`).
2. Contract drift risk: `metrics.aggregate.requested` exists in ingestion outbox typings, but no concrete producer/dispatcher/runner path is implemented.
3. Observability gap: no first-class SLO rollup pipeline yet for outbox, retrieval fallback, lifecycle apply/verify, and governance latency contracts (`AQ-054`, `MQ-038` remain `Proposed`).
4. Operator readiness gap: retrieval/outbox/dead-letter runtime commands remain environment-blocked without a reproducible local dependency stack (DB + retrieval dependencies), so smoke validation is not hermetic.
5. Governance automation gap: AQ/MQ/DR status boundaries are documented but still rely on manual discipline (no CI-enforced contract check for silent status drift).

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
```

## Integration DB Prerequisites

1. `npm run test:integration-db` requires `FORGE_INTEGRATION_DB_URL` pointing to a Postgres instance with migrations applied.
2. `npm run test:integration-db:docker` provisions an ephemeral Docker Postgres instance, applies migrations `001..011`, and runs the integration-db suite automatically.

## Wave Build Reports

1. `docs/wave3-build-report.md`
2. `docs/wave4-build-report.md`
3. `docs/wave5-build-report.md`
4. `docs/wave6-build-report.md`
5. `docs/wave7-build-report.md`

## Next Steps Build Prompt (Wave 8)

Use the prompt below for the next implementation wave (Wave 8). It is based on current source + docs status as of **2026-02-28**.

```text
You are an implementation agent working in /home/azureuser/ai-cli-web-funnel.

Mission:
Deliver Wave 8 event-family closure and operational observability hardening so Forge can run discover/plan/install/verify plus async governance paths with no unsupported outbox events, measurable SLOs, and reproducible operator validation.

North-star loop:
1. discover
2. plan
3. install
4. verify

Every step in this build must explicitly improve one or more loop stages.

Current ground truth (do not reinterpret):
1. Discover/plan/install/verify HTTP paths are implemented in `apps/control-plane/src/http-app.ts`, with lifecycle orchestration in `apps/control-plane/src/install-lifecycle.ts` (`install` execution uses `POST /v1/install/plans/:plan_id/apply`).
2. Catalog read/search routes are live with ranking lineage and semantic fallback metadata (`apps/control-plane/src/catalog-routes.ts`, `packages/ranking/src/index.ts`).
3. Retrieval bootstrap is concretely wired (`apps/control-plane/src/retrieval-bootstrap.ts`, `apps/control-plane/src/server-main.ts`) and can fail-close readiness when `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true`.
4. Retrieval sync/backfill is implemented (`packages/ranking/src/retrieval-sync.ts`, `scripts/run-retrieval-sync.mjs`) and ranking outbox execution path exists.
5. Runtime verifier wiring is env-driven for flags + remote auth + secret-ref + OAuth (`apps/control-plane/src/runtime-feature-flags.ts`, `apps/control-plane/src/runtime-remote-config.ts`) with startup env matrix validation in `apps/control-plane/src/startup-env-validation.ts`.
6. Outbox processor supports `dry-run`/`shadow`/`production` and internal side-effect persistence (`scripts/run-outbox-processor.mjs`, `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`, migrations `010` and `011`).
7. Signed security report ingestion publishes `security.report.accepted` and `security.enforcement.recompute.requested` events (`packages/security-governance/src/index.ts`).
8. Deterministic internal outbox dispatcher currently supports only: `fraud.reconcile.requested`, `ranking.sync.requested`, `security.enforcement.recompute.requested`, `install.plan.created`, `install.apply.*`, `install.verify.*` (`packages/security-governance/src/outbox-dispatcher.ts`).
9. Ingestion event contract still declares `metrics.aggregate.requested` but no production path emits/handles it (`apps/control-plane/src/index.ts`).
10. Baseline validation currently passes: `npm run typecheck`, `npm run test`, `npm run check`, `npm run verify:migrations:dr018`, `npm run test:e2e-local`, `npm run test:integration-db:docker`.

Non-negotiable constraints:
1. Do not silently change AQ/MQ/DR status from Open/Proposed to Approved.
2. Keep additive forward-only migrations; include lock-risk and rollback notes in migration headers.
3. Preserve idempotency semantics everywhere: same key + same hash => replay, same key + different hash => conflict.
4. Keep privacy constraints intact (no raw IP/fingerprint/raw user-agent/raw install command persistence).
5. Never persist plaintext remote secrets; persist secret_ref only.
6. Keep compatibility bridge posture for registry.packages/public.registry_packages until explicit governance approval changes it.
7. Treat missing env/dependency blockers as explicit blockers, not silent regressions (for example missing DB URL or unavailable Qdrant).
8. Do not weaken deterministic outbox safety invariants (`dedupe_key`, replay ledger, effect dedupe).
9. Keep legacy behavior backward compatible for existing event types while extending dispatcher/event coverage.

Implementation steps:

Step 1: Establish Wave 8 traceability and acceptance gates
1. Create `docs/wave8-execution-plan.md` with one row per step including:
   - target loop stage(s): discover/plan/install/verify
   - risk level
   - migration impact
   - required tests
   - related AQ/MQ/DR IDs
2. Define hard acceptance criteria for each step before code changes begin.

Deliverables:
1. `docs/wave8-execution-plan.md`
2. Updated `DECISION_LOG.md` entry for initial Wave 8 scope lock

Step 2: Close outbox event-family mismatch and unsupported-event failures
1. Build an event ownership matrix mapping every produced `event_type` to dispatch path(s), handler, and expected side effects.
2. Extend deterministic internal dispatch support to cover `security.report.accepted` (currently produced but unsupported).
3. Decide and codify handling for `metrics.aggregate.requested`: implement producer+handler path or remove dead contract surface with explicit decision log entry.
4. Keep unsupported-event behavior deterministic and explicit for truly unknown event families.

Deliverables:
1. Updated outbox dispatcher contract (`packages/security-governance/src/outbox-dispatcher.ts`)
2. Updated internal handler implementation/tests for newly supported event families
3. Event ownership documentation section in `docs/wave8-execution-plan.md`

Step 3: Promote security/governance async effects from record-only to actionable outcomes
1. For `security.report.accepted`, implement concrete downstream effect path (for example notification enqueue, review queue marker, or metrics trigger), not just unsupported/dead-letter behavior.
2. For `security.enforcement.recompute.requested`, ensure recompute side effects are observable in durable storage and integration-db tests.
3. Keep effect rows append-only and replay-safe.

Deliverables:
1. Updated `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`
2. Integration-db coverage proving effect semantics and replay behavior

Step 4: Introduce operational SLO rollup foundations
1. Define Wave 8 SLO metrics for:
   - outbox dispatch success/failure/dead-letter rate
   - retrieval semantic fallback rate
   - install apply/verify success and replay ratio
   - governance recompute latency
2. Add additive persistence for SLO snapshots and rollup metadata.
3. Implement deterministic rollup service that reads existing operational tables and writes snapshot rows.

Deliverables:
1. New SLO rollup module(s) under `packages/security-governance/src/` or clearly justified location
2. Additive migration `infra/postgres/migrations/012_*.sql`
3. Contract and integration-db tests for rollup determinism

Step 5: Add first-class operator runner for SLO rollups
1. Add script (for example `scripts/run-slo-rollup.mjs`) with `dry-run` and `production` modes.
2. Include bounded window flags (`--from`, `--to`, `--limit`) and deterministic run IDs.
3. Emit structured logs with non-secret payloads and explicit failure class.

Deliverables:
1. New operator script under `scripts/`
2. Script-level tests and usage docs

Step 6: Build hermetic local dependency stack for operator flows
1. Add reproducible local stack (Postgres + Qdrant + optional embedding stub/proxy) for end-to-end operator commands.
2. Provide one-command bootstrap/teardown scripts.
3. Ensure retrieval sync and outbox commands can run in this stack without manual secret hunting.

Deliverables:
1. Local stack assets (`docker-compose` and helper scripts/docs)
2. Updated `.env.example` and setup instructions

Step 7: Add full async path integration tests
1. Add integration-db scenario covering:
   - security report accepted -> outbox enqueue -> internal dispatch -> deterministic side effects
   - ranking sync dispatch path coexistence
   - dead-letter and replay behavior for new event family coverage
2. Add deterministic assertions for new SLO rollup output rows.

Deliverables:
1. New/updated tests under `tests/integration-db/`
2. Evidence of idempotent replay safety across new paths

Step 8: Harden external dispatch contract
1. Define and enforce payload contract versioning for HTTP dispatch (`event_type`, `dedupe_key`, `outbox_job_id`, `correlation_id`, `payload`).
2. Add optional request signing/header contract for outbound dispatch calls.
3. Preserve retry taxonomy: transient vs permanent classification remains deterministic.

Deliverables:
1. Updated `scripts/run-outbox-processor.mjs` external dispatch path
2. Tests for contract validation/signing/failure classification

Step 9: Expand CI coverage for Wave 8 capabilities
1. Keep required baseline checks intact.
2. Add required contract checks for new migration and outbox event-family coverage tests.
3. Add non-required but automated ops smoke workflow (nightly/manual) that runs hermetic retrieval-sync + outbox + dead-letter + SLO rollup dry-runs.

Deliverables:
1. Updated `.github/workflows/forge-ci.yml` and/or additional workflow files
2. Updated `docs/ci-verification.md`

Step 10: Runbook and operator docs refresh
1. Update runbooks to include new event-family behavior and SLO rollup operations:
   - `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
   - `docs/runbooks/outbox-dead-letter-requeue.md`
   - `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
   - `docs/runbooks/semantic-retrieval-incident-fallback.md`
2. Include exact commands and troubleshooting matrix (`symptom -> cause -> fix`).

Deliverables:
1. Updated runbooks with Wave 8 operator paths
2. Explicit note of required env/dependencies for each command

Step 11: Governance consistency automation
1. Add a lightweight check script to detect silent status changes in AQ/MQ/DR artifacts without corresponding decision-log updates.
2. Wire it into `npm run check` or CI as agreed in the execution plan.
3. Keep this as a consistency guard, not an approval system.

Deliverables:
1. New governance consistency checker script
2. CI/check integration and docs note

Step 12: Governance and reporting closure for Wave 8
1. Update `DECISION_LOG.md` with implementation-time decisions and linked AQ/MQ/DR IDs.
2. Keep unresolved governance items in Open/Proposed status.
3. Publish `docs/wave8-build-report.md` with evidence-based status and explicit deferred/blocker items.

Deliverables:
1. `DECISION_LOG.md` updates
2. `docs/wave8-build-report.md`

Validation checklist (must run and report):
1. npm run typecheck
2. npm run test
3. npm run check
4. npm run verify:migrations:dr018
5. npm run test:e2e-local
6. npm run test:integration-db:docker
7. npm run run:outbox -- --mode dry-run --limit 25
8. npm run run:catalog-ingest -- --mode dry-run --input <fixture-json>
9. npm run run:retrieval-sync -- --mode dry-run --limit 25
10. npm run run:outbox-dead-letter -- --action list --limit 25
11. Any new Wave 8 SLO rollup dry-run command(s)
12. Any new targeted Wave 8 suites introduced during implementation

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
11. SLO coverage table with calculation source and validation evidence
```
