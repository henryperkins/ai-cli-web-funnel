-- Wave 8 profile/bundle foundation (CurseForge-style modpack schema).
-- LOCK RISK:
--   - CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take brief catalog locks only.
--   - No table rewrites or destructive DDL in this migration.
-- Rollback playbook:
--   - Prefer forward compensation migration that archives rows and retires writers.
--   - If emergency rollback is required, stop profile writers then archive before dropping.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: top-level profile (modpack) records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'team')),
  target_sdk TEXT NOT NULL CHECK (target_sdk IN ('claude_code', 'codex', 'both')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  profile_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE profiles IS
  'Top-level profile (modpack) records describing curated bundles of packages.';

CREATE INDEX IF NOT EXISTS idx_profiles_author
  ON profiles(author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_visibility
  ON profiles(visibility, updated_at DESC);

-- ---------------------------------------------------------------------------
-- profile_packages: packages belonging to a profile with ordering + pinning
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_internal_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES registry.packages(id) ON DELETE CASCADE,
  package_slug TEXT,
  version_pinned TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  install_order INTEGER NOT NULL CHECK (install_order >= 0),
  config_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_internal_id, package_id)
);

COMMENT ON TABLE profile_packages IS
  'Ordered package memberships within a profile, with optional version pinning and config overrides.';

CREATE INDEX IF NOT EXISTS idx_profile_packages_profile
  ON profile_packages(profile_internal_id, install_order);

CREATE INDEX IF NOT EXISTS idx_profile_packages_package
  ON profile_packages(package_id);

-- ---------------------------------------------------------------------------
-- profile_install_runs: tracks each profile-level install attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_install_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  profile_internal_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'in_progress', 'succeeded', 'partially_failed', 'failed')),
  total_packages INTEGER NOT NULL CHECK (total_packages >= 0),
  succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  correlation_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE profile_install_runs IS
  'Tracks each profile-level install orchestration run linking to individual install plans.';

CREATE INDEX IF NOT EXISTS idx_profile_install_runs_profile
  ON profile_install_runs(profile_internal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_install_runs_status
  ON profile_install_runs(status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- profile_install_run_plans: join table linking run → individual plan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_install_run_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_internal_id UUID NOT NULL REFERENCES profile_install_runs(id) ON DELETE CASCADE,
  plan_internal_id UUID NOT NULL REFERENCES install_plans(id) ON DELETE CASCADE,
  package_id UUID NOT NULL,
  install_order INTEGER NOT NULL CHECK (install_order >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'planned', 'applied', 'verified', 'failed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_internal_id, plan_internal_id)
);

COMMENT ON TABLE profile_install_run_plans IS
  'Links a profile install run to each individual install plan for per-package tracking.';

CREATE INDEX IF NOT EXISTS idx_profile_install_run_plans_run
  ON profile_install_run_plans(run_internal_id, install_order);

-- ---------------------------------------------------------------------------
-- profile_audit: append-only audit trail for profile mutations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_internal_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'created', 'updated', 'package_added', 'package_removed',
    'install_started', 'install_completed', 'exported', 'imported'
  )),
  actor_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE profile_audit IS
  'Append-only audit trail for all profile mutations.';

CREATE INDEX IF NOT EXISTS idx_profile_audit_profile
  ON profile_audit(profile_internal_id, occurred_at DESC);
