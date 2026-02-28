import type { PostgresQueryExecutor } from './postgres-adapters.js';

export interface DeadLetterReplayQueryExecutor extends PostgresQueryExecutor {
  withTransaction?<T>(callback: (tx: PostgresQueryExecutor) => Promise<T>): Promise<T>;
}

export interface DeadLetterReplayFilters {
  event_type?: string;
  dedupe_key?: string;
  created_from?: string;
  created_to?: string;
  limit?: number;
}

export interface DeadLetterReplayListRow {
  id: string;
  event_type: string;
  dedupe_key: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeadLetterReplayRequeueResult {
  replay_run_id: string;
  requested_by: string;
  replay_reason: string;
  correlation_id: string | null;
  requeued_count: number;
  jobs: Array<{
    outbox_job_id: string;
    event_type: string;
    dedupe_key: string;
    previous_status: string;
    previous_attempt_count: number;
    previous_last_error: string | null;
  }>;
}

export interface PostgresDeadLetterReplayServiceOptions {
  db: DeadLetterReplayQueryExecutor;
  now?: () => Date;
}

interface DeadLetterRequeueRow {
  id: string;
  event_type: string;
  dedupe_key: string;
  previous_status: string;
  previous_attempt_count: number | string;
  previous_last_error: string | null;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return 100;
  }

  return Math.min(500, Math.max(1, limit));
}

function normalizeFilterValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAttemptCount(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

async function runInTransaction<T>(
  db: DeadLetterReplayQueryExecutor,
  callback: (tx: PostgresQueryExecutor) => Promise<T>
): Promise<T> {
  if (db.withTransaction) {
    return db.withTransaction(callback);
  }

  await db.query('BEGIN');
  try {
    const output = await callback(db);
    await db.query('COMMIT');
    return output;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export function createPostgresDeadLetterReplayService(
  options: PostgresDeadLetterReplayServiceOptions
) {
  return {
    async listDeadLetterJobs(
      filters: DeadLetterReplayFilters = {}
    ): Promise<DeadLetterReplayListRow[]> {
      const limit = normalizeLimit(filters.limit);
      const result = await options.db.query<{
        id: string;
        event_type: string;
        dedupe_key: string;
        status: string;
        attempt_count: number | string;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            id::text AS id,
            event_type,
            dedupe_key,
            status,
            attempt_count,
            last_error,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ingestion_outbox
          WHERE status = 'dead_letter'
            AND ($1::text IS NULL OR event_type = $1)
            AND ($2::text IS NULL OR dedupe_key = $2)
            AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)
            AND ($4::timestamptz IS NULL OR created_at <= $4::timestamptz)
          ORDER BY created_at ASC, id ASC
          LIMIT $5
        `,
        [
          normalizeFilterValue(filters.event_type),
          normalizeFilterValue(filters.dedupe_key),
          normalizeFilterValue(filters.created_from),
          normalizeFilterValue(filters.created_to),
          limit
        ]
      );

      return result.rows.map((row) => ({
        id: row.id,
        event_type: row.event_type,
        dedupe_key: row.dedupe_key,
        status: row.status,
        attempt_count: parseAttemptCount(row.attempt_count),
        last_error: row.last_error,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
    },

    async requeueDeadLetterJobs(input: {
      replay_run_id: string;
      replay_reason: string;
      requested_by: string;
      correlation_id?: string | null;
      filters?: DeadLetterReplayFilters;
    }): Promise<DeadLetterReplayRequeueResult> {
      const limit = normalizeLimit(input.filters?.limit);
      const nowIso = (options.now ?? (() => new Date()))().toISOString();
      const correlationId = normalizeFilterValue(input.correlation_id ?? undefined);

      return runInTransaction(options.db, async (tx) => {
        const updated = await tx.query<DeadLetterRequeueRow>(
          `
            WITH selected AS (
              SELECT
                id,
                event_type,
                dedupe_key,
                status AS previous_status,
                attempt_count AS previous_attempt_count,
                last_error AS previous_last_error
              FROM ingestion_outbox
              WHERE status = 'dead_letter'
                AND ($1::text IS NULL OR event_type = $1)
                AND ($2::text IS NULL OR dedupe_key = $2)
                AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)
                AND ($4::timestamptz IS NULL OR created_at <= $4::timestamptz)
              ORDER BY created_at ASC, id ASC
              LIMIT $5
              FOR UPDATE SKIP LOCKED
            ),
            updated AS (
              UPDATE ingestion_outbox AS outbox
              SET
                status = 'pending',
                attempt_count = 0,
                last_error = NULL,
                available_at = $6::timestamptz,
                updated_at = $6::timestamptz
              FROM selected
              WHERE outbox.id = selected.id
              RETURNING
                outbox.id::text AS id,
                selected.event_type,
                selected.dedupe_key,
                selected.previous_status,
                selected.previous_attempt_count,
                selected.previous_last_error
            )
            SELECT
              id,
              event_type,
              dedupe_key,
              previous_status,
              previous_attempt_count,
              previous_last_error
            FROM updated
            ORDER BY id ASC
          `,
          [
            normalizeFilterValue(input.filters?.event_type),
            normalizeFilterValue(input.filters?.dedupe_key),
            normalizeFilterValue(input.filters?.created_from),
            normalizeFilterValue(input.filters?.created_to),
            limit,
            nowIso
          ]
        );

        for (const row of updated.rows) {
          await tx.query(
            `
              INSERT INTO outbox_dead_letter_replay_audit (
                replay_run_id,
                outbox_job_id,
                event_type,
                dedupe_key,
                previous_status,
                previous_attempt_count,
                previous_last_error,
                replay_reason,
                requested_by,
                correlation_id,
                requeued_at
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11::timestamptz
              )
            `,
            [
              input.replay_run_id,
              row.id,
              row.event_type,
              row.dedupe_key,
              row.previous_status,
              parseAttemptCount(row.previous_attempt_count),
              row.previous_last_error,
              input.replay_reason,
              input.requested_by,
              correlationId,
              nowIso
            ]
          );
        }

        return {
          replay_run_id: input.replay_run_id,
          requested_by: input.requested_by,
          replay_reason: input.replay_reason,
          correlation_id: correlationId,
          requeued_count: updated.rows.length,
          jobs: updated.rows.map((row) => ({
            outbox_job_id: row.id,
            event_type: row.event_type,
            dedupe_key: row.dedupe_key,
            previous_status: row.previous_status,
            previous_attempt_count: parseAttemptCount(row.previous_attempt_count),
            previous_last_error: row.previous_last_error
          }))
        } satisfies DeadLetterReplayRequeueResult;
      });
    }
  };
}
