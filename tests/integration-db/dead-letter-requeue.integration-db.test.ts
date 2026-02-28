import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createPostgresDeadLetterReplayService } from '../../packages/security-governance/src/index.js';
import { createIntegrationDbExecutor, resetIntegrationTables } from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

describe('integration-db: dead-letter replay service', () => {
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const db = createIntegrationDbExecutor(pool);

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  beforeEach(async () => {
    await resetIntegrationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lists dead-letter rows with deterministic filters', async () => {
    await pool.query(
      `
        INSERT INTO ingestion_outbox (
          event_type,
          dedupe_key,
          payload,
          source_service,
          status,
          attempt_count,
          available_at,
          occurred_at,
          created_at,
          updated_at
        )
        VALUES
          (
            'install.verify.failed',
            'dedupe-dead-letter-a',
            '{}'::jsonb,
            'control-plane',
            'dead_letter',
            2,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz
          ),
          (
            'install.apply.failed',
            'dedupe-not-dead-letter',
            '{}'::jsonb,
            'control-plane',
            'failed',
            1,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz
          )
      `
    );

    const service = createPostgresDeadLetterReplayService({
      db
    });

    const listed = await service.listDeadLetterJobs({
      event_type: 'install.verify.failed',
      limit: 10
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      event_type: 'install.verify.failed',
      dedupe_key: 'dedupe-dead-letter-a',
      status: 'dead_letter',
      attempt_count: 2
    });
  });

  it('requeues selected dead-letter rows exactly once and writes replay audit', async () => {
    await pool.query(
      `
        INSERT INTO ingestion_outbox (
          event_type,
          dedupe_key,
          payload,
          source_service,
          status,
          attempt_count,
          last_error,
          available_at,
          occurred_at,
          created_at,
          updated_at
        )
        VALUES
          (
            'install.verify.failed',
            'dedupe-dead-letter-target',
            '{}'::jsonb,
            'control-plane',
            'dead_letter',
            3,
            'permanent_contract_error',
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz
          ),
          (
            'install.apply.failed',
            'dedupe-dead-letter-other',
            '{}'::jsonb,
            'control-plane',
            'dead_letter',
            2,
            'other_error',
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz
          )
      `
    );

    const service = createPostgresDeadLetterReplayService({
      db,
      now: () => new Date('2026-03-01T12:00:00Z')
    });

    const replayRunId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const first = await service.requeueDeadLetterJobs({
      replay_run_id: replayRunId,
      replay_reason: 'operator_fix_applied',
      requested_by: 'integration-test',
      correlation_id: 'corr-dead-letter-1',
      filters: {
        dedupe_key: 'dedupe-dead-letter-target',
        limit: 10
      }
    });

    expect(first).toMatchObject({
      replay_run_id: replayRunId,
      requeued_count: 1
    });
    expect(first.jobs[0]).toMatchObject({
      dedupe_key: 'dedupe-dead-letter-target',
      previous_status: 'dead_letter',
      previous_attempt_count: 3,
      previous_last_error: 'permanent_contract_error'
    });

    const outboxRow = await pool.query<{
      status: string;
      attempt_count: string;
      last_error: string | null;
    }>(
      `
        SELECT
          status,
          attempt_count::text AS attempt_count,
          last_error
        FROM ingestion_outbox
        WHERE dedupe_key = 'dedupe-dead-letter-target'
      `
    );
    expect(outboxRow.rows[0]).toEqual({
      status: 'pending',
      attempt_count: '0',
      last_error: null
    });

    const auditRow = await pool.query<{
      replay_reason: string;
      requested_by: string;
      correlation_id: string | null;
      previous_attempt_count: string;
    }>(
      `
        SELECT
          replay_reason,
          requested_by,
          correlation_id,
          previous_attempt_count::text AS previous_attempt_count
        FROM outbox_dead_letter_replay_audit
        WHERE replay_run_id = $1::uuid
      `,
      [replayRunId]
    );
    expect(auditRow.rows[0]).toEqual({
      replay_reason: 'operator_fix_applied',
      requested_by: 'integration-test',
      correlation_id: 'corr-dead-letter-1',
      previous_attempt_count: '3'
    });

    const second = await service.requeueDeadLetterJobs({
      replay_run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      replay_reason: 'operator_fix_applied',
      requested_by: 'integration-test',
      filters: {
        dedupe_key: 'dedupe-dead-letter-target',
        limit: 10
      }
    });
    expect(second.requeued_count).toBe(0);
  });
});
