# Phase 3 Execution Plans (Post-Phase-2 RC + Beta Readiness)

Date: 2026-02-28
Scope: Move Forge from implementation-complete `P0` slices to release-candidate and beta-readiness by closing docs/source drift, operationalizing trust-gate flows, and delivering distribution + beta launch artifacts.

## Entry Criteria

1. Phase 2 plans (`E1`, `E2-S2/S3`, `E3-S2/S3`, `E4`, `E5-S2/S3`, `E6`, `E9-S3`) are marked done.
2. Required CI remains green: `typecheck`, `test`, `check`, `test:e2e-local`, `verify:migrations:dr018`, `test:integration-db:docker`.
3. Release workflow includes artifact checksums/signatures and evidence/sign-off validation.
4. Governance boundary is explicit: AQ/MQ/DR status is never silently promoted to `Approved`.

## Plan Documents

1. [Docs and Migration Reconciliation Plan](./docs-and-migration-reconciliation-plan.md)
2. [Trust-Gate Operations Hardening Plan](./trust-gate-operations-hardening-plan.md)
3. [E9-S4 Distribution and Upgrade Policy Plan](./e9-s4-distribution-upgrade-policy-plan.md)
4. [E10-S1 Beta Pilot Execution Plan](./e10-s1-beta-pilot-execution-plan.md)
5. [E10-S2/S3 Triage and GA Decision Gate Plan](./e10-s2-s3-triage-and-ga-decision-gate-plan.md)

## Shared Quality Gates

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`
7. `npx vitest run tests/contract/migration-wave10.contract.test.ts`
8. `npx vitest run tests/integration-db/security-trust-gates.integration-db.test.ts --maxWorkers=1`
9. `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger phase3-readiness` (if DB available)

## Exit Criteria

1. Migration ordering policy is unambiguous and reflected in source/tests/docs.
2. Root/docs/backlog indexes describe the same post-Phase-2 baseline and remaining scope.
3. Trust-gate operations are executable via operator scripts with dry-run/production controls.
4. Ops smoke includes trust-gate dry-run checks with artifact retention and explicit outcome rows.
5. E9-S4 distribution/upgrade policy is documented and enforced by release guardrails.
6. E10-S1/S2/S3 artifacts exist and are executable for beta pilot, triage, and GA decisions.
7. Validation evidence is published with PASS/FAIL/BLOCKED outcomes and explicit blockers.

## Governance and Safety Guardrails

1. Preserve idempotency behavior: same idempotency key + same hash => replay; different hash => conflict.
2. Keep migrations additive/forward-only with lock-risk and rollback guidance.
3. Keep privacy posture: no plaintext secret persistence and no unsafe telemetry persistence.
4. Treat environment preconditions as explicit blockers, not regressions.
