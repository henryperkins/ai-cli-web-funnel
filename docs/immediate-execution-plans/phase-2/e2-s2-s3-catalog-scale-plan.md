# E2-S2/S3 Plan: Catalog Scale (Docs Connector + Scheduled Reconciliation)

Stories: `E2-S2`, `E2-S3`
Owner: Catalog + Data Platform
Priority: `P0`
Status: Done (2026-02-28)

## Objective

Complete catalog ingestion scale-up by adding docs/web source ingestion and scheduled reconciliation with freshness SLA tracking.

## In Scope

1. Docs/web connector implementation and normalization.
2. Scheduled ingestion/reconciliation job path.
3. Freshness status tracking and queryable visibility.
4. Operational runbook notes for connector and schedule failures.

## Out of Scope

1. Identity conflict review workflow (`E2-S4`, P1).
2. UI-level catalog analytics.

## Implementation Steps

1. Implement docs/web connector (`E2-S2`).
- Add connector module with deterministic extraction and normalization.
- Enforce schema-safe parsing and fallback behavior.
- Add explicit failure classes for inaccessible/invalid sources.

2. Add scheduled reconciliation (`E2-S3`).
- Add scheduler/runner entry point for periodic ingest.
- Add bounded retry/backoff behavior and idempotent re-runs.
- Persist and expose freshness markers.

3. Surface freshness data.
- Add API/read path for freshness metadata.
- Ensure stale/fresh states are explicit for operators.

4. Add tests.
- Unit tests for connector normalization and failure handling.
- Integration coverage for scheduled run behavior.

5. Document operations.
- Add runbook notes for schedule failures and stale catalog recovery.

## File Touchpoints

1. `packages/catalog/src/`
2. `packages/catalog/tests/`
3. `scripts/run-catalog-ingest.mjs`
4. `apps/control-plane/src/catalog-routes.ts`
5. `docs/runbooks/`
6. `.env.example` (if new env vars are required)

## Validation Commands

1. `npm run test --workspace @forge/catalog`
2. `npm run typecheck`
3. `npm run test`
4. `npm run check`
5. `npm run run:catalog-ingest -- --mode dry-run --input <fixture-json>`

## Exit Criteria

1. Docs/web connector is deterministic and test-covered.
2. Scheduled reconciliation path runs with replay-safe behavior.
3. Freshness status is queryable and documented.
