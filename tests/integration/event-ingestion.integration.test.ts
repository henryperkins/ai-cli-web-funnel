import { describe, expect, it } from 'vitest';
import { createEventIngestionEntrypoint, type IdempotencyRecord } from '@forge/control-plane';

function buildEvent() {
  return {
    schema_version: '1.0.0',
    event_id: '91cf6a57-8de1-4d7c-9072-6f102571f8e1',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T12:00:00Z',
    event_received_at: '2026-02-27T12:00:01Z',
    idempotency_key: 'idem-intg-001',
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

describe('integration: event validation -> ingestion behavior', () => {
  it('accepts valid event and forwards fraud evaluation payload', async () => {
    const idempotency = new Map<string, IdempotencyRecord>();

    const entrypoint = createEventIngestionEntrypoint({
      idempotency: {
        async get(scope, key) {
          return idempotency.get(`${scope}:${key}`) ?? null;
        },
        async put(record) {
          idempotency.set(`${record.scope}:${record.idempotency_key}`, record);
        }
      },
      persistence: {
        async appendRawEvent() {
          return {
            raw_event_id: 'raw-intg-1',
            persisted_at: '2026-02-27T12:00:02Z'
          };
        }
      },
      fraudPipeline: {
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

    const result = await entrypoint.ingest({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.fraud_evaluations[0]?.outcome).toBe('flagged');
      expect(result.fraud_evaluations[0]?.rule_code).toBe('FRT-02');
    }
  });

  it('rejects malformed events before persistence', async () => {
    let persisted = false;

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
          persisted = true;
          return {
            raw_event_id: 'raw-intg-2',
            persisted_at: '2026-02-27T12:00:03Z'
          };
        }
      }
    });

    const invalid = buildEvent();
    invalid.payload.command_template_id = '';

    const result = await entrypoint.ingest({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: invalid
    });

    expect(result.status).toBe('rejected');
    expect(persisted).toBe(false);
  });
});
