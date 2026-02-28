# Immediate Execution Plans

Date: 2026-02-28
Scope: Concrete implementation plans for the immediate execution items in `docs/application-completion-backlog.md`.

## Execution Order

1. `E9-S1` profile-specific CI e2e path.
2. `E9-S2` ops smoke workflow.
3. `E2-S1` GitHub connector.
4. `E3-S1` dependency graph expansion.
5. `E5-S1` update lifecycle prototype.

## Plan Documents

1. [E9-S1 Profile-Specific CI E2E Plan](./e9-s1-profile-e2e-ci-plan.md)
2. [E9-S2 Ops Smoke Workflow Plan](./e9-s2-ops-smoke-workflow-plan.md)
3. [E2-S1 GitHub Connector Plan](./e2-s1-github-connector-plan.md)
4. [E3-S1 Dependency Graph Expansion Plan](./e3-s1-dependency-graph-expansion-plan.md)
5. [E5-S1 Update Lifecycle Prototype Plan](./e5-s1-update-lifecycle-prototype-plan.md)

## Next Phases

1. [Phase 2 Execution Plans Index](./phase-2/README.md)
2. [Phase 3 Execution Plans Index](./phase-3/README.md)

## Shared Quality Gates

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`

## Reporting Expectations

1. Each plan must produce a short execution report with: changed files, commands run, pass/fail results, and deferred items.
2. Any governance-sensitive behavior change requires `DECISION_LOG.md` update in the same change set.
