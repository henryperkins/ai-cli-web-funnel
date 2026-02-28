-- Wave 7 operational persistence: retrieval sync state, internal dispatch effects, and dead-letter replay audit.
-- Related: DR-011, DR-012, DR-018, MQ-024, MQ-033, MQ-038.
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take brief catalog locks only.
--   - No table rewrites or destructive DDL are introduced in this migration.
-- Rollback playbook:
--   - Prefer forward compensation migration that disables writers and archives operational rows.
--   - If emergency rollback is required, stop outbox/retrieval sync workers before archiving then dropping new relations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS retrieval_sync_documents (
  package_id UUID PRIMARY KEY REFERENCES registry.packages(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL,
  last_sync_mode TEXT NOT NULL,
  last_trigger TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE retrieval_sync_documents IS
  'Last known semantic retrieval projection fingerprint per package for deterministic sync skipping.';

CREATE INDEX IF NOT EXISTS idx_retrieval_sync_documents_updated
  ON retrieval_sync_documents(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_retrieval_sync_documents_last_synced
  ON retrieval_sync_documents(last_synced_at DESC);

CREATE TABLE IF NOT EXISTS outbox_internal_dispatch_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_job_id UUID NOT NULL REFERENCES ingestion_outbox(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  effect_code TEXT NOT NULL,
  effect_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(outbox_job_id, effect_code)
);

COMMENT ON TABLE outbox_internal_dispatch_effects IS
  'Deterministic side-effect audit rows for internal outbox handlers beyond execution ledger entries.';

CREATE INDEX IF NOT EXISTS idx_outbox_internal_dispatch_effects_event_processed
  ON outbox_internal_dispatch_effects(event_type, processed_at DESC);

CREATE TABLE IF NOT EXISTS outbox_dead_letter_replay_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_run_id UUID NOT NULL,
  outbox_job_id UUID NOT NULL REFERENCES ingestion_outbox(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  previous_attempt_count INTEGER NOT NULL CHECK (previous_attempt_count >= 0),
  previous_last_error TEXT,
  replay_reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  correlation_id TEXT,
  requeued_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbox_dead_letter_replay_audit IS
  'Append-only operator audit log for dead-letter list/requeue actions.';

CREATE INDEX IF NOT EXISTS idx_outbox_dead_letter_replay_run_created
  ON outbox_dead_letter_replay_audit(replay_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_dead_letter_replay_event_created
  ON outbox_dead_letter_replay_audit(event_type, created_at DESC);
