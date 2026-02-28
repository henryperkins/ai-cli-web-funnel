-- DR-018 migration wave (part 1): introduce canonical registry.packages relation with compatibility bridge.
-- LOCK RISK: ALTER TABLE ... SET SCHEMA and RENAME take ACCESS EXCLUSIVE locks on legacy registry_packages.
-- Expected lock window is short because no data rewrite is performed.
-- Rollback strategy: forward compensating migration that recreates a physical public.registry_packages table
-- from registry.packages if rollback is required; no destructive down migration.

CREATE SCHEMA IF NOT EXISTS registry;

DO $$
DECLARE
  legacy_kind "char";
BEGIN
  IF to_regclass('registry.packages') IS NULL AND to_regclass('public.registry_packages') IS NOT NULL THEN
    SELECT relkind INTO legacy_kind
    FROM pg_class
    WHERE oid = 'public.registry_packages'::regclass;

    IF legacy_kind = 'r' THEN
      ALTER TABLE public.registry_packages SET SCHEMA registry;
      ALTER TABLE registry.registry_packages RENAME TO packages;
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS registry.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID UNIQUE,
  package_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  canonical_repo TEXT,
  repo_aliases TEXT[] NOT NULL DEFAULT '{}',
  is_fork BOOLEAN NOT NULL DEFAULT FALSE,
  fork_parent UUID REFERENCES registry.packages(id)
);

ALTER TABLE registry.packages
  ADD COLUMN IF NOT EXISTS canonical_repo TEXT,
  ADD COLUMN IF NOT EXISTS repo_aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_fork BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fork_parent UUID REFERENCES registry.packages(id);

CREATE INDEX IF NOT EXISTS idx_registry_packages_canonical_repo
  ON registry.packages(canonical_repo);

CREATE INDEX IF NOT EXISTS idx_registry_packages_fork_parent
  ON registry.packages(fork_parent);

DO $$
DECLARE
  legacy_kind "char";
BEGIN
  IF to_regclass('public.registry_packages') IS NOT NULL THEN
    SELECT relkind INTO legacy_kind
    FROM pg_class
    WHERE oid = 'public.registry_packages'::regclass;

    IF legacy_kind = 'r' THEN
      INSERT INTO registry.packages (
        id,
        package_id,
        package_slug,
        created_at,
        updated_at,
        canonical_repo,
        repo_aliases,
        is_fork,
        fork_parent
      )
      SELECT
        id,
        package_id,
        package_slug,
        created_at,
        updated_at,
        canonical_repo,
        repo_aliases,
        is_fork,
        fork_parent
      FROM public.registry_packages
      ON CONFLICT (id) DO UPDATE
      SET
        package_id = EXCLUDED.package_id,
        package_slug = EXCLUDED.package_slug,
        updated_at = EXCLUDED.updated_at,
        canonical_repo = EXCLUDED.canonical_repo,
        repo_aliases = EXCLUDED.repo_aliases,
        is_fork = EXCLUDED.is_fork,
        fork_parent = EXCLUDED.fork_parent;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.registry_packages AS
SELECT
  id,
  package_id,
  package_slug,
  created_at,
  updated_at,
  canonical_repo,
  repo_aliases,
  is_fork,
  fork_parent
FROM registry.packages;

COMMENT ON VIEW public.registry_packages IS
  'DR-018 compatibility bridge. Canonical package relation is registry.packages; keep this view until all legacy reads are migrated.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.confrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE c.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = 'registry_packages'
  ) THEN
    RAISE EXCEPTION 'Foreign keys must not target public.registry_packages compatibility view';
  END IF;
END;
$$;
