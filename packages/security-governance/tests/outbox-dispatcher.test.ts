import { describe, expect, it } from 'vitest';
import { createDeterministicOutboxDispatcher } from '../src/outbox-dispatcher.js';

describe('deterministic outbox dispatcher', () => {
  it('dispatches supported event types to matching handlers', async () => {
    const calls: string[] = [];
    const dispatcher = createDeterministicOutboxDispatcher({
      fraud_reconcile_requested: async () => {
        calls.push('fraud.reconcile.requested');
      },
      ranking_sync_requested: async () => {
        calls.push('ranking.sync.requested');
      },
      security_report_accepted: async () => {
        calls.push('security.report.accepted');
      },
      security_enforcement_recompute_requested: async () => {
        calls.push('security.enforcement.recompute.requested');
      },
      install_plan_created: async () => {
        calls.push('install.plan.created');
      },
      install_apply_succeeded: async () => {
        calls.push('install.apply.succeeded');
      },
      install_apply_failed: async () => {
        calls.push('install.apply.failed');
      },
      install_verify_succeeded: async () => {
        calls.push('install.verify.succeeded');
      },
      install_verify_failed: async () => {
        calls.push('install.verify.failed');
      }
    });

    const supported = [
      'fraud.reconcile.requested',
      'ranking.sync.requested',
      'security.report.accepted',
      'security.enforcement.recompute.requested',
      'install.plan.created',
      'install.apply.succeeded',
      'install.apply.failed',
      'install.verify.succeeded',
      'install.verify.failed'
    ] as const;

    for (const eventType of supported) {
      await dispatcher.dispatch({
        id: `job-${eventType}`,
        dedupe_key: `dedupe-${eventType}`,
        event_type: eventType,
        payload: {},
        attempt_count: 1
      });
    }

    expect(calls).toEqual([...supported]);
  });

  it('throws on unsupported event types', async () => {
    const dispatcher = createDeterministicOutboxDispatcher();

    await expect(
      dispatcher.dispatch({
        id: 'job-unknown',
        dedupe_key: 'dedupe-unknown',
        event_type: 'metrics.aggregate.requested',
        payload: {},
        attempt_count: 1
      })
    ).rejects.toThrow('unsupported_event_type:metrics.aggregate.requested');
  });
});
