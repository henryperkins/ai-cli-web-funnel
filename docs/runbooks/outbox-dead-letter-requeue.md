# Outbox Dead-Letter Requeue

## Scope
Operator runbook for listing and requeueing dead-letter outbox jobs with replay audit.

Implemented in:
1. `packages/security-governance/src/dead-letter-requeue.ts`
2. `scripts/run-outbox-dead-letter-replay.mjs`
3. `infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql`

## Safety contract
1. List operations are read-only.
2. Requeue operations require explicit `--confirm true`.
3. Every requeue writes an append-only audit row into `outbox_dead_letter_replay_audit`.
4. Requeue is idempotent: once status changes from `dead_letter` to `pending`, repeat runs with same filter requeue zero rows.

## Operator commands
1. List dead-letter rows:
   - `npm run run:outbox-dead-letter -- --action list --limit 50`
2. Filter by event type:
   - `npm run run:outbox-dead-letter -- --action list --event-type ranking.sync.requested --limit 50`
3. Filter by dedupe key:
   - `npm run run:outbox-dead-letter -- --action list --dedupe-key <dedupe-key>`
4. Requeue specific event type (mutating):
   - `npm run run:outbox-dead-letter -- --action requeue --event-type install.verify.failed --confirm true --reason operator_fix_applied --requested-by <name>`
5. Requeue with correlation ID for incident traceability:
   - `npm run run:outbox-dead-letter -- --action requeue --event-type ranking.sync.requested --confirm true --reason retrieval_dependency_restored --correlation-id <incident-id>`

## Audit verification
1. Confirm audit rows by replay run:
   - `SELECT replay_run_id, outbox_job_id, event_type, replay_reason, requested_by, created_at FROM outbox_dead_letter_replay_audit ORDER BY created_at DESC LIMIT 50;`
2. Confirm requeued outbox status:
   - `SELECT id, event_type, status, attempt_count, last_error FROM ingestion_outbox WHERE status = 'pending' ORDER BY updated_at DESC LIMIT 50;`

## Symptom -> cause -> fix
1. `outbox.dead_letter.operation_failed` with confirm error
   - Cause: `--action requeue` executed without `--confirm true`.
   - Fix: rerun command with explicit confirmation.
2. `outbox.dead_letter.operation_failed` with DB/SQL error
   - Cause: DB connectivity or lock issue.
   - Fix: validate DB availability, rerun list first, then requeue.
3. `requeued_count=0` but dead-letter expected
   - Cause: filters did not match rows or rows were already requeued.
   - Fix: rerun list command with broader filters and inspect exact `event_type`/`dedupe_key`.

## Validation checks
1. `npm run test:integration-db:docker`
2. Confirm `tests/integration-db/dead-letter-requeue.integration-db.test.ts` covers:
   - safe listing/filter behavior
   - requeue idempotency
   - replay audit writes
