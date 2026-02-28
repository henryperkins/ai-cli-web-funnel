import { describe, expect, it } from 'vitest';
import { createEventIngestionHttpHandler } from '../../apps/control-plane/src/http-handler.js';
import {
  createPostgresFraudFlagPipeline,
  createPostgresIdempotencyAdapter,
  createPostgresIngestionPersistenceAdapter,
  createPostgresOutboxPublisher,
  type PostgresQueryExecutor
} from '../../apps/control-plane/src/postgres-adapters.js';

function buildEvent() {
  return {
    schema_version: '1.0.0',
    event_id: '91cf6a57-8de1-4d7c-9072-6f102571f8e1',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T12:00:00Z',
    event_received_at: '2026-02-27T12:00:01Z',
    idempotency_key: 'idem-intg-db-001',
    request_id: '74e9f743-965f-4fb4-a04a-7eb4e2d27d25',
    session_id: '6f797f2b-6d11-4a00-a7a8-cef85cf4df4f',
    actor: {
      actor_id: 'anon:integration',
      actor_type: 'anonymous'
    },
    privacy: {
      consent_state: 'granted',
      region: 'US'
    },
    client: {
      app: 'web',
      app_version: '0.1.0',
      user_agent_family: 'chromium',
      device_class: 'desktop',
      referrer_domain: null
    },
    payload: {
      package_id: '0fdf06a7-7e72-4f6b-a7ea-5bc8b8bf40f5',
      action: 'copy_install',
      is_promoted: false,
      command_template_id: 'tmpl-intg'
    }
  } as const;
}

class FakeDb implements PostgresQueryExecutor {
  readonly rawEvents: Array<Record<string, unknown>> = [];
  readonly eventFlags: Array<Record<string, unknown>> = [];
  readonly outbox: Array<Record<string, unknown>> = [];
  private readonly idempotency = new Map<string, Record<string, unknown>>();
  private rawEventCounter = 0;

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('FROM ingestion_idempotency_records')) {
      const key = `${params[0]}:${params[1]}`;
      const record = this.idempotency.get(key);
      return {
        rows: record ? ([record] as Row[]) : [],
        rowCount: record ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO ingestion_idempotency_records')) {
      const key = `${params[0]}:${params[1]}`;
      const requestHash = params[2] as string;
      const existing = this.idempotency.get(key);
      if (existing && existing.request_hash !== requestHash) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      this.idempotency.set(key, {
        scope: params[0],
        idempotency_key: params[1],
        request_hash: requestHash,
        response_code: params[3],
        response_body: JSON.parse(params[4] as string),
        stored_at: params[5]
      });
      return {
        rows: ([{ request_hash: requestHash }] as Row[]),
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO raw_events')) {
      this.rawEventCounter += 1;
      const id = `00000000-0000-4000-8000-${this.rawEventCounter
        .toString(16)
        .padStart(12, '0')}`;
      this.rawEvents.push({
        id,
        event_id: params[0],
        idempotency_key: params[6]
      });
      return {
        rows: ([{ raw_event_id: id, persisted_at: params[20] }] as Row[]),
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO event_flags')) {
      this.eventFlags.push({
        raw_event_id: params[0],
        outcome: params[2],
        rule_code: params[4]
      });
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO ingestion_outbox')) {
      const dedupeKey = params[1] as string;
      if (!this.outbox.find((item) => item.dedupe_key === dedupeKey)) {
        this.outbox.push({
          event_type: params[0],
          dedupe_key: dedupeKey
        });
      }
      return {
        rows: [],
        rowCount: 1
      };
    }

    throw new Error(`Unhandled SQL in fake db: ${sql}`);
  }
}

describe('integration: db-backed event ingestion adapters', () => {
  it('persists events, supports replay, and blocks conflicting re-use', async () => {
    const db = new FakeDb();
    const idempotency = createPostgresIdempotencyAdapter({ db });
    const persistence = createPostgresIngestionPersistenceAdapter({ db });
    const fraudPipeline = createPostgresFraudFlagPipeline({
      db,
      evaluator: {
        async evaluate() {
          return [
            {
              outcome: 'flagged',
              rule_code: 'FRT-02',
              reason_code: 'duplicate_copy_install_24h',
              metadata: {
                kept_first_event: true
              }
            }
          ];
        }
      }
    });
    const outboxPublisher = createPostgresOutboxPublisher({ db });
    const handler = createEventIngestionHttpHandler({
      idempotency,
      persistence,
      fraudPipeline,
      outboxPublisher
    });

    const first = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });
    const replay = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });
    const conflictingPayload = {
      ...buildEvent(),
      request_id: '8b663c44-6f9d-428f-82a6-8cce5c9beec1'
    };
    const conflict = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: conflictingPayload
    });

    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(conflict.statusCode).toBe(409);
    expect(replay.body).toEqual(first.body);

    expect(db.rawEvents).toHaveLength(1);
    expect(db.eventFlags).toHaveLength(1);
    expect(db.outbox).toHaveLength(2);
  });
});
