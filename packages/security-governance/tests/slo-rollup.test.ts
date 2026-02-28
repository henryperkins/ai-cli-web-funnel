import { describe, expect, it } from 'vitest';
import {
  createOperationalSloRollupService,
  type OperationalSloRollupMetricSnapshot,
  type OperationalSloRollupRunResult
} from '../src/slo-rollup.js';

function createInMemoryDb() {
  const tables: {
    runs: Array<Record<string, unknown>>;
    snapshots: Array<Record<string, unknown>>;
  } = { runs: [], snapshots: [] };

  let transactionActive = false;
  let idCounter = 0;

  return {
    tables,
    query: async <Row = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = []
    ): Promise<{ rows: Row[]; rowCount: number | null }> => {
      const trimmed = sql.trim().toUpperCase();

      if (trimmed === 'BEGIN') {
        transactionActive = true;
        return { rows: [] as Row[], rowCount: null };
      }
      if (trimmed === 'COMMIT') {
        transactionActive = false;
        return { rows: [] as Row[], rowCount: null };
      }
      if (trimmed === 'ROLLBACK') {
        transactionActive = false;
        return { rows: [] as Row[], rowCount: null };
      }

      // INSERT INTO operational_slo_rollup_runs
      if (trimmed.startsWith('INSERT INTO OPERATIONAL_SLO_ROLLUP_RUNS')) {
        idCounter++;
        const id = `fake-uuid-${idCounter}`;
        tables.runs.push({
          id,
          run_id: params[0],
          mode: params[1],
          trigger: params[2],
          window_from: params[3],
          window_to: params[4],
          batch_limit: params[5],
          status: 'running',
          created_at: params[6]
        });
        return { rows: [{ id } as unknown as Row], rowCount: 1 };
      }

      // INSERT INTO operational_slo_snapshots
      if (trimmed.startsWith('INSERT INTO OPERATIONAL_SLO_SNAPSHOTS')) {
        tables.snapshots.push({
          run_internal_id: params[0],
          run_id: params[1],
          metric_key: params[2],
          window_from: params[3],
          window_to: params[4],
          numerator: params[5],
          denominator: params[6],
          ratio: params[7],
          sample_size: params[8],
          metadata: params[9],
          created_at: params[10]
        });
        return { rows: [] as Row[], rowCount: 1 };
      }

      // UPDATE operational_slo_rollup_runs SET status = 'completed'
      if (trimmed.startsWith('UPDATE OPERATIONAL_SLO_ROLLUP_RUNS')) {
        const run = tables.runs.find((r) => r.id === params[0]);
        if (run) {
          run.status = 'completed';
          run.snapshot_count = params[1];
          run.completed_at = params[2];
        }
        return { rows: [] as Row[], rowCount: 1 };
      }

      // SELECT COUNT(*) queries — return 0 for all metrics (empty window)
      if (trimmed.includes('SELECT COUNT(*)')) {
        return { rows: [{ count: '0' } as unknown as Row], rowCount: 1 };
      }

      return { rows: [] as Row[], rowCount: null };
    }
  };
}

function createSeededDb(counts: Record<string, number>) {
  const base = createInMemoryDb();
  const originalQuery = base.query;
  let queryIndex = 0;

  // The SLO service makes 17 sequential COUNT queries in order:
  const queryOrder = [
    'outbox_total',
    'outbox_dead_letter',
    'outbox_failed',
    'retrieval_total',
    'retrieval_fallback',
    'apply_total',
    'apply_succeeded',
    'verify_total',
    'verify_succeeded',
    'replay_total',
    'replay_count',
    'profile_runs_total',
    'profile_runs_succeeded',
    'profile_runs_partial',
    'governance_actions_total',
    'governance_recompute_requested',
    'governance_recompute_processed'
  ];

  base.query = async <Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> => {
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.includes('PERCENTILE_CONT(0.9)')) {
      const p90 = counts.ttfsc_p90_seconds ?? 0;
      const sampleSize = counts.ttfsc_sample_size ?? 0;
      const withinTarget = counts.ttfsc_within_target ?? 0;
      return {
        rows: [
          {
            p90_seconds: String(p90),
            sample_size: String(sampleSize),
            within_target: String(withinTarget)
          } as unknown as Row
        ],
        rowCount: 1
      };
    }

    if (trimmed.includes('WITH COLD_STARTS AS')) {
      return {
        rows: [
          {
            total: String(counts.cold_start_total ?? 0),
            succeeded: String(counts.cold_start_succeeded ?? 0)
          } as unknown as Row
        ],
        rowCount: 1
      };
    }

    if (trimmed.includes('WITH RUNTIME_STARTS AS')) {
      return {
        rows: [
          {
            total: String(counts.retryless_total ?? 0),
            succeeded: String(counts.retryless_succeeded ?? 0)
          } as unknown as Row
        ],
        rowCount: 1
      };
    }

    if (trimmed.includes('SELECT COUNT(*)')) {
      const key = queryOrder[queryIndex] ?? 'unknown';
      queryIndex++;
      const count = counts[key] ?? 0;
      return { rows: [{ count: String(count) } as unknown as Row], rowCount: 1 };
    }

    return originalQuery<Row>(sql, params);
  };

  return base;
}

