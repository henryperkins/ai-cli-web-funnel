import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  createPostgresInternalOutboxDispatchHandlers,
  createDeterministicOutboxDispatcher,
  createOutboxProcessorJob,
  createPostgresOutboxJobStore
} from '../../packages/security-governance/src/index.js';
import { createIntegrationDbExecutor, resetIntegrationTables } from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

describe('integration-db: deterministic outbox dispatcher', () => {
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

  it('handles partial failures with deterministic retry and eventual completion', async () => {
    await pool.query(
      `
        INSERT INTO ingestion_outbox (
          event_type,
          dedupe_key,
          payload,
          source_service,
          status,
          available_at,
          occurred_at,
          created_at,
          updated_at
        )
        VALUES
          (
            'install.plan.created',
            'dedupe-install-plan',
            '{"plan_id":"plan-1"}'::jsonb,
            'control-plane',
            'pending',
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz
          ),
          (
            'install.apply.failed',
            'dedupe-install-apply-failed',
            '{"plan_id":"plan-1"}'::jsonb,
            'control-plane',
            'pending',
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz,
            '2026-03-01T10:00:00Z'::timestamptz
          )
      `
    );

    const internalHandlers = createPostgresInternalOutboxDispatchHandlers({ db });
    let failApplyOnce = true;
    const dispatcher = createDeterministicOutboxDispatcher({
      install_plan_created: async (job) => {
        await internalHandlers.install_plan_created?.(job);
      },
      install_apply_failed: async (job) => {
        if (failApplyOnce) {
          failApplyOnce = false;
          throw new Error('transient_failure');
        }

        await internalHandlers.install_apply_failed?.(job);
      }
    });

    const store = createPostgresOutboxJobStore({
      db,
      maxAttempts: 3,
      retryBackoffSeconds: 1
    });

    const processor = createOutboxProcessorJob(store, dispatcher);

    const firstRun = await processor.run('production', '2026-03-01T10:00:01Z', 10);
    expect(firstRun).toMatchObject({
      claimed: 2,
      dispatched: 1,
      completed: 1,
      failed: 1
    });

    const secondRun = await processor.run('production', '2026-03-01T10:00:03Z', 10);
    expect(secondRun).toMatchObject({
      claimed: 1,
      dispatched: 1,
      completed: 1,
      failed: 0
    });

    const rows = await pool.query<{
      dedupe_key: string;
      status: string;
      attempt_count: string;
    }>(
      `
        SELECT dedupe_key, status, attempt_count::text AS attempt_count
        FROM ingestion_outbox
        ORDER BY dedupe_key ASC
      `
    );

    expect(rows.rows).toEqual([
      {
        dedupe_key: 'dedupe-install-apply-failed',
        status: 'completed',
        attempt_count: '2'
      },
      {
        dedupe_key: 'dedupe-install-plan',
        status: 'completed',
        attempt_count: '1'
      }
    ]);

    const dispatchRows = await pool.query<{
      handler_key: string;
      count: string;
    }>(
      `
        SELECT handler_key, COUNT(*)::text AS count
        FROM outbox_internal_dispatch_runs
        GROUP BY handler_key
        ORDER BY handler_key ASC
      `
    );

    expect(dispatchRows.rows).toEqual([
      {
        handler_key: 'install_apply_failed',
        count: '1'
      },
      {
        handler_key: 'install_plan_created',
        count: '1'
      }
    ]);

    const effectRows = await pool.query<{
      effect_code: string;
      count: string;
    }>(
      `
        SELECT effect_code, COUNT(*)::text AS count
        FROM outbox_internal_dispatch_effects
        GROUP BY effect_code
        ORDER BY effect_code ASC
      `
    );

    expect(effectRows.rows).toEqual([
      {
        effect_code: 'install_apply_failed_recorded',
        count: '1'
      },
      {
        effect_code: 'install_plan_created_recorded',
        count: '1'
      }
    ]);
  });

  it('moves permanently failing jobs to dead_letter at max attempts', async () => {
    await pool.query(
      `
        INSERT INTO ingestion_outbox (
          event_type,
          dedupe_key,
          payload,
          source_service,
          status,
          available_at,
          occurred_at,
          created_at,
          updated_at
        )
        VALUES (
          'install.verify.failed',
          'dedupe-install-verify-failed',
          '{"plan_id":"plan-2"}'::jsonb,
          'control-plane',
          'pending',
          '2026-03-01T10:00:00Z'::timestamptz,
          '2026-03-01T10:00:00Z'::timestamptz,
          '2026-03-01T10:00:00Z'::timestamptz,
          '2026-03-01T10:00:00Z'::timestamptz
        )
      `
    );

    const dispatcher = createDeterministicOutboxDispatcher({
      install_verify_failed: async () => {
        throw new Error('permanent_contract_error');
      }
    });

    const store = createPostgresOutboxJobStore({
      db,
      maxAttempts: 1,
      retryBackoffSeconds: 1
    });

    const processor = createOutboxProcessorJob(store, dispatcher);
    const result = await processor.run('production', '2026-03-01T10:00:01Z', 10);

    expect(result).toMatchObject({
      claimed: 1,
      dispatched: 0,
      completed: 0,
      failed: 1
    });

    const row = await pool.query<{ status: string; attempt_count: string }>(
      `
        SELECT status, attempt_count::text AS attempt_count
        FROM ingestion_outbox
        WHERE dedupe_key = 'dedupe-install-verify-failed'
      `
    );

    expect(row.rows[0]).toEqual({
      status: 'dead_letter',
      attempt_count: '1'
    });

    const dispatchCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM outbox_internal_dispatch_runs'
    );
    expect(dispatchCount.rows[0]?.count).toBe('0');
  });

  it('executes ranking.sync.requested via ranking sync executor and records side effects', async () => {
    await pool.query(
      `
        INSERT INTO registry.packages (
          id,
          package_id,
          package_slug
        )
        VALUES (
          '33333333-3333-4333-8333-333333333333'::uuid,
          '33333333-3333-4333-8333-333333333333'::uuid,
          'acme/ranking-sync-target'
        )
        ON CONFLICT (id) DO NOTHING
      `
    );

    await pool.query(
      `
        INSERT INTO ingestion_outbox (
          event_type,
          dedupe_key,
          payload,
          source_service,
          status,
          available_at,
          occurred_at,
          created_at,
          updated_at
        )
        VALUES (
          'ranking.sync.requested',
          'dedupe-ranking-sync',
          '{"package_id":"33333333-3333-4333-8333-333333333333"}'::jsonb,
          'control-plane',
          'pending',
          '2026-03-01T10:00:00Z'::timestamptz,
          '2026-03-01T10:00:00Z'::timestamptz,
          '2026-03-01T10:00:00Z'::timestamptz,
          '2026-03-01T10:00:00Z'::timestamptz
        )
      `
    );

    const rankingSyncCalls: string[][] = [];
    const dispatcher = createDeterministicOutboxDispatcher(
      createPostgresInternalOutboxDispatchHandlers({
        db,
        rankingSyncExecutor: {
          async sync(input) {
            rankingSyncCalls.push([...input.package_ids]);
            return {
              candidate_count: 1,
              upserted_count: 1,
              unchanged_count: 0,
              persisted_state_count: 1
            };
          }
        }
      })
    );

    const store = createPostgresOutboxJobStore({
      db,
      maxAttempts: 3,
      retryBackoffSeconds: 1
    });

    const processor = createOutboxProcessorJob(store, dispatcher);
    const result = await processor.run('production', '2026-03-01T10:00:01Z', 10);
    expect(result).toMatchObject({
      claimed: 1,
      dispatched: 1,
      completed: 1,
      failed: 0
    });
    expect(rankingSyncCalls).toEqual([['33333333-3333-4333-8333-333333333333']]);

    const effect = await pool.query<{
      effect_code: string;
      effect_payload: Record<string, unknown>;
    }>(
      `
        SELECT
          effect_code,
          effect_payload
        FROM outbox_internal_dispatch_effects
        WHERE dedupe_key = 'dedupe-ranking-sync'
      `
    );

    expect(effect.rows[0]?.effect_code).toBe('ranking_sync_executed');
    expect(effect.rows[0]?.effect_payload).toMatchObject({
      package_ids: ['33333333-3333-4333-8333-333333333333'],
      upserted_count: 1
    });
  });
});
