# Docs Index

## Product Intent

Forge is an install broker for CLI addons (MCP servers, skills, plugins, and related integrations).  
Core product loop:
1. discover
2. plan
3. install
4. verify

Primary framing lives in the root `README.md`.

## Current Delivery State

1. Waves 3-7 establish discover/plan/install/verify foundations, retrieval bootstrap, outbox execution, and CI baseline.
2. Wave 8 delivers profile/bundle lifecycle foundations via migration `012_profile_bundle_foundations.sql`.
3. Wave 9 delivers SLO rollup and governance automation foundations via migration `013_operational_slo_rollup_foundations.sql`.
4. Required CI checks are documented in `docs/ci-verification.md`.
5. Optional Step 10 CI expansions (profile-specific e2e and ops smoke workflow) are intentionally tracked as deferred decisions.

## Governance and Decision Records

1. ADRs: `docs/adr/`
2. Application decision records: `application_decision_records.md`
3. Open questions: `application_master_open_questions.md`, `master_open_questions.md`
4. Guardrail tracker: `OPEN_QUESTIONS_TRACKER.md`
5. Implementation-time decision log: `DECISION_LOG.md`
6. CI verification contract: `docs/ci-verification.md`

## Runbooks

1. `docs/runbooks/event-ingestion-fraud-baseline.md`
2. `docs/runbooks/runtime-preflight-and-adapter-contracts.md`
3. `docs/runbooks/install-lifecycle-vscode-copilot-local.md`
4. `docs/runbooks/profile-lifecycle-operations.md`
5. `docs/runbooks/slo-rollup-operations.md`
6. `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
7. `docs/runbooks/outbox-dead-letter-requeue.md`
8. `docs/runbooks/semantic-retrieval-incident-fallback.md`
9. `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
10. `docs/runbooks/migration-rollout-and-rollback.md`

## Wave Reports

1. `docs/wave3-build-report.md`
2. `docs/wave4-build-report.md`
3. `docs/wave5-build-report.md`
4. `docs/wave6-build-report.md`
5. `docs/wave7-build-report.md`
6. `docs/wave8-build-report.md`
7. `docs/wave9-build-report.md`

## Execution Plans

1. `docs/wave6-execution-plan.md`
2. `docs/wave7-execution-plan.md`
3. `docs/wave9-execution-plan.md`

## Application Completion Backlog

1. `docs/application-completion-backlog.md`

## Immediate Execution Plans

1. `docs/immediate-execution-plans/README.md`
2. `docs/immediate-execution-plans/e9-s1-profile-e2e-ci-plan.md`
3. `docs/immediate-execution-plans/e9-s2-ops-smoke-workflow-plan.md`
4. `docs/immediate-execution-plans/e2-s1-github-connector-plan.md`
5. `docs/immediate-execution-plans/e3-s1-dependency-graph-expansion-plan.md`
6. `docs/immediate-execution-plans/e5-s1-update-lifecycle-prototype-plan.md`
7. `docs/immediate-execution-plans/phase-2/README.md`

## Validation Entry Points

1. `npm run check`
2. `npm run verify:migrations:dr018`
3. `npm run test:e2e-local`
4. `npm run test:integration-db:docker`
