import { describe, expect, it } from 'vitest';
import { createEventIngestionHttpHandler } from '../src/http-handler.js';
import type { IdempotencyRecord } from '../src/index.js';

function buildEvent() {
  return {
    schema_version: '1.0.0',
    event_id: '5ad85a84-cf5e-4f76-be32-4fd6f20018f0',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T11:00:00Z',
    event_received_at: '2026-02-27T11:00:01Z',
    idempotency_key: 'idem-http-handler-001',
    request_id: 'f66f9fba-f7aa-47a7-b448-66e7f42f539a',
    session_id: 'b9f87514-f938-44e2-b282-01c0235b8fcd',
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

describe('event ingestion http handler', () => {
  it('returns accepted payload with 202 for fresh ingestion', async () => {
    const handler = createEventIngestionHttpHandler({
      idempotency: {
        async get() {
          return null;
        },
        async put() {}
      },
      persistence: {
        async appendRawEvent() {
          return {
            raw_event_id: 'raw-http-1',
            persisted_at: '2026-02-27T11:00:02Z'
          };
        }
      },
      fraudPipeline: {
        async evaluate() {
          return [];
        }
      }
    });

    const response = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers['x-idempotent-replay']).toBe('false');
    expect(response.body).toMatchObject({
      status: 'accepted',
      raw_event_id: 'raw-http-1'
    });
  });

  it('returns stored response body exactly for replay calls', async () => {
    const storedBody = {
      status: 'accepted' as const,
      event_id: '5ad85a84-cf5e-4f76-be32-4fd6f20018f0',
      raw_event_id: 'raw-http-1',
      idempotency_key: 'idem-http-handler-001',
      fraud_evaluations: [
        {
          outcome: 'clean' as const,
          rule_code: 'FRT-00',
          reason_code: 'no_issue',
          metadata: {
            pipeline_version: 1
          }
        }
      ]
    };

    const record: IdempotencyRecord = {
      scope: 'POST:/v1/events',
      idempotency_key: 'idem-http-handler-001',
      request_hash: buildRequestHash(),
      response_code: 202,
      response_body: storedBody,
      stored_at: '2026-02-27T11:00:02Z'
    };

    const handler = createEventIngestionHttpHandler({
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
      }
    });

    const response = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers['x-idempotent-replay']).toBe('true');
    expect(response.body).toEqual(storedBody);
  });
});
