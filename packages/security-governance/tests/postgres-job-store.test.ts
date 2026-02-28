import { describe, expect, it } from 'vitest';
import {
  createPostgresOutboxJobStore,
  type PostgresOutboxJobStoreOptions
} from '../src/postgres-job-store.js';
import type { PostgresQueryExecutor } from '../src/postgres-adapters.js';

interface OutboxRow {
  id: string;
  dedupe_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  status: 'pending' | 'failed' | 'processing' | 'completed' | 'dead_letter';
  available_at: string;
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

class FakeDb implements PostgresQueryExecutor {
  readonly rows: OutboxRow[] = [];
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });

    if (sql.includes('WITH candidates AS')) {
      const limit = Number(params[0]);
      const now = Date.parse(params[1] as string);
      const claimable = this.rows
        .filter(
          (row) =>
            (row.status === 'pending' || row.status === 'failed') &&
            Date.parse(row.available_at) <= now
        )
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .slice(0, limit);

      for (const row of claimable) {
        row.status = 'processing';
        row.attempt_count += 1;
        row.updated_at = params[1] as string;
      }

      return {
        rows: claimable.map((row) => ({
          id: row.id,
          dedupe_key: row.dedupe_key,
          event_type: row.event_type,
          payload: row.payload,
          attempt_count: row.attempt_count
        })) as Row[],
        rowCount: claimable.length
      };
    }

    if (sql.includes('WHERE id = $1::uuid') && sql.includes("status = 'completed'")) {
      const row = this.rows.find((entry) => entry.id === params[0]);
      if (row) {
        row.status = 'completed';
        row.last_error = null;
        row.updated_at = params[1] as string;
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes("status = CASE WHEN attempt_count >= $3 THEN 'dead_letter' ELSE 'failed' END")) {
      const row = this.rows.find((entry) => entry.id === params[4]);
      if (row) {
        const maxAttempts = Number(params[2]);
        row.status = row.attempt_count >= maxAttempts ? 'dead_letter' : 'failed';
        row.last_error = params[1] as string;
        row.updated_at = params[0] as string;
        if (row.status === 'failed') {
          row.available_at = params[3] as string;
        }
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('SELECT status') && sql.includes('WHERE dedupe_key = $1')) {
      const row = this.rows.find((entry) => entry.dedupe_key === params[0]);
      return {
        rows: row ? ([{ status: row.status }] as Row[]) : [],
        rowCount: row ? 1 : 0
      };
    }

    if (sql.includes('WHERE dedupe_key = $1') && sql.includes("status = 'completed'")) {
      const row = this.rows.find((entry) => entry.dedupe_key === params[0]);
      if (row) {
        row.status = 'completed';
        row.last_error = null;
        row.updated_at = params[1] as string;
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes("status = 'pending'") && sql.includes('attempt_count = GREATEST(attempt_count - 1, 0)')) {
      const row = this.rows.find((entry) => entry.id === params[0]);
      if (row && row.status === 'processing') {
        row.status = 'pending';
        row.attempt_count = Math.max(row.attempt_count - 1, 0);
        row.updated_at = params[1] as string;
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

function createStore(
  options: Partial<Omit<PostgresOutboxJobStoreOptions, 'db'>> = {}
) {
  const db = new FakeDb();
  const store = createPostgresOutboxJobStore({
    db,
    maxAttempts: 2,
    retryBackoffSeconds: 30,
    ...options
  });
  return { db, store };
}

describe('postgres outbox job store', () => {
  it('claims pending jobs in created_at order and increments attempt_count', async () => {
    const { db, store } = createStore();
    db.rows.push(
      {
        id: '00000000-0000-4000-8000-000000000001',
        dedupe_key: 'dedupe-1',
        event_type: 'security.report.accepted',
        payload: { report_id: '1' },
        attempt_count: 0,
        status: 'pending',
        available_at: '2026-02-27T12:00:00Z',
        created_at: '2026-02-27T11:00:00Z',
        updated_at: '2026-02-27T11:00:00Z',
        last_error: null
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        dedupe_key: 'dedupe-2',
        event_type: 'security.enforcement.recompute.requested',
        payload: { report_id: '2' },
        attempt_count: 1,
        status: 'failed',
        available_at: '2026-02-27T12:00:00Z',
        created_at: '2026-02-27T11:30:00Z',
        updated_at: '2026-02-27T11:30:00Z',
        last_error: 'timeout'
      }
    );

    const claimed = await store.claimPending(10, '2026-02-27T12:30:00Z');

    expect(claimed.map((job) => job.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ]);
    expect(claimed.map((job) => job.attempt_count)).toEqual([1, 2]);
    expect(db.rows.map((row) => row.status)).toEqual(['processing', 'processing']);
  });

  it('marks failures with retry window then dead-letters at max attempt threshold', async () => {
    const { db, store } = createStore();
    db.rows.push({
      id: '00000000-0000-4000-8000-000000000003',
      dedupe_key: 'dedupe-3',
      event_type: 'security.report.accepted',
      payload: {},
      attempt_count: 1,
      status: 'processing',
      available_at: '2026-02-27T12:00:00Z',
      created_at: '2026-02-27T11:00:00Z',
      updated_at: '2026-02-27T11:00:00Z',
      last_error: null
    });

    await store.markFailed(
      '00000000-0000-4000-8000-000000000003',
      'transient_timeout',
      '2026-02-27T12:30:00Z'
    );
    expect(db.rows[0]?.status).toBe('failed');
    expect(db.rows[0]?.available_at).toBe('2026-02-27T12:30:30.000Z');

    db.rows[0]!.attempt_count = 2;
    await store.markFailed(
      '00000000-0000-4000-8000-000000000003',
      'permanent_contract_error',
      '2026-02-27T12:31:00Z'
    );
    expect(db.rows[0]?.status).toBe('dead_letter');
  });

  it('supports dedupe checks via isProcessed/markProcessed and markCompleted', async () => {
    const { db, store } = createStore();
    db.rows.push({
      id: '00000000-0000-4000-8000-000000000004',
      dedupe_key: 'dedupe-4',
      event_type: 'security.report.accepted',
      payload: {},
      attempt_count: 1,
      status: 'processing',
      available_at: '2026-02-27T12:00:00Z',
      created_at: '2026-02-27T11:00:00Z',
      updated_at: '2026-02-27T11:00:00Z',
      last_error: null
    });

    expect(await store.isProcessed('dedupe-4')).toBe(false);
    await store.markProcessed('dedupe-4', '2026-02-27T12:00:00Z');
    expect(await store.isProcessed('dedupe-4')).toBe(true);

    await store.markCompleted(
      '00000000-0000-4000-8000-000000000004',
      '2026-02-27T12:01:00Z'
    );
    expect(db.rows[0]?.status).toBe('completed');
  });

  it('releases shadow/dry-run claims back to pending without inflating attempts', async () => {
    const { db, store } = createStore();
    db.rows.push({
      id: '00000000-0000-4000-8000-000000000005',
      dedupe_key: 'dedupe-5',
      event_type: 'install.plan.created',
      payload: {},
      attempt_count: 0,
      status: 'pending',
      available_at: '2026-02-27T12:00:00Z',
      created_at: '2026-02-27T11:00:00Z',
      updated_at: '2026-02-27T11:00:00Z',
      last_error: null
    });

    const claimed = await store.claimPending(1, '2026-02-27T12:30:00Z');
    expect(claimed[0]?.attempt_count).toBe(1);
    expect(db.rows[0]?.status).toBe('processing');

    await store.releaseClaim('00000000-0000-4000-8000-000000000005', '2026-02-27T12:30:01Z');

    expect(db.rows[0]?.status).toBe('pending');
    expect(db.rows[0]?.attempt_count).toBe(0);
  });
});
