-- DR-017 + DR-019 completion migration: appeals SLA metrics, permanent-block promotion enforcement, and trust-gate decision logging.
-- LOCK RISK:
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS takes brief metadata locks on security_appeals.
--   - CREATE TABLE/INDEX IF NOT EXISTS takes catalog locks only.
-- Rollback playbook:
--   - Prefer forward compensating migration that disables promotion/rollout writes and preserves audit history.
--   - Do not run destructive down migration in production.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_appeal_priority') THEN
    CREATE TYPE security_appeal_priority AS ENUM ('critical', 'standard');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_appeal_resolution') THEN
    CREATE TYPE security_appeal_resolution AS ENUM (
      'upheld',
      'reversed_false_positive',
      'dismissed',
      'withdrawn'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_rollout_mode') THEN
    CREATE TYPE security_rollout_mode AS ENUM ('raw-only', 'flagged-first', 'full-catalog');
  END IF;
END;
$$;

ALTER TABLE security_appeals
  ADD COLUMN IF NOT EXISTS priority security_appeal_priority NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_count INTEGER NOT NULL DEFAULT 0 CHECK (escalation_count >= 0),
  ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution security_appeal_resolution,
  ADD COLUMN IF NOT EXISTS reviewer_id TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_security_appeals_status_opened
  ON security_appeals(status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_appeals_priority_opened
  ON security_appeals(priority, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_appeals_resolution_resolved
  ON security_appeals(resolution, resolved_at DESC)
  WHERE resolution IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_enforcement_rollout_state (
  singleton_key BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_key = TRUE),
  current_mode security_rollout_mode NOT NULL DEFAULT 'raw-only',
  freeze_active BOOLEAN NOT NULL DEFAULT TRUE,
  freeze_reason TEXT,
  decision_run_id TEXT,
  decision_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO security_enforcement_rollout_state (
  singleton_key,
  current_mode,
  freeze_active,
  freeze_reason,
  decision_run_id,
  decision_evidence,
  updated_at
)
VALUES (
  TRUE,
  'raw-only',
  TRUE,
  'initial_rollout_state_until_gate_decisions',
  'bootstrap',
  jsonb_build_object('source', 'migration-015'),
  now()
)
ON CONFLICT (singleton_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS security_enforcement_promotion_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('hold', 'promote', 'revert', 'freeze')),
  previous_mode security_rollout_mode NOT NULL,
  decided_mode security_rollout_mode NOT NULL,
  freeze_active BOOLEAN NOT NULL,
  gate_false_positive_pass BOOLEAN NOT NULL,
  gate_appeals_sla_pass BOOLEAN NOT NULL,
  gate_backlog_pass BOOLEAN NOT NULL,
  window_from TIMESTAMPTZ NOT NULL,
  window_to TIMESTAMPTZ NOT NULL,
  trigger TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_enforcement_promotion_decisions_created
  ON security_enforcement_promotion_decisions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_enforcement_promotion_decisions_mode
  ON security_enforcement_promotion_decisions(previous_mode, decided_mode, created_at DESC);

CREATE OR REPLACE FUNCTION security_validate_perm_block_requirements(
  p_package_id UUID,
  p_reviewer_id TEXT,
  p_reviewer_confirmed_at TIMESTAMPTZ DEFAULT now(),
  p_window INTERVAL DEFAULT interval '30 days'
)
RETURNS TABLE (
  eligible BOOLEAN,
  trusted_reporter_count INTEGER,
  distinct_active_key_count INTEGER,
  corroborating_report_count INTEGER,
  reviewer_confirmed BOOLEAN,
  evidence JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_reporter_count INTEGER := 0;
  v_key_count INTEGER := 0;
  v_corroborating_count INTEGER := 0;
  v_reviewer_confirmed BOOLEAN := FALSE;
  v_eligible BOOLEAN := FALSE;
BEGIN
  SELECT
    COUNT(DISTINCT reports.reporter_id)::INTEGER,
    COUNT(DISTINCT reports.reporter_key_id)::INTEGER,
    COUNT(*)::INTEGER
  INTO
    v_reporter_count,
    v_key_count,
    v_corroborating_count
  FROM security_reports AS reports
  JOIN security_reporters AS reporters
    ON reporters.reporter_id = reports.reporter_id
  WHERE reports.package_id = p_package_id
    AND reports.queue <> 'rejected'
    AND reports.signature_valid = TRUE
    AND reports.evidence_minimums_met = TRUE
    AND reports.evidence_count > 0
    AND reporters.status = 'active'
    AND reports.created_at >= now() - p_window;

  v_reviewer_confirmed :=
    p_reviewer_id IS NOT NULL
    AND btrim(p_reviewer_id) <> ''
    AND p_reviewer_confirmed_at IS NOT NULL;

  v_eligible :=
    v_reporter_count >= 2
    AND v_key_count >= 2
    AND v_corroborating_count >= 2
    AND v_reviewer_confirmed;

  RETURN QUERY
  SELECT
    v_eligible,
    v_reporter_count,
    v_key_count,
    v_corroborating_count,
    v_reviewer_confirmed,
    jsonb_build_object(
      'trusted_reporter_count', v_reporter_count,
      'distinct_active_key_count', v_key_count,
      'corroborating_report_count', v_corroborating_count,
      'reviewer_confirmed', v_reviewer_confirmed,
      'required_reporter_count', 2,
      'required_distinct_key_count', 2,
      'required_corroborating_report_count', 2
    );
END;
$$;

CREATE OR REPLACE FUNCTION security_promote_policy_block_perm(
  p_package_id UUID,
  p_reason_code TEXT,
  p_reviewer_id TEXT,
  p_reviewer_confirmed_at TIMESTAMPTZ DEFAULT now(),
  p_created_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  action_id TEXT,
  evidence JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_validation RECORD;
  v_action_id TEXT;
  v_reason_code TEXT;
BEGIN
  SELECT *
  INTO v_validation
  FROM security_validate_perm_block_requirements(
    p_package_id,
    p_reviewer_id,
    p_reviewer_confirmed_at,
    interval '30 days'
  );

  IF COALESCE(v_validation.eligible, FALSE) = FALSE THEN
    RAISE EXCEPTION 'perm_block_requirements_not_met'
      USING DETAIL = COALESCE(v_validation.evidence::TEXT, '{}');
  END IF;

  v_action_id := 'perm:' || replace(gen_random_uuid()::TEXT, '-', '');
  v_reason_code := COALESCE(NULLIF(btrim(p_reason_code), ''), 'policy_blocked_malware');

  INSERT INTO security_enforcement_actions (
    action_id,
    package_id,
    state,
    reason_code,
    source,
    active,
    supersedes_action_id,
    expires_at,
    metadata,
    created_at
  )
  VALUES (
    v_action_id,
    p_package_id,
    'policy_blocked_perm',
    v_reason_code,
    'manual_review',
    TRUE,
    NULL,
    NULL,
    jsonb_build_object(
      'promotion_rule', 'dr017_two_sources_plus_reviewer_confirmation',
      'reviewer_id', p_reviewer_id,
      'reviewer_confirmed_at', p_reviewer_confirmed_at,
      'requirements_evidence', v_validation.evidence
    ),
    p_created_at
  );

  INSERT INTO security_enforcement_projections (
    package_id,
    state,
    reason_code,
    policy_blocked,
    warning_only,
    source,
    updated_at
  )
  VALUES (
    p_package_id,
    'policy_blocked_perm',
    v_reason_code,
    TRUE,
    FALSE,
    'manual_review',
    p_created_at
  )
  ON CONFLICT (package_id) DO UPDATE
  SET
    state = EXCLUDED.state,
    reason_code = EXCLUDED.reason_code,
    policy_blocked = EXCLUDED.policy_blocked,
    warning_only = EXCLUDED.warning_only,
    source = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY
  SELECT
    v_action_id,
    COALESCE(v_validation.evidence, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION security_validate_perm_block_requirements(UUID, TEXT, TIMESTAMPTZ, INTERVAL)
  IS 'DR-017 rule guard: permanent block requires two distinct active trusted reporters, two distinct active keys, corroborating evidence, and reviewer confirmation.';

COMMENT ON FUNCTION security_promote_policy_block_perm(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  IS 'DR-017 workflow guard: enforces two-source + reviewer-confirmation before inserting policy_blocked_perm action and projection.';

COMMENT ON TABLE security_enforcement_rollout_state
  IS 'DR-019 rollout gate state. freeze_active=true forces raw-only behavior until gate regression is cleared.';

COMMENT ON TABLE security_enforcement_promotion_decisions
  IS 'DR-019 decision log with explicit gate pass/fail evidence for promotion/revert/freeze actions.';
