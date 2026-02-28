# Phase 3 Plan: Docs and Migration Reconciliation

Owner: Platform Foundations
Priority: `P0`
Status: In Progress (2026-02-28)

## Objective

Remove source/docs drift for migration sequencing and post-Phase-2 status so release evidence has one deterministic narrative.

## In Scope

1. Resolve duplicate-prefix migration ambiguity (`015` collision) with deterministic ordering policy.
2. Update migration contract tests and runbooks to match actual migration files/order.
3. Align root/docs indexes with implemented trust-gate and migration capabilities.
4. Remove stale "Immediate Next Sprint" items that are already complete.

## Out of Scope

1. New schema features unrelated to migration/order reconciliation.
2. Approval-state changes for AQ/MQ/DR records.

## Implementation Steps

1. Renumber trust-gate migration from `015_*` to `016_*` and update references/tests.
2. Update migration rollout runbook with `015 -> 016` ordering, lock-risk notes, and rollback guidance.
3. Reconcile `README.md`, `docs/README.md`, and backlog/index docs to current baseline.
4. Re-verify deterministic ordering in docker migration runner and migration contract tests.

## File Touchpoints

1. `infra/postgres/migrations/`
2. `tests/contract/migration-wave10.contract.test.ts`
3. `docs/runbooks/migration-rollout-and-rollback.md`
4. `README.md`
5. `docs/README.md`
6. `docs/application-completion-backlog.md`

## Validation

1. `npx vitest run tests/contract/migration-wave10.contract.test.ts`
2. `npm run verify:migrations:dr018`
3. `npm run test:integration-db:docker`

## Exit Criteria

1. Only one migration file exists per numeric prefix.
2. All docs/tests reference the same migration order and filenames.
3. Migration apply automation remains deterministic.
