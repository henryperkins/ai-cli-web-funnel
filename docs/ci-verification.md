# CI Verification and Blocker Interpretation

## Scope
Continuous validation contract for Wave 7 and later (updated for Wave 9).

Workflow:
1. `.github/workflows/forge-ci.yml`

## Required checks
1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:integration-db:docker`

## Wave 9 test additions
1. SLO rollup unit tests: `packages/security-governance/tests/slo-rollup.test.ts` (9 tests) — runs as part of `npm run test`.
2. SLO rollup integration-db tests: `tests/integration-db/slo-rollup.integration-db.test.ts` (4 tests) — runs as part of `npm run test:integration-db:docker`.
3. Wave 9 migration contract test: `tests/contract/migration-wave9.contract.test.ts` — validates migration 013 structure.
4. Profile bundle integration-db tests: `tests/integration-db/profile-bundle.integration-db.test.ts` — validates profile lifecycle against real Postgres.

## Optional operator-level checks (not CI-required)
1. `node scripts/run-slo-rollup.mjs --mode dry-run` — requires `FORGE_DATABASE_URL`.
2. `node scripts/verify-governance-drift.mjs` — governance drift detection (no DB required).

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
