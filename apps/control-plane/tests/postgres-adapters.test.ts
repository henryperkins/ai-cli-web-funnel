import { describe, expect, it } from 'vitest';
import type { AnyTelemetryEventEnvelope } from '@forge/shared-contracts';
import {
  createPostgresFraudFlagPipeline,
  createPostgresIdempotencyAdapter,
  createPostgresIngestionPersistenceAdapter,
  createPostgresOutboxPublisher,
  type PostgresQueryExecutor
} from '../src/postgres-adapters.js';

function buildEvent(): AnyTelemetryEventEnvelope {
  return {
    schema_version: '1.0.0',
    event_id: '75414fcb-84a6-4c46-b086-1b21e1325b7d',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T12:00:00Z',
    event_received_at: '2026-02-27T12:00:01Z',
    idempotency_key: 'idem-postgres-adapter-001',
    request_id: '9e4d3bfd-352f-46f3-8d8d-2f86e12aad07',
    session_id: '25be7978-e6bb-4cf4-9153-87c954227d57',
    actor: {
      actor_id: 'anon:adapter-test',
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
      package_id: '93f6886c-8ef2-4fca-b4e1-0f5f9f774f7b',
      action: 'copy_install',
      is_promoted: false,
      command_template_id: 'tmpl-adapter'
    }
  };
}

