-- Wave 5 install lifecycle persistence foundation (discover -> plan -> apply -> verify).
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take brief catalog locks only.
--   - No table rewrites or destructive DDL in this migration.
-- Rollback playbook:
--   - Prefer forward compensation migration that archives rows and retires writers.
--   - If emergency rollback is required, stop lifecycle writers first, then archive data before dropping new tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS install_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL UNIQUE,
  package_id UUID NOT NULL REFERENCES registry.packages(id) ON DELETE CASCADE,
  package_slug TEXT NOT NULL,
  target_client TEXT NOT NULL CHECK (target_client IN ('vscode_copilot')),
  target_mode TEXT NOT NULL CHECK (target_mode IN ('local')),
  status TEXT NOT NULL
    CHECK (status IN ('planned', 'apply_succeeded', 'apply_failed', 'verify_succeeded', 'verify_failed')),
  reason_code TEXT,
  policy_outcome TEXT NOT NULL CHECK (policy_outcome IN ('allowed', 'flagged', 'policy_blocked')),
  policy_reason_code TEXT,
  security_state TEXT NOT NULL,
  planner_version TEXT NOT NULL DEFAULT 'planner-v1',
  plan_hash TEXT NOT NULL,
  policy_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE install_plans IS
  'Top-level lifecycle plan records for deterministic install planning and execution tracking.';

CREATE INDEX IF NOT EXISTS idx_install_plans_package_created
  ON install_plans(package_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_install_plans_status_updated
  ON install_plans(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS install_plan_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_internal_id UUID NOT NULL REFERENCES install_plans(id) ON DELETE CASCADE,
  action_order INTEGER NOT NULL CHECK (action_order >= 0),
  action_type TEXT NOT NULL CHECK (action_type IN ('write_entry', 'remove_entry', 'skip_scope')),
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'user_profile', 'daemon_default')),
  scope_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed', 'skipped')),
  reason_code TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plan_internal_id, action_order)
);

COMMENT ON TABLE install_plan_actions IS
  'Deterministic ordered action list produced by planner and consumed by apply executor.';

CREATE INDEX IF NOT EXISTS idx_install_plan_actions_plan_status
  ON install_plan_actions(plan_internal_id, status, action_order);

CREATE TABLE IF NOT EXISTS install_plan_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_internal_id UUID NOT NULL REFERENCES install_plans(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('plan', 'apply', 'verify')),
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_code TEXT,
  correlation_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE install_plan_audit IS
  'Append-only lifecycle timeline; rows are immutable by contract and never updated in-place.';

CREATE INDEX IF NOT EXISTS idx_install_plan_audit_plan_created
  ON install_plan_audit(plan_internal_id, created_at ASC);

CREATE TABLE IF NOT EXISTS install_apply_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_internal_id UUID NOT NULL REFERENCES install_plans(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'replayed')),
  reason_code TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE(plan_internal_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_install_apply_attempts_plan_started
  ON install_apply_attempts(plan_internal_id, started_at DESC);

CREATE TABLE IF NOT EXISTS install_verify_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_internal_id UUID NOT NULL REFERENCES install_plans(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'replayed')),
  reason_code TEXT,
  readiness BOOLEAN NOT NULL DEFAULT FALSE,
  stage_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE(plan_internal_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_install_verify_attempts_plan_started
  ON install_verify_attempts(plan_internal_id, started_at DESC);
