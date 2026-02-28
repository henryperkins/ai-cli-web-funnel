-- Backfill idempotency scope semantics for existing environments created before migration 003 update.
-- Keeps idempotency uniqueness scoped to ingestion route semantics (POST:/v1/events) instead of global key-only uniqueness.

ALTER TABLE raw_events
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT;

UPDATE raw_events
SET idempotency_scope = 'POST:/v1/events'
WHERE idempotency_scope IS NULL;

ALTER TABLE raw_events
  ALTER COLUMN idempotency_scope SET DEFAULT 'POST:/v1/events';

ALTER TABLE raw_events
  ALTER COLUMN idempotency_scope SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'raw_events_idempotency_key_key'
      AND conrelid = 'raw_events'::regclass
  ) THEN
    ALTER TABLE raw_events DROP CONSTRAINT raw_events_idempotency_key_key;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'raw_events_idempotency_scope_idempotency_key_key'
      AND conrelid = 'raw_events'::regclass
  ) THEN
    ALTER TABLE raw_events
      ADD CONSTRAINT raw_events_idempotency_scope_idempotency_key_key
      UNIQUE (idempotency_scope, idempotency_key);
  END IF;
END;
$$;
