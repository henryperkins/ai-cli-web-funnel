-- DR-016 reporter metrics freshness guard hardening.
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS obtains a brief catalog lock.
--   - CREATE OR REPLACE FUNCTION updates function metadata only (no table rewrite).
-- Rollback playbook:
--   - Prefer forward compensation migration restoring previous function definitions.
--   - If emergency rollback is required, pause recompute jobs before altering guard functions.

CREATE TABLE IF NOT EXISTS security_reporter_metrics_refresh_state (
  singleton_key BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_key = TRUE),
  refreshed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO security_reporter_metrics_refresh_state (singleton_key, refreshed_at, updated_at)
VALUES (
  TRUE,
  COALESCE(
    (SELECT MAX(refreshed_at) FROM security_reporter_metrics_30d),
    now()
  ),
  now()
)
ON CONFLICT (singleton_key) DO NOTHING;

CREATE OR REPLACE FUNCTION security_refresh_reporter_metrics_30d(run_concurrently BOOLEAN DEFAULT TRUE)
RETURNS VOID AS $$
DECLARE
  refreshed_now TIMESTAMPTZ := now();
BEGIN
  IF run_concurrently THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY security_reporter_metrics_30d;
  ELSE
    REFRESH MATERIALIZED VIEW security_reporter_metrics_30d;
  END IF;

  INSERT INTO security_reporter_metrics_refresh_state (singleton_key, refreshed_at, updated_at)
  VALUES (TRUE, refreshed_now, refreshed_now)
  ON CONFLICT (singleton_key) DO UPDATE
  SET
    refreshed_at = EXCLUDED.refreshed_at,
    updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_reporter_metrics_ready(
  max_staleness INTERVAL DEFAULT interval '6 hours'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  metrics_refreshed_at TIMESTAMPTZ;
BEGIN
  IF to_regclass('public.security_reporter_metrics_30d') IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT refreshed_at
  INTO metrics_refreshed_at
  FROM security_reporter_metrics_refresh_state
  WHERE singleton_key = TRUE
  LIMIT 1;

  IF metrics_refreshed_at IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN metrics_refreshed_at >= now() - max_staleness;
END;
$$;

CREATE OR REPLACE FUNCTION assert_security_reporter_metrics_ready(
  max_staleness INTERVAL DEFAULT interval '6 hours'
)
RETURNS VOID AS $$
BEGIN
  IF to_regclass('public.security_reporter_metrics_30d') IS NULL THEN
    RAISE EXCEPTION 'Missing required relation public.security_reporter_metrics_30d';
  END IF;

  IF NOT security_reporter_metrics_ready(max_staleness) THEN
    RAISE EXCEPTION
      'security_reporter_metrics_stale: freshness exceeds allowed window %',
      max_staleness;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE security_reporter_metrics_refresh_state
  IS 'Tracks last refresh timestamp for security_reporter_metrics_30d readiness freshness guard.';

COMMENT ON FUNCTION security_reporter_metrics_ready(INTERVAL)
  IS 'MQ-029 guard: returns true only when metrics relation exists and refresh timestamp is within max_staleness.';

COMMENT ON FUNCTION assert_security_reporter_metrics_ready(INTERVAL)
  IS 'MQ-029 guard: fails closed when metrics relation is missing or stale beyond max_staleness.';
