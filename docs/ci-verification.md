# CI Verification and Blocker Interpretation

## Scope
Continuous validation contract for Wave 7 and later.

Workflow:
1. `.github/workflows/forge-ci.yml`

## Required checks
1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:integration-db:docker`

## CI assumptions
1. Node 22 runtime.
2. Docker available for integration-db flow.
3. No secret-dependent test paths in required jobs.

## Blocker interpretation
1. Typecheck/test/check failures are code regressions and block merges.
2. Migration verification failures (`verify:migrations:dr018`) are schema-governance blockers and block merges.
3. Integration-db docker failures are data-path correctness blockers and block merges.
4. Environment-only local command failures (for example `run:outbox` without DB URL) are treated as local operator blockers, not CI regressions.
