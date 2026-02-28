import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  createOperationalSloRollupService
} from '../../packages/security-governance/src/slo-rollup.js';
import {
  createIntegrationDbExecutor,
  resetIntegrationTables
} from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

describe('integration-db: operational SLO rollup', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createIntegrationDbExecutor(pool);

  const fixedDate = new Date('2026-02-28T12:00:00Z');
  const windowFrom = '2026-02-28T00:00:00Z';
  const windowTo = '2026-02-28T12:00:00Z';

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  beforeEach(async () => {
    await resetIntegrationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('dry-run returns metrics without persisting rows', async () => {
    const service = createOperationalSloRollupService({ db, now: () => fixedDate });

    const result = await service.run({
      run_id: 'integ-dry-001',
      mode: 'dry-run',
      window_from: windowFrom,
      window_to: windowTo,
      trigger: 'integration-test',
      limit: 100
    });

    expect(result.persisted).toBe(false);
    expect(result.metrics).toHaveLength(7);

    // Verify nothing was persisted
    const runCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM operational_slo_rollup_runs`
    );
    expect(runCount.rows[0]?.count).toBe(0);

    const snapCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM operational_slo_snapshots`
    );
    expect(snapCount.rows[0]?.count).toBe(0);
  });

  it('production mode persists run and snapshot rows', async () => {
    const service = createOperationalSloRollupService({ db, now: () => fixedDate });

    const result = await service.run({
      run_id: 'integ-prod-001',
      mode: 'production',
      window_from: windowFrom,
      window_to: windowTo,
      trigger: 'integration-test',
      limit: 100
    });

    expect(result.persisted).toBe(true);
    expect(result.metrics).toHaveLength(7);

    // Verify run row exists with correct status
    const runs = await pool.query<{
      run_id: string;
      mode: string;
      status: string;
      snapshot_count: number;
      trigger: string;
    }>(
      `SELECT run_id, mode, status, snapshot_count, trigger FROM operational_slo_rollup_runs`
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]?.run_id).toBe('integ-prod-001');
    expect(runs.rows[0]?.mode).toBe('production');
    expect(runs.rows[0]?.status).toBe('completed');
    expect(runs.rows[0]?.snapshot_count).toBe(7);
    expect(runs.rows[0]?.trigger).toBe('integration-test');

    // Verify snapshot rows
    const snaps = await pool.query<{
      metric_key: string;
      numerator: string;
      denominator: string;
      ratio: string | null;
      sample_size: string;
    }>(
      `SELECT metric_key, numerator::text, denominator::text, ratio::text, sample_size::text
       FROM operational_slo_snapshots
       ORDER BY metric_key`
    );
    expect(snaps.rows).toHaveLength(7);

    const metricKeys = snaps.rows.map((r) => r.metric_key).sort();
    expect(metricKeys).toEqual([
      'governance.recompute.dispatch_success_rate',
      'install.apply.success_rate',
      'install.lifecycle.replay_ratio',
      'install.verify.success_rate',
      'outbox.dispatch.dead_letter_rate',
      'profile.install_run.success_rate',
      'retrieval.semantic_fallback.rate'
    ]);
  });

  it('enforces unique run_id constraint', async () => {
    const service = createOperationalSloRollupService({ db, now: () => fixedDate });

    await service.run({
      run_id: 'integ-unique-001',
      mode: 'production',
      window_from: windowFrom,
      window_to: windowTo,
      trigger: 'test',
      limit: 100
    });

    await expect(
      service.run({
        run_id: 'integ-unique-001',
        mode: 'production',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'test',
        limit: 100
      })
    ).rejects.toThrow();
  });

  it('counts real outbox rows in window', async () => {
    // Seed some outbox rows in the window
    await pool.query(`
      INSERT INTO ingestion_outbox (dedupe_key, event_type, payload, source_service, status, occurred_at)
      VALUES
        ('dk-1', 'install.plan.created', '{}', 'integration-test', 'completed', '2026-02-28T06:00:00Z'),
        ('dk-2', 'install.apply.succeeded', '{}', 'integration-test', 'dead_letter', '2026-02-28T07:00:00Z'),
        ('dk-3', 'install.verify.failed', '{}', 'integration-test', 'failed', '2026-02-28T08:00:00Z'),
        ('dk-out', 'install.plan.created', '{}', 'integration-test', 'completed', '2026-02-27T23:00:00Z')
    `);

    const service = createOperationalSloRollupService({ db, now: () => fixedDate });

    const result = await service.run({
      run_id: 'integ-counts-001',
      mode: 'dry-run',
      window_from: windowFrom,
      window_to: windowTo,
      trigger: 'test',
      limit: 100
    });

    const outboxMetric = result.metrics.find(
      (m) => m.metric_key === 'outbox.dispatch.dead_letter_rate'
    )!;

    // 3 in window, 1 outside
    expect(outboxMetric.denominator).toBe(3);
    expect(outboxMetric.numerator).toBe(1); // dead_letter
    expect(outboxMetric.metadata).toEqual({ failed_count: 1 });
    expect(outboxMetric.ratio).toBeCloseTo(0.333333, 5);
  });
});
