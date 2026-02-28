import type { OutboxJobStore } from './jobs.js';
import type { PostgresQueryExecutor } from './postgres-adapters.js';

export interface OutboxJobStoreLogEvent {
  event_name: 'outbox.claim_failed';
  occurred_at: string;
  payload: {
    reason: string;
  };
}

export interface OutboxJobStoreLogger {
  log(event: OutboxJobStoreLogEvent): void | Promise<void>;
}

export interface PostgresOutboxJobStoreOptions {
  db: PostgresQueryExecutor;
  maxAttempts?: number;
  retryBackoffSeconds?: number;
  logger?: OutboxJobStoreLogger;
}

interface OutboxJobRow {
  id: string;
  dedupe_key: string;
  event_type: string;
  payload: unknown;
  attempt_count: number | string;
}

function parsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  return {};
}

function parseAttemptCount(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

export function createPostgresOutboxJobStore(
  options: PostgresOutboxJobStoreOptions
): OutboxJobStore {
  const maxAttempts = options.maxAttempts ?? 5;
  const retryBackoffSeconds = options.retryBackoffSeconds ?? 60;

  return {
    async claimPending(limit, nowIso) {
      try {
        const result = await options.db.query<OutboxJobRow>(
          `
            WITH candidates AS (
              SELECT id
              FROM ingestion_outbox
              WHERE status IN ('pending', 'failed')
                AND available_at <= $2::timestamptz
              ORDER BY created_at ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE ingestion_outbox AS outbox
            SET
              status = 'processing',
              attempt_count = outbox.attempt_count + 1,
              updated_at = $2::timestamptz
            FROM candidates
            WHERE outbox.id = candidates.id
            RETURNING
              outbox.id::text AS id,
              outbox.dedupe_key,
              outbox.event_type,
              outbox.payload,
              outbox.attempt_count
          `,
          [limit, nowIso]
        );

        return result.rows.map((row) => ({
          id: row.id,
          dedupe_key: row.dedupe_key,
          event_type: row.event_type,
          payload: parsePayload(row.payload),
          attempt_count: parseAttemptCount(row.attempt_count)
        }));
      } catch (error) {
        if (options.logger) {
          await options.logger.log({
            event_name: 'outbox.claim_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              reason: error instanceof Error ? error.message : 'claim_failed'
            }
          });
        }
        throw error;
      }
    },

    async markCompleted(id, nowIso) {
      await options.db.query(
        `
          UPDATE ingestion_outbox
          SET
            status = 'completed',
            last_error = NULL,
            updated_at = $2::timestamptz
          WHERE id = $1::uuid
        `,
        [id, nowIso]
      );
    },

    async markFailed(id, error, nowIso) {
      const retryAt = new Date(Date.parse(nowIso) + retryBackoffSeconds * 1_000).toISOString();

      await options.db.query(
        `
          UPDATE ingestion_outbox
          SET
            status = CASE WHEN attempt_count >= $3 THEN 'dead_letter' ELSE 'failed' END,
            last_error = $2,
            available_at = CASE
              WHEN attempt_count >= $3 THEN available_at
              ELSE $4::timestamptz
            END,
            updated_at = $1::timestamptz
          WHERE id = $5::uuid
        `,
        [nowIso, error, maxAttempts, retryAt, id]
      );
    },

    async isProcessed(dedupeKey) {
      const result = await options.db.query<{ status: string }>(
        `
          SELECT status
          FROM ingestion_outbox
          WHERE dedupe_key = $1
          LIMIT 1
        `,
        [dedupeKey]
      );

      const status = result.rows[0]?.status;
      return status === 'completed' || status === 'dead_letter';
    },

    async markProcessed(dedupeKey, nowIso) {
      await options.db.query(
        `
          UPDATE ingestion_outbox
          SET
            status = 'completed',
            last_error = NULL,
            updated_at = $2::timestamptz
          WHERE dedupe_key = $1
        `,
        [dedupeKey, nowIso]
      );
    },

    async releaseClaim(id, nowIso) {
      await options.db.query(
        `
          UPDATE ingestion_outbox
          SET
            status = 'pending',
            attempt_count = GREATEST(attempt_count - 1, 0),
            updated_at = $2::timestamptz
          WHERE id = $1::uuid
            AND status = 'processing'
        `,
        [id, nowIso]
      );
    }
  };
}
