# CI Verification and Blocker Interpretation

## Scope

Continuous validation contract for Wave 7 and later (updated for Wave 9).

Workflow:

1. `.github/workflows/forge-ci.yml`

## Required checks

1. `npm run typecheck`
2. `npm run test`
3. `npm run check` (includes `check:governance` -> `scripts/verify-governance-drift.mjs`)
4. `npm run test:e2e-local` (includes profile lifecycle e2e coverage)
5. `npm run verify:migrations:dr018`
6. `npm run test:integration-db:docker`

## Wave 9 test additions

1. SLO rollup unit tests: `packages/security-governance/tests/slo-rollup.test.ts` (9 tests) — runs as part of `npm run test`.
2. SLO rollup integration-db tests: `tests/integration-db/slo-rollup.integration-db.test.ts` (4 tests) — runs as part of `npm run test:integration-db:docker`.
3. Wave 9 migration contract test: `tests/contract/migration-wave9.contract.test.ts` — validates migration 013 structure.
4. Profile bundle integration-db tests: `tests/integration-db/profile-bundle.integration-db.test.ts` — validates profile lifecycle against real Postgres.

## Optional operator-level checks (not CI-required)

1. `node scripts/run-slo-rollup.mjs --mode dry-run` — requires `FORGE_DATABASE_URL`.
2. `node scripts/verify-governance-drift.mjs` — governance drift detection (no DB required).

## Profile e2e coverage (E9-S1 — implemented)

1. `tests/e2e/profile-lifecycle-local.e2e.test.ts` — 6 tests covering create → get → list → export → import → install (plan_only) → install (apply_verify) → run retrieval → optional-package skip.
2. Runs as part of `npm run test:e2e-local` (auto-discovered).
3. Uses in-memory adapters; no DB required.

## Step 10 CI expansion status

1. Profile-specific e2e scenario is implemented as `tests/e2e/profile-lifecycle-local.e2e.test.ts` (E9-S1) and is executed by required CI via `.github/workflows/forge-ci.yml` (`npm run test:e2e-local`).
2. Ops smoke workflow is implemented as `.github/workflows/forge-ops-smoke.yml` (E9-S2). It remains intentionally non-blocking (`workflow_dispatch` + nightly cron) and runs retrieval-sync, outbox, dead-letter list, and SLO rollup in dry-run mode against ephemeral Postgres.
3. Decision references: `DECISION_LOG.md` (`DLOG-0036`, `DLOG-0037`) and `docs/wave9-build-report.md`.

## CI assumptions

1. Node 22 runtime.
2. Docker available for integration-db flow.
3. No secret-dependent test paths in required jobs.

## Blocker interpretation

1. Typecheck/test/check failures are code regressions and block merges.
2. Migration verification failures (`verify:migrations:dr018`) are schema-governance blockers and block merges.
3. Integration-db docker failures are data-path correctness blockers and block merges.
4. Environment-only local command failures (for example `run:outbox` without DB URL) are treated as local operator blockers, not CI regressions.
5. Governance drift checker failures indicate undocumented status changes and should be investigated before merging.
