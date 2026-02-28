# Event Ingestion and Fraud Baseline Runbook

## Scope
Operational guide for DB-backed event ingestion, fraud-flag recording, and replay-safe async handoff.

## Components
1. Event contracts: `packages/shared-contracts/src/event-types.ts`, `telemetry-envelope.ts`, `event-validation.ts`.
2. Ingestion service and HTTP handler:
   - `apps/control-plane/src/index.ts`
   - `apps/control-plane/src/http-handler.ts`
3. Postgres adapters:
   - `apps/control-plane/src/postgres-adapters.ts`
   - `packages/security-governance/src/postgres-adapters.ts`
4. Baseline schema:
   - `infra/postgres/migrations/003_event_and_fraud_foundations.sql`
   - `infra/postgres/migrations/007_async_boundaries_and_projection_snapshots.sql`

## Safety defaults
1. Event validation rejects malformed envelopes and forbidden payload fields.
2. Behavioral telemetry is rejected when `consent_state=denied` unless explicitly overridden in validator options.
3. Fraud disposition defaults remain deterministic (`clean`, `flagged`, `blocked`) with no partial weighting.
4. `registry_packages` compatibility relation remains the FK target until DR-018 is approved.
5. Async fanout uses idempotent outbox writes (`dedupe_key` unique) to prevent duplicate downstream side effects on replays.

## Verification
1. `npm run typecheck`
2. `npm run test`
3. Confirm integration tests:
   - `tests/integration/event-ingestion.integration.test.ts`
   - `tests/integration/event-ingestion-db-adapters.integration.test.ts`
   - `tests/integration/fraud-preflight.integration.test.ts`

## Operational checks
1. Confirm DB adapter tables exist before enabling production traffic:
   - `ingestion_idempotency_records`
   - `raw_events`
   - `event_flags`
   - `ingestion_outbox`
2. Confirm replay-safe behavior:
   - first request returns `status=accepted`
   - same payload + same key returns `status=replayed` with previously stored response body
   - same key + different request hash returns `status=conflict`
3. Confirm outbox fanout only occurs on accepted events:
   - expected event types: `fraud.reconcile.requested`, `ranking.sync.requested`

## Idempotency conflict handling (Wave 2)
1. Scope idempotency uniqueness by route semantics (`idempotency_scope`, `idempotency_key`), not global key-only uniqueness.
2. Treat `same idempotency_key + same request_hash` as replay (`status=replayed`).
3. Treat `same idempotency_key + different request_hash` as deterministic conflict (`status=conflict`, `reason=idempotency_key_reused_with_different_payload`).
4. Operational response:
   - verify client retries are reusing stable payload serialization;
   - inspect request hash and header/body canonicalization at the caller;
   - if mismatch was intentional, require a new idempotency key.
5. DB adapter race safety:
   - conflicting write at persistence layer raises `idempotency_conflict`;
   - caller must return deterministic conflict instead of retrying blind.

## Signed-ingestion failure triage (DR-016 runtime path)
1. Validation sequence:
   - canonical body hash check (`x-body-sha256`);
   - timestamp skew window (`<=5m`);
   - nonce replay check with TTL window (`24h`);
   - reporter/key signature verification;
   - evaluator gates (`reporter_status`, evidence minima, abuse signal).
2. Common rejection codes and first checks:
   - `body_hash_mismatch`: recompute canonical JSON SHA-256 and compare with `x-body-sha256`.
   - `timestamp_skew_exceeded`: compare caller clock to server clock.
   - `nonce_replayed`: verify nonce uniqueness per reporter over active TTL.
   - `signature_invalid`: verify `(reporter_id, key_id)` public key mapping and canonical string.
   - `reporter_not_active`/`evidence_minimums_missing`: inspect reporter directory status and payload evidence.
3. Reporter score recompute guard:
   - all recompute paths must execute `assert_security_reporter_metrics_ready()` first;
   - if guard fails, restore/refresh `security_reporter_metrics_30d` before rerun.
