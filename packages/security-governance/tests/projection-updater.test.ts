import { describe, expect, it } from 'vitest';
import {
  createReporterScoreRecomputeService,
  createSecurityEnforcementProjectionUpdater,
  InMemorySecurityEnforcementStore
} from '../src/index.js';

describe('security enforcement projection updater', () => {
  it('recomputes deterministically across multi-report ordering and expiry windows', async () => {
    const store = new InMemorySecurityEnforcementStore();
    const updater = createSecurityEnforcementProjectionUpdater(store);

    await updater.appendActionAndRecompute(
      {
        action_id: 'action-flagged',
        package_id: 'pkg-1',
        state: 'flagged',
        reason_code: 'needs_human_review',
        active: true,
        created_at: '2026-02-27T12:00:00Z',
        source: 'security_governance',
        expires_at: null,
        supersedes_action_id: null
      },
      '2026-02-27T12:00:01Z'
    );

    await updater.appendActionAndRecompute(
      {
        action_id: 'action-temp-block',
        package_id: 'pkg-1',
        state: 'policy_blocked_temp',
        reason_code: 'malware_critical_tier_a',
        active: true,
        created_at: '2026-02-27T12:05:00Z',
        source: 'security_governance',
        expires_at: '2026-02-27T13:05:00Z',
        supersedes_action_id: null
      },
      '2026-02-27T12:05:01Z'
    );

    const beforeExpiry = await updater.recompute('pkg-1', '2026-02-27T12:30:00Z');
    const afterExpiry = await updater.recompute('pkg-1', '2026-02-27T14:00:00Z');
    const replay = await updater.recompute('pkg-1', '2026-02-27T14:00:00Z');

    expect(beforeExpiry.state).toBe('policy_blocked_temp');
    expect(afterExpiry.state).toBe('flagged');
    expect(replay).toEqual(afterExpiry);

    const history = await store.listActionHistory('pkg-1');
    expect(history).toHaveLength(2);
    expect(history.map((action) => action.action_id)).toEqual([
      'action-flagged',
      'action-temp-block'
    ]);
  });

  it('uses deterministic action_id tie-break when precedence and timestamp are equal', async () => {
    const store = new InMemorySecurityEnforcementStore();
    const updater = createSecurityEnforcementProjectionUpdater(store);

    await updater.appendActionAndRecompute(
      {
        action_id: 'action-a',
        package_id: 'pkg-2',
        state: 'flagged',
        reason_code: 'rule-a',
        active: true,
        created_at: '2026-02-27T15:00:00Z',
        source: 'security_governance',
        expires_at: null,
        supersedes_action_id: null
      },
      '2026-02-27T15:00:00Z'
    );

    const projection = await updater.appendActionAndRecompute(
      {
        action_id: 'action-b',
        package_id: 'pkg-2',
        state: 'flagged',
        reason_code: 'rule-b',
        active: true,
        created_at: '2026-02-27T15:00:00Z',
        source: 'security_governance',
        expires_at: null,
        supersedes_action_id: null
      },
      '2026-02-27T15:00:01Z'
    );

    expect(projection.state).toBe('flagged');
    expect(projection.reason_code).toBe('rule-b');
  });
});

describe('reporter score recompute guard', () => {
  it('asserts reporter metrics readiness before recompute execution', async () => {
    const callOrder: string[] = [];

    const service = createReporterScoreRecomputeService({
      readiness: {
        async assertMetricsReady() {
          callOrder.push('assert-ready');
        }
      },
      scoring: {
        async recomputeReporterScores() {
          callOrder.push('recompute');
          return {
            recomputed_count: 4,
            computed_at: '2026-02-27T16:00:00Z'
          };
        }
      }
    });

    const result = await service.recompute();

    expect(callOrder).toEqual(['assert-ready', 'recompute']);
    expect(result).toEqual({
      status: 'recomputed',
      recomputed_count: 4,
      computed_at: '2026-02-27T16:00:00Z'
    });
  });
});