describe('operational SLO rollup service', () => {
  const fixedDate = new Date('2026-02-28T12:00:00Z');
  const windowFrom = '2026-02-28T00:00:00Z';
  const windowTo = '2026-02-28T12:00:00Z';

  describe('dry-run mode', () => {
    it('returns metrics without persisting', async () => {
      const db = createInMemoryDb();
      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      const result = await service.run({
        run_id: 'run-dry-001',
        mode: 'dry-run',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'manual',
        limit: 100
      });

      expect(result.run_id).toBe('run-dry-001');
      expect(result.mode).toBe('dry-run');
      expect(result.persisted).toBe(false);
      expect(result.window_from).toBe(windowFrom);
      expect(result.window_to).toBe(windowTo);
      expect(result.metrics).toHaveLength(10);
      expect(db.tables.runs).toHaveLength(0);
      expect(db.tables.snapshots).toHaveLength(0);
    });

    it('returns all expected metric keys', async () => {
      const db = createInMemoryDb();
      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      const result = await service.run({
        run_id: 'run-dry-keys',
        mode: 'dry-run',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'test',
        limit: 50
      });

      const metricKeys = result.metrics.map((m) => m.metric_key);
      expect(metricKeys).toEqual([
        'outbox.dispatch.dead_letter_rate',
        'retrieval.semantic_fallback.rate',
        'install.apply.success_rate',
        'install.verify.success_rate',
        'install.lifecycle.replay_ratio',
        'profile.install_run.success_rate',
        'governance.recompute.dispatch_success_rate',
        'funnel.ttfsc.p90_seconds',
        'funnel.cold_start.success_rate',
        'funnel.retryless.success_rate'
      ]);
    });

    it('computes ratios from seeded counts', async () => {
      const db = createSeededDb({
        outbox_total: 100,
        outbox_dead_letter: 5,
        outbox_failed: 3,
        retrieval_total: 200,
        retrieval_fallback: 20,
        apply_total: 50,
        apply_succeeded: 45,
        verify_total: 40,
        verify_succeeded: 38,
        replay_total: 30,
        replay_count: 6,
        profile_runs_total: 10,
        profile_runs_succeeded: 8,
        profile_runs_partial: 1,
        governance_actions_total: 15,
        governance_recompute_requested: 12,
        governance_recompute_processed: 11,
        ttfsc_p90_seconds: 240,
        ttfsc_sample_size: 40,
        ttfsc_within_target: 36,
        cold_start_total: 20,
        cold_start_succeeded: 19,
        retryless_total: 20,
        retryless_succeeded: 17
      });

      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      const result = await service.run({
        run_id: 'run-dry-seeded',
        mode: 'dry-run',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'test',
        limit: 100
      });

      const byKey = (key: string) => result.metrics.find((m) => m.metric_key === key)!;

      expect(byKey('outbox.dispatch.dead_letter_rate').ratio).toBe(0.05);
      expect(byKey('outbox.dispatch.dead_letter_rate').metadata).toEqual({ failed_count: 3 });
      expect(byKey('retrieval.semantic_fallback.rate').ratio).toBe(0.1);
      expect(byKey('install.apply.success_rate').ratio).toBe(0.9);
      expect(byKey('install.verify.success_rate').ratio).toBe(0.95);
      expect(byKey('install.lifecycle.replay_ratio').ratio).toBe(0.2);
      expect(byKey('profile.install_run.success_rate').ratio).toBe(0.8);
      expect(byKey('profile.install_run.success_rate').metadata).toEqual({ partially_failed_count: 1 });
      expect(byKey('governance.recompute.dispatch_success_rate').ratio).toBeCloseTo(0.916667, 5);
      expect(byKey('funnel.ttfsc.p90_seconds').ratio).toBe(0.8);
      expect(byKey('funnel.ttfsc.p90_seconds').metadata).toMatchObject({
        target_seconds: 300,
        p90_seconds_exact: 240,
        within_target_count: 36,
        within_target_rate: 0.9,
        meets_target: true
      });
      expect(byKey('funnel.cold_start.success_rate').ratio).toBe(0.95);
      expect(byKey('funnel.retryless.success_rate').ratio).toBe(0.85);
    });
  });

  describe('production mode', () => {
    it('persists run and snapshot rows', async () => {
      const db = createInMemoryDb();
      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      const result = await service.run({
        run_id: 'run-prod-001',
        mode: 'production',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'scheduled',
        limit: 100
      });

      expect(result.persisted).toBe(true);
      expect(result.mode).toBe('production');
      expect(db.tables.runs).toHaveLength(1);
      expect(db.tables.runs[0]!.run_id).toBe('run-prod-001');
      expect(db.tables.runs[0]!.status).toBe('completed');
      expect(db.tables.runs[0]!.snapshot_count).toBe(10);
      expect(db.tables.snapshots).toHaveLength(10);
    });

    it('links snapshots to run internal id', async () => {
      const db = createInMemoryDb();
      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      await service.run({
        run_id: 'run-prod-link',
        mode: 'production',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'test',
        limit: 50
      });

      const runId = db.tables.runs[0]!.id as string;
      for (const snap of db.tables.snapshots) {
        expect(snap.run_internal_id).toBe(runId);
        expect(snap.run_id).toBe('run-prod-link');
      }
    });
  });

  describe('edge cases', () => {
    it('returns null ratio when denominator is zero', async () => {
      const db = createInMemoryDb();
      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      const result = await service.run({
        run_id: 'run-edge-zero',
        mode: 'dry-run',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'test',
        limit: 100
      });

      for (const metric of result.metrics) {
        expect(metric.ratio).toBeNull();
        expect(metric.numerator).toBe(0);
        if (metric.metric_key === 'funnel.ttfsc.p90_seconds') {
          expect(metric.denominator).toBe(300);
        } else {
          expect(metric.denominator).toBe(0);
        }
      }
    });

    it('uses current time when no now function provided', async () => {
      const db = createInMemoryDb();
      const service = createOperationalSloRollupService({ db });

      const before = Date.now();
      const result = await service.run({
        run_id: 'run-no-now',
        mode: 'dry-run',
        window_from: windowFrom,
        window_to: windowTo,
        trigger: 'test',
        limit: 100
      });
      const after = Date.now();

      expect(result.run_id).toBe('run-no-now');
      // Should succeed without errors
      expect(result.metrics).toHaveLength(10);
    });

    it('rolls back transaction on insert failure in production mode', async () => {
      const db = createInMemoryDb();
      let transactionOps: string[] = [];

      const originalQuery = db.query;
      let insertCount = 0;
      db.query = async <Row = Record<string, unknown>>(
        sql: string,
        params: readonly unknown[] = []
      ): Promise<{ rows: Row[]; rowCount: number | null }> => {
        const trimmed = sql.trim().toUpperCase();

        if (trimmed === 'BEGIN') transactionOps.push('BEGIN');
        if (trimmed === 'COMMIT') transactionOps.push('COMMIT');
        if (trimmed === 'ROLLBACK') transactionOps.push('ROLLBACK');

        // Fail on snapshot insert after run insert succeeds
        if (trimmed.startsWith('INSERT INTO OPERATIONAL_SLO_SNAPSHOTS')) {
          insertCount++;
          if (insertCount >= 2) {
            throw new Error('simulated_snapshot_insert_failure');
          }
        }

        return originalQuery<Row>(sql, params);
      };

      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      await expect(
        service.run({
          run_id: 'run-fail',
          mode: 'production',
          window_from: windowFrom,
          window_to: windowTo,
          trigger: 'test',
          limit: 100
        })
      ).rejects.toThrow('simulated_snapshot_insert_failure');

      expect(transactionOps).toContain('BEGIN');
      expect(transactionOps).toContain('ROLLBACK');
      expect(transactionOps).not.toContain('COMMIT');
    });

    it('throws when run insert returns no id', async () => {
      const db = createInMemoryDb();
      const originalQuery = db.query;

      db.query = async <Row = Record<string, unknown>>(
        sql: string,
        params: readonly unknown[] = []
      ): Promise<{ rows: Row[]; rowCount: number | null }> => {
        const trimmed = sql.trim().toUpperCase();

        if (trimmed.startsWith('INSERT INTO OPERATIONAL_SLO_ROLLUP_RUNS')) {
          return { rows: [] as Row[], rowCount: 0 };
        }

        return originalQuery<Row>(sql, params);
      };

      const service = createOperationalSloRollupService({ db, now: () => fixedDate });

      await expect(
        service.run({
          run_id: 'run-no-id',
          mode: 'production',
          window_from: windowFrom,
          window_to: windowTo,
          trigger: 'test',
          limit: 100
        })
      ).rejects.toThrow('slo_rollup_run_insert_failed');
    });
  });
});
