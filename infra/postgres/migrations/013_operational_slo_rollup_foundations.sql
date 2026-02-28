-- Wave 9 operational SLO rollup foundations for outbox/retrieval/lifecycle/profile/governance telemetry.
-- Related: AQ-054, AQ-056, MQ-038.
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take brief catalog locks only.
--   - No table rewrites or destructive DDL in this migration.
-- Rollback playbook:
--   - Prefer forward compensation migration that disables rollup writers and archives snapshot rows.
--   - If emergency rollback is required, stop SLO rollup jobs before archiving then dropping new relations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS operational_slo_rollup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'production')),
  trigger TEXT NOT NULL,
  window_from TIMESTAMPTZ NOT NULL,
  window_to TIMESTAMPTZ NOT NULL,
  batch_limit INTEGER NOT NULL CHECK (batch_limit > 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (snapshot_count >= 0),
  failure_class TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE operational_slo_rollup_runs IS
  'Execution ledger for deterministic SLO rollup jobs.';

CREATE INDEX IF NOT EXISTS idx_operational_slo_rollup_runs_status_created
  ON operational_slo_rollup_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_slo_rollup_runs_window
  ON operational_slo_rollup_runs(window_from, window_to, created_at DESC);

CREATE TABLE IF NOT EXISTS operational_slo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_internal_id UUID NOT NULL REFERENCES operational_slo_rollup_runs(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  window_from TIMESTAMPTZ NOT NULL,
  window_to TIMESTAMPTZ NOT NULL,
  numerator BIGINT NOT NULL CHECK (numerator >= 0),
  denominator BIGINT NOT NULL CHECK (denominator >= 0),
  ratio NUMERIC(18, 6),
  sample_size BIGINT NOT NULL CHECK (sample_size >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_internal_id, metric_key)
);

COMMENT ON TABLE operational_slo_snapshots IS
  'Per-metric SLO snapshots emitted by a rollup run. Append-only by run_id.';

CREATE INDEX IF NOT EXISTS idx_operational_slo_snapshots_metric_window
  ON operational_slo_snapshots(metric_key, window_from, window_to);

CREATE INDEX IF NOT EXISTS idx_operational_slo_snapshots_run
  ON operational_slo_snapshots(run_id, created_at DESC);
