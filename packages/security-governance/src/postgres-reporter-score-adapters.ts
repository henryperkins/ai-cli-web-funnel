import type {
  ReporterScoreComputationAdapter,
  ReporterScoreMetricsReadinessAdapter
} from './index.js';
import type { PostgresQueryExecutor } from './postgres-adapters.js';

export interface PostgresReporterScoreReadinessOptions {
  db: PostgresQueryExecutor;
  maxStalenessInterval?: string;
}

export interface PostgresReporterScoreComputationOptions {
  db: PostgresQueryExecutor;
}

const ASSERT_SECURITY_REPORTER_METRICS_READY_INTERVAL_SQL =
  'SELECT assert_security_reporter_metrics_ready($1::interval);';

export function createPostgresReporterScoreReadinessAdapter(
  options: PostgresReporterScoreReadinessOptions
): ReporterScoreMetricsReadinessAdapter {
  const maxStalenessInterval = options.maxStalenessInterval ?? '6 hours';

  return {
    async assertMetricsReady(): Promise<void> {
      await options.db.query(ASSERT_SECURITY_REPORTER_METRICS_READY_INTERVAL_SQL, [
        maxStalenessInterval
      ]);
    }
  };
}

export function createPostgresReporterScoreComputationAdapter(
  options: PostgresReporterScoreComputationOptions
): ReporterScoreComputationAdapter {
  return {
    async recomputeReporterScores() {
      const result = await options.db.query<{ computed_at: string }>(
        `
          SELECT computed_at::text AS computed_at
          FROM security_recompute_reporter_scores()
        `
      );

      const latestComputedAt =
        result.rows
          .map((row) => row.computed_at)
          .sort((left, right) => right.localeCompare(left))[0] ??
        new Date().toISOString();

      return {
        recomputed_count: result.rowCount ?? result.rows.length,
        computed_at: latestComputedAt
      };
    }
  };
}
