-- Step 2/3 foundations: event schema v1, ingestion storage, and real-time fraud flag scaffolding.
-- Related: DR-010, DR-011, DR-014, DR-017, DR-018, AQ-049, AQ-050, MQ-011, MQ-012, MQ-033, MQ-034, MQ-035, MQ-038.
-- Safe defaults: append-only raw events, fail-closed outcome enums, compatibility FK posture via registry_packages until DR-018 approval.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'telemetry_event_name') THEN
    CREATE TYPE telemetry_event_name AS ENUM (
      'search.query',
      'package.impression',
      'package.click',
      'package.action',
      'promoted.interaction',
      'server.start',
      'server.crash',
      'server.health_transition',
      'server.policy_check'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fraud_outcome') THEN
    CREATE TYPE fraud_outcome AS ENUM ('clean', 'flagged', 'blocked');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_flag_source') THEN
    CREATE TYPE event_flag_source AS ENUM ('rt_fraud', 'daily_fraud', 'security_governance', 'manual_review');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS raw_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE,
  event_name telemetry_event_name NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  event_occurred_at TIMESTAMPTZ NOT NULL,
  event_received_at TIMESTAMPTZ NOT NULL,
  idempotency_scope TEXT NOT NULL DEFAULT 'POST:/v1/events',
  idempotency_key TEXT NOT NULL,
  request_id UUID NOT NULL,
  session_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('anonymous', 'authenticated', 'verified_creator', 'sponsor')),
  consent_state TEXT NOT NULL CHECK (consent_state IN ('granted', 'denied', 'not_required')),
  region TEXT,
  client_app TEXT NOT NULL,
  client_app_version TEXT NOT NULL,
  user_agent_family TEXT NOT NULL CHECK (user_agent_family IN ('chromium', 'webkit', 'gecko', 'other')),
  device_class TEXT NOT NULL CHECK (device_class IN ('desktop', 'tablet', 'mobile')),
  referrer_domain TEXT,
  package_id UUID REFERENCES registry_packages(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_scope, idempotency_key),
  CHECK (schema_version = '1.0.0'),
  CHECK (NOT (payload ? 'ip')),
  CHECK (NOT (payload ? 'ip_address')),
  CHECK (NOT (payload ? 'fingerprint')),
  CHECK (NOT (payload ? 'raw_user_agent')),
  CHECK (NOT (payload ? 'install_command'))
);

COMMENT ON TABLE raw_events IS
  'Step 2/3 raw event ledger (append-only). Anchors: DR-010 telemetry contract; DR-011 service boundary; AQ-050 preflight architecture.';

CREATE INDEX IF NOT EXISTS idx_raw_events_received_at
  ON raw_events(event_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_events_name_occurred
  ON raw_events(event_name, event_occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_events_session_occurred
  ON raw_events(session_id, event_occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_events_package_occurred
  ON raw_events(package_id, event_occurred_at DESC)
  WHERE package_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id UUID NOT NULL REFERENCES raw_events(id) ON DELETE CASCADE,
  package_id UUID REFERENCES registry_packages(id),
  outcome fraud_outcome NOT NULL,
  flag_source event_flag_source NOT NULL,
  rule_code TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_to_ranking BOOLEAN NOT NULL DEFAULT FALSE,
  applied_to_billing BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(raw_event_id, rule_code)
);

COMMENT ON TABLE event_flags IS
  'Fraud/security rule outcomes per raw event. Anchors: DR-014 thresholds, DR-017 flagged vs blocked behavior, MQ-011..MQ-014.';

CREATE INDEX IF NOT EXISTS idx_event_flags_outcome_created
  ON event_flags(outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_flags_package_created
  ON event_flags(package_id, created_at DESC)
  WHERE package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_flags_source_rule
  ON event_flags(flag_source, rule_code, created_at DESC);

CREATE TABLE IF NOT EXISTS trusted_metrics_staging (
  bucket_day DATE NOT NULL,
  package_id UUID NOT NULL REFERENCES registry_packages(id),
  event_name telemetry_event_name NOT NULL,
  raw_count BIGINT NOT NULL DEFAULT 0 CHECK (raw_count >= 0),
  clean_count BIGINT NOT NULL DEFAULT 0 CHECK (clean_count >= 0),
  flagged_count BIGINT NOT NULL DEFAULT 0 CHECK (flagged_count >= 0),
  blocked_count BIGINT NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  trust_window TEXT NOT NULL DEFAULT 'daily',
  lineage_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_day, package_id, event_name, trust_window),
  CHECK (clean_count + flagged_count + blocked_count <= raw_count)
);

COMMENT ON TABLE trusted_metrics_staging IS
  'Staging contract for fraud-adjusted aggregates used by ranking/billing pipelines. Anchors: DR-011 ownership boundary, DR-018 migration compatibility, MQ-033.';

CREATE INDEX IF NOT EXISTS idx_trusted_metrics_staging_package_day
  ON trusted_metrics_staging(package_id, bucket_day DESC);

CREATE INDEX IF NOT EXISTS idx_trusted_metrics_staging_event_day
  ON trusted_metrics_staging(event_name, bucket_day DESC);
