# Wave 7 Execution Plan

Date: 2026-02-28  
Scope: Operations hardening wave after Wave 6 for discover -> plan -> apply -> verify.

## Scope Lock

1. This wave implements retrieval sync execution + replay controls, dead-letter operator tooling, secret/env hardening, and CI closure.
2. Governance status boundary is preserved: no AQ/MQ/DR status changes from Open/Proposed to Approved in this execution plan.
3. Migrations remain additive and forward-only.

## Step Matrix

| Step | Target loop stage(s) | Risk | Migration impact | Required tests | Related AQ/MQ/DR |
| --- | --- | --- | --- | --- | --- |
| 1. Traceability + acceptance gates | discover, plan, apply, verify | low | none | docs plan + decision log scope lock | AQ-050, MQ-035, DR-011 |
| 2. Full-flow local e2e scenario | discover, plan, apply, verify | medium | none | `tests/e2e/discover-plan-apply-verify-local.e2e.test.ts` | MQ-033, MQ-038, DR-012 |
| 3. Retrieval sync/backfill service + script | discover | high | required (`011+`) | ranking unit tests for deterministic projection, skip unchanged, failure taxonomy | MQ-011, MQ-012, DR-012 |
| 4. ranking.sync.requested real execution path | discover, apply | high | required (`011+`) | internal handler unit + integration-db ranking sync execution coverage | MQ-024, MQ-038, DR-011 |
| 5. Internal handler side effects beyond ledger-only | plan, apply, verify | high | required (`011+`) | integration-db outbox tests for side-effect rows across handler families | MQ-024, MQ-038, DR-011 |
| 6. Dead-letter replay/requeue tooling | apply, verify | medium | required (`011+`) | integration-db dead-letter list/requeue/audit behavior | MQ-024, MQ-038, DR-011 |
| 7. Secret resolver abstraction + redaction hardening | apply, verify | medium | none | runtime-remote tests for fallback, missing secret, oauth failure/recovery, redaction | MQ-019, MQ-033, DR-017 |
| 8. Env contract + startup validation matrix | discover, apply, verify | medium | none | startup env validation unit tests + `.env.example` coverage | MQ-019, MQ-033, DR-017 |
| 9. Additive migration + contract coverage | discover, plan, apply, verify | medium | required (`011+`) | migration contract tests + DR-018 verification command | AQ-049, MQ-034, DR-018 |
| 10. CI verification automation | discover, plan, apply, verify | medium | none | GitHub workflow for baseline + integration-db docker flow | AQ-050, MQ-038, DR-018 |
| 11. Runbook/operator refresh | discover, plan, apply, verify | low | none | runbooks include exact commands and symptom->cause->fix matrices | MQ-024, MQ-029, DR-016 |
| 12. Governance/reporting closure | discover, plan, apply, verify | low | none | Wave 7 build report + decision log updates | AQ-049, AQ-050, DR-018 |

## Hard Acceptance Criteria

1. Step 1 is complete only when this plan exists and Wave 7 scope lock is appended to `DECISION_LOG.md`.
2. Step 2 is complete only when one e2e-local test executes discover -> plan -> apply -> verify and asserts retrieval metadata + idempotent replay in one scenario.
3. Step 3 is complete only when retrieval sync supports deterministic projection, `dry-run`/`apply`, `--limit`, `--cursor`, and unchanged-document skip via fingerprints.
4. Step 4 is complete only when `ranking.sync.requested` executes retrieval sync logic in internal dispatch mode (not ledger-only).
5. Step 5 is complete only when `fraud.reconcile.requested`, `security.enforcement.recompute.requested`, and install lifecycle event families persist deterministic side-effect rows.
6. Step 6 is complete only when dead-letter list/requeue requires explicit operator confirmation for mutation and writes replay audit rows.
7. Step 7 is complete only when runtime secret resolver supports provider-first with env-map fallback and oauth failure logs redact secret-like values.
8. Step 8 is complete only when startup env validation fails deterministically for invalid retrieval/runtime combinations and `.env.example` documents required envs.
9. Step 9 is complete only when migration `011+` includes lock-risk + rollback notes and contract coverage.
10. Step 10 is complete only when CI runs typecheck, test, check, migration verification, and integration-db docker flow.
11. Step 11 is complete only when required runbooks include reproducible operator commands and troubleshooting signatures.
12. Step 12 is complete only when `docs/wave7-build-report.md` is published with explicit deferred/blocker items and governance boundary statement.

## Validation Commands (Wave 7)

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run verify:migrations:dr018`
5. `npm run test:e2e-local`
6. `npm run test:integration-db:docker`
7. `npm run run:outbox -- --mode dry-run --limit 25`
8. `npm run run:catalog-ingest -- --mode dry-run --input <fixture-json>`
9. `npm run run:retrieval-sync -- --mode dry-run --limit 25`
10. `npm run run:outbox-dead-letter -- --action list --limit 25`
