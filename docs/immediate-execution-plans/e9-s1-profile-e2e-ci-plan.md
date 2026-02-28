# E9-S1 Plan: Profile-Specific E2E Path in CI

Story: `E9-S1`
Owner: Platform (with Control Plane support)
Priority: `P0`
Status: Completed

## Objective

Add a profile-focused end-to-end test path to CI so profile lifecycle behavior is continuously validated beyond integration-db coverage.

## In Scope

1. Add a dedicated profile lifecycle e2e test flow.
2. Ensure the test runs in `npm run test:e2e-local`.
3. Ensure `forge-ci.yml` executes the profile e2e path via existing e2e job path.
4. Document expected behavior and failure interpretation.

## Out of Scope

1. New profile feature implementation.
2. Large refactor of existing e2e harness architecture.
3. DB-dependent profile e2e in required CI gates.

## Implementation Steps

1. Baseline current e2e behavior.

- Inspect `tests/e2e/discover-plan-apply-verify-local.e2e.test.ts` and `tests/e2e/install-runtime-local.e2e.test.ts`.
- Identify reusable harness helpers and idempotency patterns.

2. Add profile e2e scenario.

- Create `tests/e2e/profile-lifecycle-local.e2e.test.ts`.
- Cover: create profile -> export/import -> install (`plan_only` and `apply_verify`) -> verify status visibility.
- Keep deterministic in-memory/test-double behavior similar to existing e2e style.

3. Wire into e2e command.

- Confirm `npm run test:e2e-local` auto-discovers the new test.
- If discovery is constrained, update the `test:e2e-local` script in `package.json`.

4. CI and docs update.

- Update `docs/ci-verification.md` to include profile e2e evidence.
- If needed, add explicit e2e step naming in `.github/workflows/forge-ci.yml` for traceability.

5. Validation and reporting.

- Run all shared quality gates plus any targeted e2e reruns.
- Record results in `docs/wave9-build-report.md` or a new execution note.

## File Touchpoints

1. `tests/e2e/profile-lifecycle-local.e2e.test.ts` (new)
2. `package.json` (if e2e script updates are needed)
3. `.github/workflows/forge-ci.yml` (optional traceability step)
4. `docs/ci-verification.md`
5. `docs/wave9-build-report.md` (or follow-on report)

## Validation Commands

1. `npm run test:e2e-local`
2. `npm run test`
3. `npm run check`
4. `npm run typecheck`

## Risks and Mitigations

1. Risk: brittle e2e fixtures.
   Mitigation: reuse existing deterministic harness patterns and avoid time-sensitive assertions.

2. Risk: duplicate coverage with integration-db tests.
   Mitigation: keep e2e focused on API-level behavior and user-visible lifecycle sequence.

## Exit Criteria

1. Profile lifecycle e2e test exists and passes locally.
2. CI executes the profile e2e path through the standard e2e command.
3. CI verification doc is updated with explicit profile e2e evidence.

## Execution Notes (2026-02-28)

1. Changed files:
   - `tests/e2e/profile-lifecycle-local.e2e.test.ts`
   - `docs/ci-verification.md`
   - `docs/wave9-execution-plan.md`
   - `docs/wave9-build-report.md`
   - `.github/workflows/forge-ci.yml` (closure fix: explicit `test:e2e-local` CI step)
2. Commands run and results:
   - `npm run test:e2e-local` -> PASS
   - `npm run test` -> PASS
   - `npm run check` -> PASS
   - `npm run typecheck` -> PASS
3. Deferred items:
   - none for `E9-S1`.
