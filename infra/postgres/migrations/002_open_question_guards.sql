-- Open-question guardrails for unresolved dependencies.
-- MQ-029: guard reporter score recompute until security_reporter_metrics_30d exists.

CREATE OR REPLACE FUNCTION security_reporter_metrics_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT to_regclass('public.security_reporter_metrics_30d') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION assert_security_reporter_metrics_ready()
RETURNS VOID AS $$
BEGIN
  IF NOT security_reporter_metrics_ready() THEN
    RAISE EXCEPTION 'Missing required relation public.security_reporter_metrics_30d';
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION security_reporter_metrics_ready()
  IS 'MQ-029 guard: returns true only when security_reporter_metrics_30d exists.';

COMMENT ON FUNCTION assert_security_reporter_metrics_ready()
  IS 'MQ-029 guard: call before reporter score recompute jobs; fails closed when view/table is missing.';
