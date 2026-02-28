-- DR-016 migration wave: signed reporter ingestion runtime storage and score-recompute readiness wiring.
-- Non-destructive forward migration. Enum conversions use explicit casts and defaults for unknown historical values.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reporter_tier') THEN
    CREATE TYPE reporter_tier AS ENUM ('A', 'B', 'C');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reporter_status') THEN
    CREATE TYPE reporter_status AS ENUM ('active', 'probation', 'suspended', 'removed');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_severity') THEN
    CREATE TYPE security_severity AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_source_kind') THEN
    CREATE TYPE security_source_kind AS ENUM ('raw', 'curated');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_report_queue') THEN
    CREATE TYPE security_report_queue AS ENUM ('rejected', 'queued_review', 'advisory');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_appeal_status') THEN
    CREATE TYPE security_appeal_status AS ENUM ('open', 'triaged', 'in_review', 'resolved', 'dismissed');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_enforcement_source') THEN
    CREATE TYPE security_enforcement_source AS ENUM (
      'security_governance',
      'manual_review',
      'system_recompute'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_enforcement_state') THEN
    CREATE TYPE security_enforcement_state AS ENUM (
      'none',
      'flagged',
      'policy_blocked_temp',
      'policy_blocked_perm',
      'reinstated'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS security_reporters (
  reporter_id TEXT PRIMARY KEY,
  display_name TEXT,
  tier reporter_tier NOT NULL,
  status reporter_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_reporter_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL REFERENCES security_reporters(reporter_id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (reporter_id, key_id)
);

CREATE TABLE IF NOT EXISTS security_report_nonces (
  reporter_id TEXT NOT NULL REFERENCES security_reporters(reporter_id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (reporter_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_security_report_nonces_expires_at
  ON security_report_nonces(expires_at);

CREATE TABLE IF NOT EXISTS security_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NOT NULL UNIQUE,
  reporter_id TEXT NOT NULL REFERENCES security_reporters(reporter_id),
  reporter_key_id TEXT NOT NULL,
  package_id UUID REFERENCES registry.packages(id),
  severity security_severity NOT NULL,
  source_kind security_source_kind NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  evidence_minimums_met BOOLEAN NOT NULL,
  abuse_suspected BOOLEAN NOT NULL DEFAULT FALSE,
  reason_code TEXT NOT NULL,
  queue security_report_queue NOT NULL,
  projected_state security_enforcement_state NOT NULL,
  body_sha256 TEXT NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  request_nonce TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, request_nonce)
);

CREATE INDEX IF NOT EXISTS idx_security_reports_package_created
  ON security_reports(package_id, created_at DESC)
  WHERE package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_security_reports_reporter_created
  ON security_reports(reporter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_enforcement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id TEXT NOT NULL UNIQUE,
  package_id UUID NOT NULL REFERENCES registry.packages(id),
  state security_enforcement_state NOT NULL,
  reason_code TEXT NOT NULL,
  source security_enforcement_source NOT NULL DEFAULT 'security_governance',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_action_id UUID REFERENCES security_enforcement_actions(id),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_enforcement_actions_package_created
  ON security_enforcement_actions(package_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_enforcement_actions_active
  ON security_enforcement_actions(package_id, active)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS security_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enforcement_action_id UUID NOT NULL REFERENCES security_enforcement_actions(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES registry.packages(id),
  status security_appeal_status NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  notes TEXT
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'security_appeals'
      AND column_name = 'status'
      AND udt_name <> 'security_appeal_status'
  ) THEN
    ALTER TABLE security_appeals
      ALTER COLUMN status TYPE security_appeal_status
      USING (
        CASE
          WHEN status IN ('open', 'triaged', 'in_review', 'resolved', 'dismissed')
            THEN status::security_appeal_status
          ELSE 'open'::security_appeal_status
        END
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'security_enforcement_actions'
      AND column_name = 'source'
      AND udt_name <> 'security_enforcement_source'
  ) THEN
    ALTER TABLE security_enforcement_actions
      ALTER COLUMN source TYPE security_enforcement_source
      USING (
        CASE
          WHEN source IN ('security_governance', 'manual_review', 'system_recompute')
            THEN source::security_enforcement_source
          ELSE 'security_governance'::security_enforcement_source
        END
      );
  END IF;
END;
$$;

CREATE MATERIALIZED VIEW IF NOT EXISTS security_reporter_metrics_30d AS
SELECT
  reporter_id,
  COUNT(*) FILTER (WHERE queue <> 'rejected')::BIGINT AS accepted_reports_30d,
  COUNT(*) FILTER (WHERE queue = 'rejected')::BIGINT AS rejected_reports_30d,
  COUNT(*) FILTER (WHERE severity = 'critical')::BIGINT AS critical_reports_30d,
  COUNT(*) FILTER (WHERE reason_code = 'abuse_suspected')::BIGINT AS abuse_rejections_30d,
  COUNT(DISTINCT package_id)::BIGINT AS unique_packages_30d,
  COALESCE(AVG(evidence_count)::NUMERIC(12, 2), 0::NUMERIC(12, 2)) AS avg_evidence_count_30d,
  now() AS refreshed_at
FROM security_reports
WHERE created_at >= now() - interval '30 days'
GROUP BY reporter_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_reporter_metrics_30d_reporter
  ON security_reporter_metrics_30d(reporter_id);

CREATE OR REPLACE FUNCTION security_refresh_reporter_metrics_30d(run_concurrently BOOLEAN DEFAULT TRUE)
RETURNS VOID AS $$
BEGIN
  IF run_concurrently THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY security_reporter_metrics_30d;
  ELSE
    REFRESH MATERIALIZED VIEW security_reporter_metrics_30d;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_recompute_reporter_scores()
RETURNS TABLE (
  reporter_id TEXT,
  trust_score NUMERIC(8, 4),
  computed_at TIMESTAMPTZ
) AS $$
BEGIN
  PERFORM assert_security_reporter_metrics_ready();

  RETURN QUERY
  SELECT
    metrics.reporter_id,
    LEAST(
      1::NUMERIC,
      GREATEST(
        0::NUMERIC,
        (
          0.45 * COALESCE(metrics.accepted_reports_30d::NUMERIC, 0)
          - 0.35 * COALESCE(metrics.rejected_reports_30d::NUMERIC, 0)
          - 0.20 * COALESCE(metrics.abuse_rejections_30d::NUMERIC, 0)
          + 0.10 * COALESCE(metrics.unique_packages_30d::NUMERIC, 0)
        ) / 100
      )
    )::NUMERIC(8, 4) AS trust_score,
    now() AS computed_at
  FROM security_reporter_metrics_30d AS metrics;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION security_recompute_reporter_scores()
  IS 'DR-016: score recompute path must assert security_reporter_metrics_30d readiness via assert_security_reporter_metrics_ready().';