class FakeDb implements PostgresQueryExecutor {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  readonly eventFlags: Array<{
    raw_event_id: string;
    package_id: string | null;
    outcome: string;
    rule_code: string;
    reason_code: string;
    metadata: string;
    created_at: string;
  }> = [];
  readonly outbox: Array<{
    event_type: string;
    dedupe_key: string;
    payload: string;
    source_service: string;
    occurred_at: string;
  }> = [];
  private readonly idempotency = new Map<
    string,
    {
      scope: string;
      idempotency_key: string;
      request_hash: string;
      response_code: number;
      response_body: unknown;
      stored_at: string;
    }
  >();
  private rawEventCounter = 0;

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });

    if (sql.includes('FROM ingestion_idempotency_records')) {
      const scope = params[0] as string;
      const idempotencyKey = params[1] as string;
      const row = this.idempotency.get(`${scope}:${idempotencyKey}`);
      return {
        rows: row ? ([row] as Row[]) : [],
        rowCount: row ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO ingestion_idempotency_records')) {
      const scope = params[0] as string;
      const idempotencyKey = params[1] as string;
      const requestHash = params[2] as string;
      const responseCode = params[3] as number;
      const responseBody = JSON.parse(params[4] as string);
      const storedAt = params[5] as string;
      const key = `${scope}:${idempotencyKey}`;
      const existing = this.idempotency.get(key);

      if (existing && existing.request_hash !== requestHash) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      this.idempotency.set(key, {
        scope,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        response_code: responseCode,
        response_body: responseBody,
        stored_at: storedAt
      });

      return {
        rows: ([{ request_hash: requestHash }] as Row[]),
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO raw_events')) {
      this.rawEventCounter += 1;
      return {
        rows: ([
          {
            raw_event_id: `raw-event-${this.rawEventCounter}`,
            persisted_at: params[20] as string
          }
        ] as Row[]),
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO event_flags')) {
      this.eventFlags.push({
        raw_event_id: params[0] as string,
        package_id: (params[1] as string | null) ?? null,
        outcome: params[2] as string,
        rule_code: params[4] as string,
        reason_code: params[5] as string,
        metadata: params[6] as string,
        created_at: params[7] as string
      });

      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO ingestion_outbox')) {
      const dedupeKey = params[1] as string;
      if (!this.outbox.find((entry) => entry.dedupe_key === dedupeKey)) {
        this.outbox.push({
          event_type: params[0] as string,
          dedupe_key: dedupeKey,
          payload: params[2] as string,
          source_service: params[3] as string,
          occurred_at: params[4] as string
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

describe('control-plane postgres adapters', () => {
  it('stores and replays idempotency records', async () => {
    const db = new FakeDb();
    const adapter = createPostgresIdempotencyAdapter({ db });

    await adapter.put({
      scope: 'POST:/v1/events',
      idempotency_key: 'idem-1',
      request_hash: 'hash-1',
      response_code: 202,
      response_body: {
        status: 'accepted',
        event_id: 'event-1',
        raw_event_id: 'raw-1',
        idempotency_key: 'idem-1',
        fraud_evaluations: []
      },
      stored_at: '2026-02-27T12:00:02Z'
    });

    const stored = await adapter.get('POST:/v1/events', 'idem-1');

    expect(stored).toEqual({
      scope: 'POST:/v1/events',
      idempotency_key: 'idem-1',
      request_hash: 'hash-1',
      response_code: 202,
      response_body: {
        status: 'accepted',
        event_id: 'event-1',
        raw_event_id: 'raw-1',
        idempotency_key: 'idem-1',
        fraud_evaluations: []
      },
      stored_at: '2026-02-27T12:00:02Z'
    });
  });

  it('rejects idempotency writes for same key with different hash', async () => {
    const db = new FakeDb();
    const adapter = createPostgresIdempotencyAdapter({ db });

    await adapter.put({
      scope: 'POST:/v1/events',
      idempotency_key: 'idem-2',
      request_hash: 'hash-a',
      response_code: 202,
      response_body: {
        status: 'accepted',
        event_id: 'event-a',
        raw_event_id: 'raw-a',
        idempotency_key: 'idem-2',
        fraud_evaluations: []
      },
      stored_at: '2026-02-27T12:00:03Z'
    });

    await expect(
      adapter.put({
        scope: 'POST:/v1/events',
        idempotency_key: 'idem-2',
        request_hash: 'hash-b',
        response_code: 202,
        response_body: {
          status: 'accepted',
          event_id: 'event-b',
          raw_event_id: 'raw-b',
          idempotency_key: 'idem-2',
          fraud_evaluations: []
        },
        stored_at: '2026-02-27T12:00:04Z'
      })
    ).rejects.toThrow('idempotency_conflict');
  });

  it('maps telemetry events into raw_events insert payloads', async () => {
    const db = new FakeDb();
    const adapter = createPostgresIngestionPersistenceAdapter({ db });
    const event = buildEvent();

    const persisted = await adapter.appendRawEvent(event, {
      request_id: event.request_id,
      received_at: '2026-02-27T12:00:02Z'
    });

    expect(persisted).toEqual({
      raw_event_id: 'raw-event-1',
      persisted_at: '2026-02-27T12:00:02Z'
    });

    const insertCall = db.calls.find((call) => call.sql.includes('INSERT INTO raw_events'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.params[5]).toBe('POST:/v1/events');
    expect(insertCall?.params[18]).toBe('93f6886c-8ef2-4fca-b4e1-0f5f9f774f7b');
  });

  it('writes fraud evaluations with deterministic upsert keys', async () => {
    const db = new FakeDb();
    const pipeline = createPostgresFraudFlagPipeline({
      db,
      evaluator: {
        async evaluate() {
          return [
            {
              outcome: 'flagged',
              rule_code: 'FRT-02',
              reason_code: 'duplicate_copy_install_24h',
              metadata: {
                threshold: 3
              }
            }
          ];
        }
      }
    });
    const event = buildEvent();

    const evaluations = await pipeline.evaluate(event);
    expect(evaluations).toHaveLength(1);

    await pipeline.recordEvaluations?.(
      'dd01f5fe-530c-40bd-be90-f0331f72d066',
      event,
      evaluations,
      '2026-02-27T12:00:03Z'
    );

    expect(db.eventFlags).toEqual([
      {
        raw_event_id: 'dd01f5fe-530c-40bd-be90-f0331f72d066',
        package_id: '93f6886c-8ef2-4fca-b4e1-0f5f9f774f7b',
        outcome: 'flagged',
        rule_code: 'FRT-02',
        reason_code: 'duplicate_copy_install_24h',
        metadata: JSON.stringify({
          threshold: 3
        }),
        created_at: '2026-02-27T12:00:03Z'
      }
    ]);
  });

  it('publishes outbox jobs idempotently by dedupe key', async () => {
    const db = new FakeDb();
    const publisher = createPostgresOutboxPublisher({
      db,
      sourceService: 'control-plane'
    });

    await publisher.publish({
      event_type: 'fraud.reconcile.requested',
      dedupe_key: 'event-1:fraud',
      payload: { event_id: 'event-1' },
      occurred_at: '2026-02-27T12:00:04Z'
    });
    await publisher.publish({
      event_type: 'fraud.reconcile.requested',
      dedupe_key: 'event-1:fraud',
      payload: { event_id: 'event-1' },
      occurred_at: '2026-02-27T12:00:05Z'
    });

    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({
      event_type: 'fraud.reconcile.requested',
      dedupe_key: 'event-1:fraud',
      source_service: 'control-plane'
    });
  });
});
