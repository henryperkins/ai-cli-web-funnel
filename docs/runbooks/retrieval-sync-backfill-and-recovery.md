# Retrieval Sync Backfill and Recovery

## Scope
Operator runbook for semantic retrieval document sync/backfill operations and recovery.

Implemented in:
1. `packages/ranking/src/retrieval-sync.ts`
2. `scripts/run-retrieval-sync.mjs`
3. `packages/security-governance/src/internal-outbox-dispatch-handlers.ts` (`ranking.sync.requested`)
4. `scripts/run-outbox-processor.mjs`
5. `infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql`

## Required environment
1. `FORGE_DATABASE_URL` (or `DATABASE_URL`)
2. `QDRANT_URL`
3. `QDRANT_API_KEY`
4. `QDRANT_COLLECTION`
5. `EMBEDDING_MODEL`
6. `EMBEDDING_DIMENSIONS`
7. `EMBEDDING_API_KEY` or `OPENAI_API_KEY`
8. Optional: `EMBEDDING_API_BASE_URL`

## Operator commands
1. Dry-run bounded batch:
   - `npm run run:retrieval-sync -- --mode dry-run --limit 25`
2. Apply bounded batch:
   - `npm run run:retrieval-sync -- --mode apply --limit 100`
3. Resume from cursor:
   - `npm run run:retrieval-sync -- --mode apply --cursor <last-package-id> --limit 100`
4. Sync specific package IDs:
   - `npm run run:retrieval-sync -- --mode apply --package-ids <uuid-1>,<uuid-2>`
5. Execute ranking sync from outbox internal handlers:
   - `OUTBOX_INTERNAL_DISPATCH=true npm run run:outbox -- --mode production --limit 100`

## Determinism and safety invariants
1. Projection fingerprints (`payload_sha256`) prevent unchanged document rewrites.
2. Candidate ordering is deterministic (`package_id` ascending).
3. Cursor progression is deterministic (`next_cursor` from last processed `package_id`).
4. Outbox ranking handler side effects are idempotent by `(outbox_job_id, effect_code)`.

## Symptom -> cause -> fix
1. `retrieval_sync_config_invalid:*`
   - Cause: missing/invalid retrieval env in apply mode.
   - Fix: set required env vars, rerun dry-run, then apply.
2. `retrieval_sync_qdrant_upsert_failed:status=*`
   - Cause: Qdrant auth/service/collection issue.
   - Fix: verify Qdrant credentials/collection health; rerun apply after recovery.
3. `outbox.ranking_sync.failed`
   - Cause: internal outbox ranking sync failed during apply path.
   - Fix: inspect `failure_class` and `error_message`, fix dependency issue, rerun outbox and dead-letter replay if needed.
4. high `unchanged_count` with low `upserted_count`
   - Cause: expected no-op backfill due fingerprint stability.
   - Fix: no action required unless source catalog changed unexpectedly.

## Validation checks
1. `npm run --workspace @forge/ranking test`
2. `npm run test:integration-db:docker`
3. Confirm `tests/integration-db/outbox-dispatcher.integration-db.test.ts` passes ranking sync execution case.
