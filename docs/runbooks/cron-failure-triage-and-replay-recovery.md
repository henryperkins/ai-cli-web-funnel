# Cron Failure Triage and Replay-Safe Recovery

## Scope
Runbook for scheduled reliability jobs:
1. reporter score recompute
2. enforcement expiry reconciliation
3. outbox processing (external dispatch and internal deterministic handlers)
4. dead-letter list/requeue replay operations
5. catalog docs-source reconciliation/freshness updates

Implemented in:
1. `packages/security-governance/src/jobs.ts`
2. `packages/security-governance/src/postgres-job-store.ts`
3. `packages/security-governance/src/internal-outbox-dispatch-handlers.ts`
4. `packages/security-governance/src/dead-letter-requeue.ts`
5. `scripts/run-outbox-processor.mjs`
6. `scripts/run-outbox-dead-letter-replay.mjs`
7. `infra/postgres/migrations/010_outbox_internal_dispatch_runs.sql`
8. `infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql`
9. `scripts/run-catalog-reconciliation.mjs`
10. `infra/postgres/migrations/015_catalog_source_freshness_and_reconciliation.sql`

## Job modes
1. `dry-run`: no writes, validates candidate workload only.
2. `shadow`: executes dispatch path, does not commit completion/failure state.
3. `production`: commits completion/failure state and dedupe markers.

## Operator commands
1. Dry-run outbox:
   - `npm run run:outbox -- --mode dry-run --limit 25`
2. Production outbox with internal handlers:
   - `OUTBOX_INTERNAL_DISPATCH=true npm run run:outbox -- --mode production --limit 100`
3. Production outbox with external endpoint:
   - `OUTBOX_DISPATCH_ENDPOINT=https://... npm run run:outbox -- --mode production --limit 100`
4. List dead-letter rows:
   - `npm run run:outbox-dead-letter -- --action list --limit 50`
5. Requeue dead-letter rows by event type (explicit confirm required):
   - `npm run run:outbox-dead-letter -- --action requeue --event-type install.verify.failed --confirm true --reason operator_fix_applied`
6. Verify migration contracts:
   - `npm run test:integration-contract -- --run tests/contract/migration-wave6.contract.test.ts`
   - `npm run test:integration-contract -- --run tests/contract/migration-wave7.contract.test.ts`
7. Run docs-source reconciliation (dry-run):
   - `npm run run:catalog-reconciliation -- --mode dry-run --source docs --input <docs-source-json>`
8. Run docs-source reconciliation (apply):
   - `npm run run:catalog-reconciliation -- --mode apply --source docs --input <docs-source-json> --max-attempts 3 --retry-backoff-ms 500`

## Replay-safe guarantees
1. `ingestion_outbox.dedupe_key` uniqueness prevents duplicate enqueue.
2. processor duplicate checks avoid re-dispatch of completed/dead-letter rows.
3. internal handler ledger (`outbox_internal_dispatch_runs`) is keyed by `outbox_job_id` for replay-safe idempotency.
4. internal handler side-effect rows (`outbox_internal_dispatch_effects`) dedupe by `(outbox_job_id, effect_code)`.
5. dead-letter requeue writes append-only audit rows (`outbox_dead_letter_replay_audit`) with run IDs.
6. catalog reconciliation run IDs are hash-stable and persisted in `catalog_reconciliation_runs`; same `run_id` + same `run_hash` is replay-safe, different hash is conflict.

## Catalog connector failure recovery
1. If `catalog_reconciliation.completed` logs `status=failed`, inspect `failure_class` first:
   - `docs_source_inaccessible`: source endpoint/network unreachable.
   - `docs_source_timeout`: request timeout exceeded.
   - `docs_source_invalid`: parse/shape failure.
   - `catalog_reconciliation_failed`: non-connector ingest/persistence failure.
2. Confirm input normalization shape (`docs`/`documents`/`items` or `urls`) and rerun dry-run first.
3. If apply mode failed and DB is healthy, confirm `catalog_source_freshness` row recorded failure and `catalog_reconciliation_runs` captured attempt details.
4. After remediation, rerun apply with the same `run_id` only when payload is unchanged; use a new `run_id` for materially changed source payloads.

## Symptom -> cause -> fix
1. `outbox.claim_failed`
   - Cause: DB connectivity/lock issue while claiming pending rows.
   - Fix: verify DB availability, re-run in dry-run mode, then production.
2. repeated `outbox.dispatch_failed` with transient reason (`timeout`, `transient_*`)
   - Cause: temporary transport/downstream instability.
   - Fix: allow retry window (`available_at`) and re-run production mode.
3. row status becomes `dead_letter`
   - Cause: max attempts exceeded with deterministic/permanent failure.
   - Fix: inspect `last_error`, patch handler/input, then requeue via dead-letter script with `--confirm true`.
4. missing rows in `outbox_internal_dispatch_runs` while `OUTBOX_INTERNAL_DISPATCH=true`
   - Cause: internal handler insert path failing.
   - Fix: verify migration `010_outbox_internal_dispatch_runs.sql` applied and rerun job.
5. `outbox.dead_letter.operation_failed`
   - Cause: invalid filter/confirm input or DB write failure during replay.
   - Fix: rerun with explicit args (`--action`, `--confirm true` for mutations), then inspect DB connectivity and lock state.
6. `docs_source_inaccessible` / `docs_source_timeout`
   - Cause: remote docs source unavailable or network timeout.
   - Fix: validate endpoint reachability, retry with bounded backoff, and confirm source freshness row updates on success.
7. `catalog_ingest_invalid: at least one source candidate is required`
   - Cause: docs payload normalized to zero valid candidates (missing URL/content/title-derived summary).
   - Fix: correct docs payload fields and rerun dry-run before apply.

## Validation checks
1. `npm run --workspace @forge/security-governance test`
2. `npm run test:integration-db:docker`
3. confirm `tests/integration-db/outbox-dispatcher.integration-db.test.ts` passes:
   - transient retry path
   - terminal dead-letter path
   - internal dispatch ledger + side-effect writes
4. confirm `tests/integration-db/dead-letter-requeue.integration-db.test.ts` passes:
   - safe selection/listing filters
   - requeue idempotency
   - replay audit row writes
