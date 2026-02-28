-- Step 1 foundations: identity aliases/conflicts and field lineage tracking.
-- Safe default: retain `registry_packages` compatibility until AQ-049/MQ-034 are approved.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS registry_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID UNIQUE,
  package_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fork/rename lineage contract fields (Redline §9)
ALTER TABLE registry_packages
  ADD COLUMN IF NOT EXISTS canonical_repo TEXT,
  ADD COLUMN IF NOT EXISTS repo_aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_fork BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fork_parent UUID REFERENCES registry_packages(id);

CREATE INDEX IF NOT EXISTS idx_registry_packages_canonical_repo ON registry_packages(canonical_repo);
CREATE INDEX IF NOT EXISTS idx_registry_packages_fork_parent ON registry_packages(fork_parent);

CREATE TABLE IF NOT EXISTS package_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES registry_packages(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('repo_rename', 'url_alias', 'registry_alias')),
  alias_value TEXT NOT NULL,
  source_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE(alias_type, alias_value)
);

CREATE INDEX IF NOT EXISTS idx_package_aliases_package ON package_aliases(package_id);
CREATE INDEX IF NOT EXISTS idx_package_aliases_active ON package_aliases(active) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS package_identity_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_fingerprint TEXT NOT NULL UNIQUE,
  canonical_locator_candidate TEXT NOT NULL,
  conflicting_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved', 'dismissed')),
  reviewer_id UUID,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- SLA support for conflict review queue (DR-003 acceptance)
ALTER TABLE package_identity_conflicts
  ADD COLUMN IF NOT EXISTS review_sla_hours INTEGER NOT NULL DEFAULT 48 CHECK (review_sla_hours > 0),
  ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  ADD COLUMN IF NOT EXISTS first_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_identity_conflicts_status_created
  ON package_identity_conflicts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_conflicts_due_open
  ON package_identity_conflicts(review_due_at)
  WHERE status IN ('open', 'triaged');

CREATE TABLE IF NOT EXISTS package_merge_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_run_id TEXT NOT NULL UNIQUE,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_field_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES registry_packages(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value_json JSONB NOT NULL,
  field_source TEXT NOT NULL,
  field_source_updated_at TIMESTAMPTZ,
  merge_run_id TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(package_id, field_name, merge_run_id)
);

CREATE INDEX IF NOT EXISTS idx_field_lineage_package_resolved
  ON package_field_lineage(package_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_lineage_merge_run
  ON package_field_lineage(merge_run_id);
