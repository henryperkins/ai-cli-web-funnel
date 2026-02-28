import { describe, expect, it } from 'vitest';
import {
  createPostgresReporterScoreComputationAdapter,
  createPostgresReporterScoreReadinessAdapter
} from '../src/postgres-reporter-score-adapters.js';
import type { PostgresQueryExecutor } from '../src/postgres-adapters.js';

class FakeDb implements PostgresQueryExecutor {
  constructor(
    private readonly options: {
      stale?: boolean;
      computedAtRows?: string[];
    } = {}
  ) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('assert_security_reporter_metrics_ready')) {
      if (this.options.stale) {
        throw new Error(
          `security_reporter_metrics_stale: freshness exceeds allowed window ${params[0] as string}`
        );
      }
      return {
        rows: [] as Row[],
        rowCount: 1
      };
    }

    if (sql.includes('FROM security_recompute_reporter_scores()')) {
      const rows = (this.options.computedAtRows ?? []).map((computedAt) => ({
        computed_at: computedAt
      })) as Row[];
      return {
        rows,
        rowCount: rows.length
      };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

describe('postgres reporter score adapters', () => {
  it('passes readiness assertion when metrics are fresh', async () => {
    const readiness = createPostgresReporterScoreReadinessAdapter({
      db: new FakeDb(),
      maxStalenessInterval: '2 hours'
    });

    await expect(readiness.assertMetricsReady()).resolves.toBeUndefined();
  });

  it('fails readiness assertion when metrics are stale', async () => {
    const readiness = createPostgresReporterScoreReadinessAdapter({
      db: new FakeDb({ stale: true }),
      maxStalenessInterval: '15 minutes'
    });

    await expect(readiness.assertMetricsReady()).rejects.toThrow(
      'security_reporter_metrics_stale'
    );
  });

  it('returns recompute counts and latest computed timestamp', async () => {
    const scoring = createPostgresReporterScoreComputationAdapter({
      db: new FakeDb({
        computedAtRows: ['2026-02-27T10:00:00Z', '2026-02-27T10:05:00Z']
      })
    });

    await expect(scoring.recomputeReporterScores()).resolves.toEqual({
      recomputed_count: 2,
      computed_at: '2026-02-27T10:05:00Z'
    });
  });
});
