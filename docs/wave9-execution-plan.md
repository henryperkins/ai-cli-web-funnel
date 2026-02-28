# Wave 9 Execution Plan

Date: 2026-02-28  
Scope: Close profile/bundle orchestration, observability (SLO rollup), and governance-automation gaps so Forge can run discover/plan/install/verify plus profile-based multi-package workflows with production-grade operator confidence.

## Scope Lock

1. This wave implements profile orchestration closure (validation hardening, run-plan linkage, execution modes), SLO rollup foundations + operator runner, event-family ownership codification, hermetic local dependency stack, and governance-automation closure.
2. Governance status boundary is preserved: no AQ/MQ/DR status changes from Open/Proposed to Approved in this execution plan.
3. Migrations remain additive and forward-only.

## Step Matrix

| Step | Target loop stage(s) | Risk | Migration impact | Required tests | Related AQ/MQ/DR |
| --- | --- | --- | --- | --- | --- |
| 1. Traceability + acceptance gates | all | low | none | execution plan doc + DLOG scope lock | AQ-054, AQ-056, MQ-038 |
| 2. Docs/source reconciliation | all | low | none | README + docs index updates | AQ-050, MQ-035 |
| 3. Profile API validation hardening | plan, install | medium | none | profile route validation unit tests | AQ-050, MQ-035 |
| 4. Profile install-run orchestration | install, verify | high | none (uses 012) | integration-db run-plan linkage + status tests | DR-011, MQ-038 |
| 5. Profile install execution modes | install, verify | high | none (uses 012) | unit + integration-db for plan_only/apply_verify | DR-011, DR-017, MQ-038 |
| 6. Event ownership + metrics disposition | all | medium | none | unsupported event rejection test (already exists) | AQ-054, MQ-038 |
| 7. SLO rollup foundations | all | high | required (013) | unit tests + integration-db for rollup service | AQ-054, AQ-056, MQ-038 |
| 8. SLO rollup operator runner | all | medium | none | script-level dry-run + .env.example coverage | AQ-054, MQ-038 |
| 9. Hermetic local dependency stack | all | medium | none | docker-compose bootstrap/teardown scripts | MQ-033, MQ-038 |
| 10. Test + CI expansion | all | medium | none | SLO integration-db, profile e2e, ci-verification.md | AQ-050, MQ-038, DR-018 |
| 11. Runbook + governance automation | all | low | none | runbooks, governance drift checker script | MQ-024, MQ-029, MQ-038 |
| 12. Governance/reporting closure | all | low | none | wave8+9 build reports, DLOG updates | AQ-049, AQ-050, DR-018 |

## Hard Acceptance Criteria

1. Step 1 is complete only when this plan exists and Wave 9 scope lock is appended to `DECISION_LOG.md`.
2. Step 2 is complete only when `README.md` and `docs/README.md` accurately reflect profile/bundle foundations, supported outbox event families, and verified-vs-in-progress boundaries.
3. Step 3 is complete only when profile create/import/install inputs enforce strict validation (required fields, package order uniqueness, UUID format, bounds) with explicit error taxonomy matching existing API style.
4. Step 4 is complete only when `profile_install_run_plans` linkage persists for each created install plan and per-plan statuses advance from lifecycle outcomes with replay-safe behavior.
5. Step 5 is complete only when profile install supports `plan_only` (default) and `apply_verify` execution modes with deterministic idempotency, persisted attempt linkage, and backward compatibility.
6. Step 6 is complete only when the event ownership matrix is codified and `metrics.aggregate.requested` disposition is explicit (unsupported with deterministic rejection).
7. Step 7 is complete only when SLO rollup service reads operational tables and writes deterministic snapshot rows via additive migration `013`, with unit and integration-db coverage.
8. Step 8 is complete only when SLO rollup operator script supports `dry-run`/`production` modes with bounded window flags (`--from`, `--to`, `--limit`), deterministic run IDs, and structured non-secret logs.
9. Step 9 is complete only when a hermetic local stack (Postgres + Qdrant + optional embedding stub) bootstraps and tears down via one-command scripts and all operator commands run without manual secret hunting.
10. Step 10 is complete only when CI runs baseline checks, migration `012`/`013` contract coverage, profile install integration-db, profile e2e-local scenario, and ops smoke workflow for dry-run operator commands.
11. Step 11 is complete only when runbooks include profile operations, event-family ownership, SLO rollup operations, and a governance drift checker detects silent AQ/MQ/DR status changes without corresponding decision-log updates.
12. Step 12 is complete only when `docs/wave9-build-report.md` is published with step-by-step evidence, deferred/blocker items, and explicit governance boundary statement.

## Event Ownership Matrix

| Event Type | Family | Producer | Dispatcher Path | Handler | Side Effects |
| --- | --- | --- | --- | --- | --- |
| fraud.reconcile.requested | Fraud | security-governance ingestion | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| ranking.sync.requested | Ranking | outbox publisher (catalog ingest) | outbox-dispatcher | internal-outbox-dispatch-handlers (executes retrieval sync) | dispatch_runs + dispatch_effects + retrieval_sync_documents |
| security.report.accepted | Security | signed reporter ingestion | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| security.enforcement.recompute.requested | Security | signed reporter ingestion | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| install.plan.created | Install | POST /v1/install/plans | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| install.apply.succeeded | Install | POST /v1/install/plans/:id/apply | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| install.apply.failed | Install | POST /v1/install/plans/:id/apply | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| install.verify.succeeded | Install | POST /v1/install/plans/:id/verify | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| install.verify.failed | Install | POST /v1/install/plans/:id/verify | outbox-dispatcher | internal-outbox-dispatch-handlers | dispatch_runs + dispatch_effects |
| metrics.aggregate.requested | (unsupported) | — | outbox-dispatcher | REJECTED | Throws unsupported_event_type error |

## Validation Commands (Wave 9)

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`
7. `npx vitest run tests/integration-db/profile-bundle.integration-db.test.ts --maxWorkers=1`
8. `npx vitest run tests/integration-db/outbox-dispatcher.integration-db.test.ts --maxWorkers=1`
9. `npx vitest run tests/contract --maxWorkers=1`
10. `npm run run:catalog-ingest -- --mode dry-run --input <fixture-json>`
11. `npm run run:retrieval-sync -- --mode dry-run --limit 25`
12. `npm run run:outbox -- --mode dry-run --limit 25`
13. `npm run run:outbox-dead-letter -- --action list --limit 25`
14. Any new Wave 9 SLO rollup dry-run command(s)
15. Any new targeted Wave 9 suites introduced during implementation
