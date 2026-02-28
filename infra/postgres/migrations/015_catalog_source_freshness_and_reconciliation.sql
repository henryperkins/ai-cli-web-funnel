-- Wave 10 catalog source freshness and reconciliation foundations.
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take brief catalog locks only.
--   - No table rewrites are performed by this migration.
-- Rollback playbook:
--   - Prefer forward compensation migration.
--   - If emergency rollback is required, drop added tables/indexes only after confirming no active readers/writers.

CREATE TABLE IF NOT EXISTS catalog_source_freshness (
  source_name TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  stale_after_minutes INTEGER NOT NULL CHECK (stale_after_minutes BETWEEN 5 AND 10080),
  last_attempt_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ,
  merge_run_id TEXT,
  failure_class TEXT,
  failure_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_source_freshness_updated_at
  ON catalog_source_freshness (updated_at DESC, source_name ASC);

CREATE TABLE IF NOT EXISTS catalog_reconciliation_runs (
  run_id TEXT PRIMARY KEY,
  run_hash TEXT NOT NULL,
  source_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'apply')),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  merge_run_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_reconciliation_runs_source_started
  ON catalog_reconciliation_runs (source_name, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_reconciliation_runs_id_hash
  ON catalog_reconciliation_runs (run_id, run_hash);
