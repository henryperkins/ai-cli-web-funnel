-- Async boundary and projection snapshot foundations for Steps 1-5.
-- Related: DR-011, DR-012, DR-016, DR-018.
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS obtains a brief catalog lock only.
--   - CREATE INDEX IF NOT EXISTS may briefly block concurrent DDL on touched relations.
-- Rollback playbook:
--   - Prefer forward compensation migration.
--   - If rollback is required, stop writers first, then archive rows from new tables before dropping.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ingestion_idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_code INTEGER NOT NULL CHECK (response_code BETWEEN 100 AND 599),
  response_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key)
);

COMMENT ON TABLE ingestion_idempotency_records IS
  'Route-scoped idempotency response cache for HTTP ingestion endpoints.';

CREATE INDEX IF NOT EXISTS idx_ingestion_idempotency_stored_at
  ON ingestion_idempotency_records(stored_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_at TIMESTAMPTZ NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ingestion_outbox IS
  'Deterministic async handoff queue with dedupe_key replay guard.';

CREATE INDEX IF NOT EXISTS idx_ingestion_outbox_status_available
  ON ingestion_outbox(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_ingestion_outbox_event_type_created
  ON ingestion_outbox(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS security_enforcement_projections (
  package_id UUID PRIMARY KEY REFERENCES registry.packages(id) ON DELETE CASCADE,
  state security_enforcement_state NOT NULL,
  reason_code TEXT,
  policy_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  warning_only BOOLEAN NOT NULL DEFAULT FALSE,
  source security_enforcement_source NOT NULL DEFAULT 'security_governance',
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE security_enforcement_projections IS
  'Current enforcement snapshot per package, recomputed from immutable action history.';

CREATE INDEX IF NOT EXISTS idx_security_enforcement_projections_state_updated
  ON security_enforcement_projections(state, updated_at DESC);
