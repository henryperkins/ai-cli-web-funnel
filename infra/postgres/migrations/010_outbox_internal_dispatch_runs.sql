-- Wave 6 internal outbox dispatch execution ledger.
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take brief catalog locks only.
--   - No table rewrites or destructive DDL in this migration.
-- Rollback playbook:
--   - Prefer forward compensation migration that disables internal dispatch writers and archives ledger rows.
--   - If emergency rollback is required, stop outbox processor first, then archive rows before dropping this table.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS outbox_internal_dispatch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_job_id UUID NOT NULL UNIQUE REFERENCES ingestion_outbox(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  handler_key TEXT NOT NULL,
  source_service TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  correlation_id TEXT,
  processed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbox_internal_dispatch_runs IS
  'Replay-safe internal dispatch execution log keyed by ingestion_outbox job id.';

CREATE INDEX IF NOT EXISTS idx_outbox_internal_dispatch_event_processed
  ON outbox_internal_dispatch_runs(event_type, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_internal_dispatch_correlation
  ON outbox_internal_dispatch_runs(correlation_id, processed_at DESC)
  WHERE correlation_id IS NOT NULL;
