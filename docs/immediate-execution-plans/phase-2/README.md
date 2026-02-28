# Phase 2 Execution Plans (Post-Immediate)

Date: 2026-02-28
Scope: Remaining `P0` execution plans after completing the immediate plan set (`E9-S1`, `E9-S2`, `E2-S1`, `E3-S1`, `E5-S1`).

## Entry Criteria

1. Immediate plan set is complete with evidence.
2. `npm run check`, `npm run verify:migrations:dr018`, `npm run test:e2e-local`, and `npm run test:integration-db:docker` are green.
3. Any deferrals from immediate plans are explicitly tracked in docs and `DECISION_LOG.md`.

## Plan Documents

1. [E1 Contract and Scope Freeze Plan](./e1-contract-scope-freeze-plan.md)
2. [E2-S2/S3 Catalog Scale Plan](./e2-s2-s3-catalog-scale-plan.md)
3. [E3-S2/S3 Plan Engine Hardening Plan](./e3-s2-s3-plan-engine-hardening-plan.md)
4. [E4 Adapter Expansion and Runtime Verification Plan](./e4-adapter-expansion-runtime-verification-plan.md)
5. [E5-S2/S3 Remove and Rollback Plan](./e5-s2-s3-remove-rollback-plan.md)
6. [E6 Security and Governance Enforcement Plan](./e6-security-governance-enforcement-plan.md)
7. [E9-S3 Release Checklist and Artifact Signature Plan](./e9-s3-release-checklist-signature-plan.md)

## Current Status (2026-02-28)

1. `E1`: Done
2. `E2-S2/S3`: Done
3. `E3-S2/S3`: Done
4. `E4`: Done (GA scope lock documented)
5. `E5-S2/S3`: Done
6. `E6`: In Progress (implementation complete; governance approvals remain explicit/manual)
7. `E9-S3`: Done

## Suggested Execution Sequence

1. Execute `E1` first to freeze contracts and reduce downstream churn.
2. Run `E2-S2/S3` and `E3-S2/S3` in parallel once contract freeze is accepted.
3. Run `E4` after compatibility matrix and planner conflict model are stable.
4. Run `E5-S2/S3` after update/remove semantics are aligned with adapter capabilities.
5. Run `E6` continuously in parallel, with final governance closure after enforcement behavior is proven.
6. Complete `E9-S3` once all required implementation gates are green.

## Shared Quality Gates

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`

## Reporting Requirements

1. Each executed plan publishes an execution note: changed files, commands run, outcomes, blockers, and deferred items.
2. Governance-sensitive changes update `DECISION_LOG.md` in the same change set.
3. Any migration must include lock-risk and rollback notes in migration headers.
