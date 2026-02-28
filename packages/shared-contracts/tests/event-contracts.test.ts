import { describe, expect, it } from 'vitest';
import {
  EVENT_SCHEMA_VERSION_V1,
  assertTelemetryEventEnvelope,
  getFraudOutcomeDisposition,
  isPolicyBlockedState,
  validateTelemetryEventEnvelope
} from '../src/index.js';

function buildBaseEnvelope() {
  return {
    schema_version: EVENT_SCHEMA_VERSION_V1,
    event_id: 'b1f5e2a3-2b7d-4be9-9560-6fc9d16d5f53',
    event_name: 'package.action' as const,
    event_occurred_at: '2026-02-27T10:15:00Z',
    event_received_at: '2026-02-27T10:15:01Z',
    idempotency_key: 'idem-session-action-001',
    request_id: '6fdce4b9-8c9c-4a6c-8dd9-4c3a84dbaf7a',
    session_id: '1309092f-e2ef-4a85-913b-e89f0ee2758b',
    actor: {
      actor_id: 'anon:rotating-123',
      actor_type: 'anonymous' as const
    },
    privacy: {
      consent_state: 'granted' as const,
      region: 'US'
    },
    client: {
      app: 'web' as const,
      app_version: '0.1.0',
      user_agent_family: 'chromium' as const,
      device_class: 'desktop' as const,
      referrer_domain: 'example.org'
    },
    payload: {
      package_id: 'fef6eb97-6708-46f7-86dc-7e4f63f6ae98',
      action: 'copy_install' as const,
      is_promoted: false,
      command_template_id: 'npm-install-template-v1'
    }
  };
}

describe('event schema v1 contracts', () => {
  it('accepts a valid package.action event and preserves typed payload access', () => {
    const envelope = buildBaseEnvelope();

    const result = validateTelemetryEventEnvelope(envelope);
    expect(result.ok).toBe(true);

    const typed = assertTelemetryEventEnvelope(envelope);
    expect(typed.payload.command_template_id).toBe('npm-install-template-v1');
  });

  it('rejects behavioral event when consent is denied by default', () => {
    const envelope = buildBaseEnvelope();
    envelope.privacy.consent_state = 'denied';

    const result = validateTelemetryEventEnvelope(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === 'privacy.consent_state')).toBe(true);
    }
  });

  it('rejects payloads containing forbidden privacy fields', () => {
    const envelope = buildBaseEnvelope();
    (envelope.payload as Record<string, unknown>).ip_address = '203.0.113.10';

    const result = validateTelemetryEventEnvelope(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === 'payload.ip_address')).toBe(true);
    }
  });

  it('accepts runtime policy events when consent is denied', () => {
    const runtimeEnvelope = {
      schema_version: EVENT_SCHEMA_VERSION_V1,
      event_id: 'f854ca28-58c9-4f79-bd3a-eeb653a7414b',
      event_name: 'server.policy_check' as const,
      event_occurred_at: '2026-02-27T10:20:00Z',
      event_received_at: '2026-02-27T10:20:01Z',
      idempotency_key: 'idem-policy-check-001',
      request_id: 'e2ebb2ea-08a0-4f6a-8071-9f27a58e00e9',
      session_id: '1a9f88df-e4d1-4e79-964b-2586f412150f',
      actor: {
        actor_id: 'anon:runtime',
        actor_type: 'anonymous' as const
      },
      privacy: {
        consent_state: 'denied' as const,
        region: 'US'
      },
      client: {
        app: 'runtime' as const,
        app_version: '0.1.0',
        user_agent_family: 'other' as const,
        device_class: 'desktop' as const,
        referrer_domain: null
      },
      payload: {
        mode: 'local' as const,
        adapter: 'copilot-vscode',
        scope: 'workspace' as const,
        outcome: 'allowed',
        duration_ms: 8,
        attempt: 1,
        policy_source: 'combined' as const,
        blocked: false
      }
    };

    const result = validateTelemetryEventEnvelope(runtimeEnvelope);
    expect(result.ok).toBe(true);
  });

  it('maps fraud outcomes to deterministic inclusion behavior', () => {
    expect(getFraudOutcomeDisposition('clean')).toEqual({
      accepted: true,
      include_in_ranking: true,
      include_in_billing: true
    });

    expect(getFraudOutcomeDisposition('flagged')).toEqual({
      accepted: true,
      include_in_ranking: false,
      include_in_billing: false
    });

    expect(getFraudOutcomeDisposition('blocked')).toEqual({
      accepted: false,
      include_in_ranking: false,
      include_in_billing: false
    });

    expect(isPolicyBlockedState('policy_blocked_temp')).toBe(true);
    expect(isPolicyBlockedState('flagged')).toBe(false);
  });
});
