import type { PostgresQueryExecutor } from './postgres-adapters.js';

export type OperationalSloRollupMode = 'dry-run' | 'production';

export interface OperationalSloRollupMetricSnapshot {
  metric_key: string;
  numerator: number;
  denominator: number;
  ratio: number | null;
  sample_size: number;
  metadata: Record<string, unknown>;
}

export interface OperationalSloRollupRunResult {
  run_id: string;
  mode: OperationalSloRollupMode;
  window_from: string;
  window_to: string;
  metrics: OperationalSloRollupMetricSnapshot[];
  persisted: boolean;
}

export interface OperationalSloRollupServiceOptions {
  db: PostgresQueryExecutor;
  now?: () => Date;
}

function clampRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }

  const raw = numerator / denominator;
  if (!Number.isFinite(raw)) {
    return null;
  }

  return Number(raw.toFixed(6));
}

function parseCount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  return 0;
}

async function queryCount(
  db: PostgresQueryExecutor,
  sql: string,
  params: readonly unknown[]
): Promise<number> {
  const result = await db.query<{ count: string | number }>(sql, params);
  return parseCount(result.rows[0]?.count ?? '0');
}

async function computeSnapshots(
  db: PostgresQueryExecutor,
  windowFrom: string,
  windowTo: string
): Promise<OperationalSloRollupMetricSnapshot[]> {
  const args = [windowFrom, windowTo] as const;

  const outboxTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM ingestion_outbox
      WHERE occurred_at >= $1::timestamptz
        AND occurred_at < $2::timestamptz
    `,
    args
  );

  const outboxDeadLetter = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM ingestion_outbox
      WHERE occurred_at >= $1::timestamptz
        AND occurred_at < $2::timestamptz
        AND status = 'dead_letter'
    `,
    args
  );

  const outboxFailed = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM ingestion_outbox
      WHERE occurred_at >= $1::timestamptz
        AND occurred_at < $2::timestamptz
        AND status = 'failed'
    `,
    args
  );

  const retrievalTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM raw_events
      WHERE event_received_at >= $1::timestamptz
        AND event_received_at < $2::timestamptz
        AND event_name = 'search.query'
    `,
    args
  );

  const retrievalFallback = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM raw_events
      WHERE event_received_at >= $1::timestamptz
        AND event_received_at < $2::timestamptz
        AND event_name = 'search.query'
        AND COALESCE((payload ->> 'semantic_fallback')::boolean, false) = true
    `,
    args
  );

  const applyTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM install_apply_attempts
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
    `,
    args
  );

  const applySucceeded = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM install_apply_attempts
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
        AND status = 'succeeded'
    `,
    args
  );

  const verifyTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM install_verify_attempts
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
    `,
    args
  );

  const verifySucceeded = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM install_verify_attempts
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
        AND status = 'succeeded'
    `,
    args
  );

  const replayTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM install_plan_audit
      WHERE stage IN ('apply', 'verify')
        AND created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
    `,
    args
  );

  const replayCount = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM install_plan_audit
      WHERE stage IN ('apply', 'verify')
        AND created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
        AND details ->> 'idempotent_replay' = 'true'
    `,
    args
  );

  const profileRunsTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM profile_install_runs
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
    `,
    args
  );

  const profileRunsSucceeded = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM profile_install_runs
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
        AND status = 'succeeded'
    `,
    args
  );

  const profileRunsPartial = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM profile_install_runs
      WHERE started_at >= $1::timestamptz
        AND started_at < $2::timestamptz
        AND status = 'partially_failed'
    `,
    args
  );

  const governanceActionsTotal = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM security_enforcement_actions
      WHERE created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
    `,
    args
  );

  const governanceRecomputeRequested = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM ingestion_outbox
      WHERE occurred_at >= $1::timestamptz
        AND occurred_at < $2::timestamptz
        AND event_type = 'security.enforcement.recompute.requested'
    `,
    args
  );

  const governanceRecomputeProcessed = await queryCount(
    db,
    `
      SELECT COUNT(*)::text AS count
      FROM outbox_internal_dispatch_runs
      WHERE processed_at >= $1::timestamptz
        AND processed_at < $2::timestamptz
        AND event_type = 'security.enforcement.recompute.requested'
    `,
    args
  );

  const snapshots: OperationalSloRollupMetricSnapshot[] = [
    {
      metric_key: 'outbox.dispatch.dead_letter_rate',
      numerator: outboxDeadLetter,
      denominator: outboxTotal,
      ratio: clampRatio(outboxDeadLetter, outboxTotal),
      sample_size: outboxTotal,
      metadata: {
        failed_count: outboxFailed
      }
    },
    {
      metric_key: 'retrieval.semantic_fallback.rate',
      numerator: retrievalFallback,
      denominator: retrievalTotal,
      ratio: clampRatio(retrievalFallback, retrievalTotal),
      sample_size: retrievalTotal,
      metadata: {}
    },
    {
      metric_key: 'install.apply.success_rate',
      numerator: applySucceeded,
      denominator: applyTotal,
      ratio: clampRatio(applySucceeded, applyTotal),
      sample_size: applyTotal,
      metadata: {}
    },
    {
      metric_key: 'install.verify.success_rate',
      numerator: verifySucceeded,
      denominator: verifyTotal,
      ratio: clampRatio(verifySucceeded, verifyTotal),
      sample_size: verifyTotal,
      metadata: {}
    },
    {
      metric_key: 'install.lifecycle.replay_ratio',
      numerator: replayCount,
      denominator: replayTotal,
      ratio: clampRatio(replayCount, replayTotal),
      sample_size: replayTotal,
      metadata: {}
    },
    {
      metric_key: 'profile.install_run.success_rate',
      numerator: profileRunsSucceeded,
      denominator: profileRunsTotal,
      ratio: clampRatio(profileRunsSucceeded, profileRunsTotal),
      sample_size: profileRunsTotal,
      metadata: {
        partially_failed_count: profileRunsPartial
      }
    },
    {
      metric_key: 'governance.recompute.dispatch_success_rate',
      numerator: governanceRecomputeProcessed,
      denominator: governanceRecomputeRequested,
      ratio: clampRatio(governanceRecomputeProcessed, governanceRecomputeRequested),
      sample_size: governanceRecomputeRequested,
      metadata: {
        enforcement_action_count: governanceActionsTotal
      }
    }
  ];

  return snapshots;
}

