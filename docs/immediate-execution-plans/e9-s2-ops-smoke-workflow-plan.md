# E9-S2 Plan: Ops Smoke Workflow

Story: `E9-S2`
Owner: Platform + CI Maintainers
Priority: `P0`
Status: Completed

## Objective

Add a non-blocking ops smoke workflow (manual/nightly) to validate operational commands and catch regressions in retrieval/outbox/dead-letter/SLO runner paths.

## In Scope

1. Add a new GitHub Actions workflow for ops smoke runs.
2. Include dry-run commands for retrieval sync, outbox, dead-letter list, and SLO rollup.
3. Define artifact/log retention and failure interpretation.
4. Document required runtime/secrets and operator usage.

## Out of Scope

1. Making ops smoke workflow a hard merge gate in this step.
2. Production-mode operator command execution in CI.

## Implementation Steps

1. Workflow design.

- Create workflow file (for example `.github/workflows/forge-ops-smoke.yml`).
- Trigger: `workflow_dispatch` and scheduled cron.
- Environment: Node 22 + Docker runtime.

2. Environment bootstrap.

- Reuse local/docker bootstrap pattern (`scripts/local-stack-up.sh`) where practical.
- Set DB env values required for scripts.

3. Execute command set.

- `npm run run:retrieval-sync -- --mode dry-run --limit 25`
- `npm run run:outbox -- --mode dry-run --limit 25`
- `npm run run:outbox-dead-letter -- --action list --limit 25`
- `npm run run:slo-rollup -- --mode dry-run --from <iso> --to <iso> --limit 100`

4. Output and triage.

- Upload logs/artifacts for each command.
- Add workflow-level guidance for interpreting blockers vs transient infra issues.

5. Documentation and governance consistency.

- Update `docs/ci-verification.md` Step 10 section to move from deferred to implemented.
- Update `docs/wave9-execution-plan.md` and `docs/wave9-build-report.md` status accordingly.
- Update `DECISION_LOG.md` with implementation decision.

## File Touchpoints

1. `.github/workflows/forge-ops-smoke.yml` (new)
2. `docs/ci-verification.md`
3. `docs/wave9-execution-plan.md`
4. `docs/wave9-build-report.md`
5. `DECISION_LOG.md`

## Validation Commands

1. Trigger workflow manually in GitHub Actions and confirm all steps run.
2. Local parity check:

- `scripts/local-stack-up.sh`
- run the four dry-run commands
- `scripts/local-stack-down.sh`

## Risks and Mitigations

1. Risk: flaky schedule runs due to shared runner/network instability.
   Mitigation: keep workflow non-blocking and preserve artifacts for triage.

2. Risk: secret/runtime drift across environments.
   Mitigation: document required env explicitly and validate in workflow preflight step.

## Exit Criteria

1. Ops smoke workflow exists and is runnable manually.
2. At least one successful run is recorded with artifacts.
3. CI docs and Wave 9 closure docs reflect implemented status.

## Execution Notes (2026-02-28)

1. Changed files:
   - `.github/workflows/forge-ops-smoke.yml`
   - `docs/ci-verification.md`
   - `docs/wave9-execution-plan.md`
   - `docs/wave9-build-report.md`
   - `DECISION_LOG.md` (`DLOG-0037`)
2. Commands run and results:
   - `npm run typecheck` -> PASS
   - `npm run test` -> PASS
   - `npm run check` -> PASS
   - `npm run verify:migrations:dr018` -> PASS
   - `npm run test:integration-db:docker` -> PASS
3. Deferred items:
   - Ops smoke remains intentionally non-blocking (manual/nightly workflow, not a required merge gate).
