-- Enforce deterministic exact-slug resolution for catalog and CLI flows.
-- This migration fails closed if duplicate case-insensitive slugs still exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM registry.packages
    WHERE package_slug IS NOT NULL
    GROUP BY lower(package_slug)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_case_insensitive_package_slug_remaining';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_packages_package_slug_lower_unique
  ON registry.packages ((lower(package_slug)))
  WHERE package_slug IS NOT NULL;