export function createOperationalSloRollupService(options: OperationalSloRollupServiceOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async run(input: {
      run_id: string;
      mode: OperationalSloRollupMode;
      window_from: string;
      window_to: string;
      trigger: string;
      limit: number;
    }): Promise<OperationalSloRollupRunResult> {
      const startedAt = now().toISOString();
      const snapshots = await computeSnapshots(options.db, input.window_from, input.window_to);

      if (input.mode === 'dry-run') {
        return {
          run_id: input.run_id,
          mode: input.mode,
          window_from: input.window_from,
          window_to: input.window_to,
          metrics: snapshots,
          persisted: false
        };
      }

      await options.db.query('BEGIN');
      try {
        const runInsert = await options.db.query<{ id: string }>(
          `
            INSERT INTO operational_slo_rollup_runs (
              run_id,
              mode,
              trigger,
              window_from,
              window_to,
              batch_limit,
              status,
              created_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4::timestamptz,
              $5::timestamptz,
              $6,
              'running',
              $7::timestamptz
            )
            RETURNING id::text AS id
          `,
          [
            input.run_id,
            input.mode,
            input.trigger,
            input.window_from,
            input.window_to,
            input.limit,
            startedAt
          ]
        );

        const runInternalId = runInsert.rows[0]?.id;
        if (!runInternalId) {
          throw new Error('slo_rollup_run_insert_failed');
        }

        for (const metric of snapshots) {
          await options.db.query(
            `
              INSERT INTO operational_slo_snapshots (
                run_internal_id,
                run_id,
                metric_key,
                window_from,
                window_to,
                numerator,
                denominator,
                ratio,
                sample_size,
                metadata,
                created_at
              )
              VALUES (
                $1::uuid,
                $2,
                $3,
                $4::timestamptz,
                $5::timestamptz,
                $6,
                $7,
                $8,
                $9,
                $10::jsonb,
                $11::timestamptz
              )
            `,
            [
              runInternalId,
              input.run_id,
              metric.metric_key,
              input.window_from,
              input.window_to,
              metric.numerator,
              metric.denominator,
              metric.ratio,
              metric.sample_size,
              JSON.stringify(metric.metadata),
              startedAt
            ]
          );
        }

        const completedAt = now().toISOString();
        await options.db.query(
          `
            UPDATE operational_slo_rollup_runs
            SET
              status = 'completed',
              snapshot_count = $2,
              completed_at = $3::timestamptz
            WHERE id = $1::uuid
          `,
          [runInternalId, snapshots.length, completedAt]
        );

        await options.db.query('COMMIT');

        return {
          run_id: input.run_id,
          mode: input.mode,
          window_from: input.window_from,
          window_to: input.window_to,
          metrics: snapshots,
          persisted: true
        };
      } catch (error) {
        await options.db.query('ROLLBACK');
        throw error;
      }
    }
  };
}

