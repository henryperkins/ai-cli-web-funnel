import { describe, expect, it } from 'vitest';
import { createEventIngestionEntrypoint, type IdempotencyRecord } from '../src/index.js';

function buildEvent() {
  return {
    schema_version: '1.0.0',
    event_id: '22f6b09b-77a7-4cad-b581-6be2972b8ca2',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T11:00:00Z',
    event_received_at: '2026-02-27T11:00:01Z',
    idempotency_key: 'idem-control-plane-001',
    request_id: '7a5f9fd7-77df-4453-bf86-a88596ca48ee',
    session_id: '0dfa2f95-df47-433e-a844-f43d446215ec',
    actor: {
      actor_id: 'anon:test',
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
      command_template_id: 'tmpl-1'
    }
  } as const;
}

function buildRequestHash() {
  const event = buildEvent();
  return [
    event.event_id,
    event.idempotency_key,
    event.event_occurred_at,
    event.event_name,
    event.request_id
  ].join(':');
}

describe('control-plane ingestion entrypoint', () => {
  it('accepts valid events and records idempotency', async () => {
    const idempotencyMap = new Map<string, IdempotencyRecord>();
    const published: string[] = [];

    const entrypoint = createEventIngestionEntrypoint({
      idempotency: {
        async get(scope, key) {
          return idempotencyMap.get(`${scope}:${key}`) ?? null;
        },
        async put(record) {
          idempotencyMap.set(`${record.scope}:${record.idempotency_key}`, record);
        }
      },
      persistence: {
        async appendRawEvent() {
          return {
            raw_event_id: 'raw-1',
            persisted_at: '2026-02-27T11:00:02Z'
          };
        }
      },
      fraudPipeline: {
        async evaluate() {
          return [
            {
              outcome: 'clean',
              rule_code: 'FRT-00',
              reason_code: 'no_issue',
              metadata: {}
            }
          ];
        }
      },
      outboxPublisher: {
        async publish(envelope) {
          published.push(`${envelope.event_type}:${envelope.dedupe_key}`);
        }
      }
    });

    const result = await entrypoint.ingest({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.raw_event_id).toBe('raw-1');
      expect(result.fraud_evaluations).toHaveLength(1);
    }
    expect(published).toEqual([
      'fraud.reconcile.requested:22f6b09b-77a7-4cad-b581-6be2972b8ca2:idem-control-plane-001:fraud',
      'ranking.sync.requested:22f6b09b-77a7-4cad-b581-6be2972b8ca2:idem-control-plane-001:ranking'
    ]);
  });

  it('returns replayed for duplicate idempotency keys', async () => {
    const published: string[] = [];
    const record: IdempotencyRecord = {
      scope: 'POST:/v1/events',
      idempotency_key: 'idem-control-plane-001',
      request_hash: buildRequestHash(),
      response_code: 202,
      response_body: {
        status: 'accepted',
        event_id: '22f6b09b-77a7-4cad-b581-6be2972b8ca2',
        raw_event_id: 'raw-1',
        idempotency_key: 'idem-control-plane-001',
        fraud_evaluations: []
      },
      stored_at: '2026-02-27T11:00:02Z'
    };

    const entrypoint = createEventIngestionEntrypoint({
      idempotency: {
        async get() {
          return record;
        },
        async put() {
          throw new Error('should not write for replay');
        }
      },
      persistence: {
        async appendRawEvent() {
          throw new Error('should not persist for replay');
        }
      },
      outboxPublisher: {
        async publish(envelope) {
          published.push(envelope.event_type);
        }
      }
    });

    const result = await entrypoint.ingest({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });

    expect(result.status).toBe('replayed');
    if (result.status === 'replayed') {
      expect(result.previous_response_body).toEqual(record.response_body);
    }
    expect(published).toEqual([]);
  });

  it('returns conflict for duplicate idempotency keys with a different request hash', async () => {
    const record: IdempotencyRecord = {
      scope: 'POST:/v1/events',
      idempotency_key: 'idem-control-plane-001',
      request_hash: 'mismatched-hash',
      response_code: 202,
      response_body: {
        status: 'accepted',
        event_id: '22f6b09b-77a7-4cad-b581-6be2972b8ca2',
        raw_event_id: 'raw-1',
        idempotency_key: 'idem-control-plane-001',
        fraud_evaluations: []
      },
      stored_at: '2026-02-27T11:00:02Z'
    };

    const entrypoint = createEventIngestionEntrypoint({
      idempotency: {
        async get() {
          return record;
        },
        async put() {
          throw new Error('should not write for conflict');
        }
      },
      persistence: {
        async appendRawEvent() {
          throw new Error('should not persist for conflict');
        }
      }
    });

    const result = await entrypoint.ingest({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });

    expect(result.status).toBe('conflict');
  });

  it('rejects invalid payloads', async () => {
    const entrypoint = createEventIngestionEntrypoint({
      idempotency: {
        async get() {
          return null;
        },
        async put() {
          return;
        }
      },
      persistence: {
        async appendRawEvent() {
          throw new Error('unexpected persistence');
        }
      }
    });

    const badBody = buildEvent();
    badBody.payload.command_template_id = '';

    const result = await entrypoint.ingest({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: badBody
    });

    expect(result.status).toBe('rejected');
  });
});
