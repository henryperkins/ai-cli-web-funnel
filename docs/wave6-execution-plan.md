# Wave 6 Execution Plan

Date: 2026-02-28  
Scope: Production-hardening wave after Wave 5 for discover -> plan -> apply -> verify.

## Scope Lock

1. This wave implements concrete retrieval providers, retrieval bootstrap wiring, deterministic ingest/outbox operations, runtime flag/config loaders, and operational/runbook hardening.
2. Governance status boundary is preserved: no AQ/MQ/DR status changes from Open/Proposed to Approved in this execution plan.
3. Migrations remain additive and forward-only.

## Step Matrix

| Step | Target loop stage(s) | Risk | Migration impact | Required tests | Related AQ/MQ/DR |
| --- | --- | --- | --- | --- | --- |
| 1. Traceability + acceptance gates | discover, plan, apply, verify | low | none | docs lint/readability review | AQ-050, MQ-035, DR-011 |
| 2. Concrete retrieval providers | discover | medium | optional | `packages/ranking` unit tests for BM25/semantic success + fallback + determinism | MQ-011, MQ-012, DR-012 |
| 3. Retrieval bootstrap startup wiring | discover, verify | medium | none | control-plane startup/readiness tests with required/optional bootstrap paths | MQ-011, MQ-012, DR-012 |
| 4. Deterministic catalog ingest runner | discover | medium | none | script unit/integration tests for replay-safe ingest persistence | AQ-014, MQ-001, DR-003 |
| 5. Internal outbox real handlers | plan, apply, verify | high | likely 010+ additive table(s) | outbox processor unit + integration-db tests for duplicate/retry/dead-letter behavior | MQ-024, MQ-038, DR-011 |
| 6. Runtime feature-flag loader | apply, verify | medium | none | runtime-flag loader tests + install/runtime wiring tests | AQ-057, MQ-019, DR-017 |
| 7. Secret-ref + remote auth hardening | apply, verify | medium | none | missing `secret_ref`, OAuth exchange failure/recovery tests | MQ-019, MQ-033, DR-017 |
| 8. Lifecycle observability + correlation continuity | plan, apply, verify | medium | optional | contract/integration tests asserting correlation continuity and replay safety | AQ-050, MQ-035, DR-011 |
| 9. Additive migration(s) for wave capabilities | discover, plan, apply, verify | medium | required if new persistence tables introduced | migration contract test(s), `npm run verify:migrations:dr018` | AQ-049, MQ-034, DR-018 |
| 10. End-to-end verification expansion | discover, plan, apply, verify | high | none | integration-db + e2e additions for retrieval metadata + outbox execution | MQ-033, MQ-038, DR-012 |
| 11. Runbook/operator refresh | discover, plan, apply, verify | low | none | docs review for command reproducibility and symptom->cause->fix matrices | MQ-024, MQ-029, DR-016 |
| 12. Governance/reporting closure | discover, plan, apply, verify | low | none | wave report completeness + governance boundary check | AQ-049, AQ-050, DR-018 |

## Hard Acceptance Criteria

1. Step 1 is complete only when this plan exists and DLOG scope lock is appended.
2. Step 2 is complete only when BM25 + semantic provider modules exist with deterministic sorting/scoring tests and semantic-failure BM25 fallback coverage.
3. Step 3 is complete only when startup wiring can bootstrap retrieval from env and readiness reports deterministic non-secret failure reasons.
4. Step 4 is complete only when ingest script supports dry-run and apply modes with deterministic merge-run handling and rerun-safe persistence behavior.
5. Step 5 is complete only when `OUTBOX_INTERNAL_DISPATCH=true` executes non-placeholder handlers and replay paths remain idempotent.
6. Step 6 is complete only when runtime feature gates are resolved from config/env instead of hardcoded fallback assumptions in default control-plane runtime wiring.
7. Step 7 is complete only when secret-ref resolution and OAuth token exchange are integrated in runtime wiring with deterministic reason codes on failure.
8. Step 8 is complete only when lifecycle logs/audit/outbox payloads consistently carry correlation IDs without creating replay duplicates.
9. Step 9 is complete only when additive migration(s) include lock-risk + rollback notes and migration contract coverage.
10. Step 10 is complete only when integration-db coverage exercises retrieval bootstrap readiness and internal outbox handler execution.
11. Step 11 is complete only when required runbooks include exact operator commands and troubleshooting matrices.
12. Step 12 is complete only when `docs/wave6-build-report.md` is published with explicit deferred items and governance-status boundary statement.

## Validation Commands (Wave 6)

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`
7. `npm run run:outbox -- --mode dry-run --limit 25`
8. Any new targeted Wave 6 suites introduced during implementation
