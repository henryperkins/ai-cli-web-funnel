# SLO Rollup Operations

## Scope
Operator runbook for computing and persisting SLO metric rollups across time windows.

Implemented in:
1. `scripts/run-slo-rollup.mjs`
2. `infra/postgres/migrations/` — SLO tables (`operational_slo_rollup_runs`, `operational_slo_snapshots`)

## Overview
The SLO rollup aggregates operational health metrics into time-windowed snapshots. There are 7 SLO metric families:

1. **Outbox dead-letter rate** — fraction of outbox jobs that ended in `dead_letter` status.
2. **Retrieval semantic fallback rate** — fraction of retrieval queries that fell back from semantic to keyword search.
3. **Install apply success rate** — fraction of install apply operations that succeeded.
4. **Install verify success rate** — fraction of install verify operations that succeeded.
5. **Install lifecycle replay ratio** — ratio of replayed install lifecycle events to total events.
6. **Profile install run success rate** — fraction of profile install runs that completed successfully.
7. **Governance recompute dispatch success rate** — fraction of governance recompute dispatches that succeeded.

## Prerequisites
- `FORGE_DATABASE_URL` or `DATABASE_URL` environment variable must be set to a valid Postgres connection string.

## Operator commands

1. Dry-run (read-only, no writes):
   ```bash
   node scripts/run-slo-rollup.mjs --mode dry-run --from 2026-02-28T00:00:00Z --to 2026-02-28T12:00:00Z --limit 100
   ```

2. Production (persists rollup results):
   ```bash
   node scripts/run-slo-rollup.mjs --mode production --from 2026-02-28T00:00:00Z --to 2026-02-28T12:00:00Z
   ```

## Output format
The script emits structured JSON logs to stdout:

- `slo_rollup.run_started` — emitted at the beginning of a rollup run with `run_id`, `mode`, `window_from`, `window_to`.
- `slo_rollup.run_completed` — emitted on success with `run_id`, `mode`, `window_from`, `window_to`, `metric_count`, `persisted`, `metrics`.
- `slo_rollup.run_failed` — emitted on failure with `run_id`, `mode`, `window_from`, `window_to`, `failure_class`, `error_message`.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FORGE_DATABASE_URL` / `DATABASE_URL` | Postgres connection string | (required) |
| `SLO_ROLLUP_MODE` | Override mode (`dry-run` or `production`) | CLI `--mode` flag takes precedence |
| `SLO_ROLLUP_LIMIT` | Maximum number of source rows to scan | CLI `--limit` flag takes precedence |

## Symptom → cause → fix

| Symptom | Cause | Fix |
|---------|-------|-----|
| `FORGE_DATABASE_URL or DATABASE_URL is required` | No database connection string configured | Set `FORGE_DATABASE_URL` or `DATABASE_URL` environment variable |
| `Invalid window` | `--from` timestamp is not earlier than `--to` | Ensure `--from` is chronologically before `--to` |
| `slo_rollup_run_insert_failed` | Constraint violation on `operational_slo_rollup_runs` table | Inspect the table for conflicting rows; check for schema drift |
| Duplicate `run_id` error | `run_id` uniqueness constraint violated | Each run generates a new UUID — this indicates a bug or manual insert conflict; inspect and remove the conflicting row |

## Database inspection queries

1. List recent rollup runs:
   ```sql
   SELECT run_id, mode, window_from, window_to, status, created_at
   FROM operational_slo_rollup_runs
   ORDER BY created_at DESC
   LIMIT 20;
   ```

2. Inspect snapshots for a run:
   ```sql
   SELECT run_id, metric_key, ratio, numerator, denominator, sample_size, window_from, window_to
   FROM operational_slo_snapshots
   WHERE run_id = '<run_id>'
   ORDER BY metric_key;
   ```

3. Aggregate snapshot health across recent windows:
   ```sql
   SELECT metric_key, AVG(ratio) AS avg_ratio, MIN(ratio) AS min_ratio, COUNT(*) AS snapshot_count
   FROM operational_slo_snapshots
   WHERE window_from >= NOW() - INTERVAL '7 days'
   GROUP BY metric_key
   ORDER BY metric_key;
   ```

## Validation checks
1. `npm run test:workspaces`
2. `npm run test:integration-contract`
