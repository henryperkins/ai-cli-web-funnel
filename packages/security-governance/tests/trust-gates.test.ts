import { describe, expect, it } from 'vitest';
import {
  createPermanentBlockPromotionService,
  createSecurityAppealsMetricsService,
  createSecurityRolloutModeResolver,
  createSecurityTrustGateDecisionService,
  resolveRolloutProjectedState,
  type PermanentBlockPromotionStore,
  type SecurityAppealsMetricsStore,
  type SecurityPromotionDecisionRecord,
  type SecurityPromotionDecisionStore,
  type SecurityRolloutStateStore,
  type SecurityTrustGateMetricsStore
} from '../src/index.js';

class InMemoryRolloutStateStore implements SecurityRolloutStateStore {
  private state = {
    current_mode: 'raw-only' as const,
    freeze_active: true,
    freeze_reason: 'bootstrap',
    decision_run_id: 'bootstrap',
    decision_evidence: {
      bootstrap: true
    },
    updated_at: '2026-02-28T00:00:00Z'
  };

  async getState() {
    return { ...this.state, decision_evidence: { ...this.state.decision_evidence } };
  }

  async updateState(input: {
    current_mode: 'raw-only' | 'flagged-first' | 'full-catalog';
    freeze_active: boolean;
    freeze_reason: string | null;
    decision_run_id: string | null;
    decision_evidence: Record<string, unknown>;
    updated_at: string;
  }) {
    this.state = {
      ...input,
      decision_evidence: { ...input.decision_evidence }
    };
    return this.getState();
  }
}

class InMemoryDecisionStore implements SecurityPromotionDecisionStore {
  readonly decisions: SecurityPromotionDecisionRecord[] = [];

  async listRecent(limit: number): Promise<SecurityPromotionDecisionRecord[]> {
    return this.decisions.slice(0, limit).map((entry) => ({
      ...entry,
      evidence: { ...entry.evidence }
    }));
  }

  async append(decision: SecurityPromotionDecisionRecord): Promise<void> {
    this.decisions.unshift({
      ...decision,
      evidence: { ...decision.evidence }
    });
  }
}

describe('security rollout projection resolver', () => {
  it('downgrades curated blocks in raw-only mode', () => {
    const resolution = resolveRolloutProjectedState({
      projected_state: 'policy_blocked_temp',
      source_kind: 'curated',
      mode: 'raw-only',
      freeze_active: false
    });

    expect(resolution.state).toBe('flagged');
    expect(resolution.mode).toBe('raw-only');
    expect(resolution.adjusted).toBe(true);
  });

  it('forces raw-only mode while freeze is active', () => {
    const resolution = resolveRolloutProjectedState({
      projected_state: 'policy_blocked_temp',
      source_kind: 'curated',
      mode: 'full-catalog',
      freeze_active: true
    });

    expect(resolution.mode).toBe('raw-only');
    expect(resolution.state).toBe('flagged');
  });

  it('resolves projections from rollout state store', async () => {
    const stateStore = new InMemoryRolloutStateStore();
    await stateStore.updateState({
      current_mode: 'flagged-first',
      freeze_active: false,
      freeze_reason: null,
      decision_run_id: 'run-1',
      decision_evidence: {},
      updated_at: '2026-02-28T10:00:00Z'
    });

    const resolver = createSecurityRolloutModeResolver({
      rolloutStateStore: stateStore
    });

    const resolution = await resolver.resolveProjection({
      projected_state: 'policy_blocked_temp',
      source_kind: 'raw'
    });

    expect(resolution.state).toBe('flagged');
    expect(resolution.mode).toBe('flagged-first');
    expect(resolution.adjusted).toBe(true);
  });
});

describe('permanent block promotion service', () => {
  it('returns rejected when requirement validation fails', async () => {
    const store: PermanentBlockPromotionStore = {
      async validate() {
        return {
          eligible: false,
          trusted_reporter_count: 1,
          distinct_active_key_count: 1,
          corroborating_report_count: 1,
          reviewer_confirmed: false,
          evidence: {
            reason: 'insufficient_sources'
          }
        };
      },
      async promote() {
        throw new Error('should_not_promote');
      }
    };

    const service = createPermanentBlockPromotionService({
      store
    });

    const result = await service.promote({
      package_id: 'pkg-1',
      reason_code: 'policy_blocked_malware',
      reviewer_id: 'reviewer-1',
      reviewer_confirmed_at: '2026-02-28T12:00:00Z'
    });

    expect(result).toEqual({
      status: 'rejected',
      package_id: 'pkg-1',
      action_id: null,
      evidence: {
        reason: 'insufficient_sources'
      }
    });
  });

  it('promotes when validation passes', async () => {
    const store: PermanentBlockPromotionStore = {
      async validate() {
        return {
          eligible: true,
          trusted_reporter_count: 2,
          distinct_active_key_count: 2,
          corroborating_report_count: 2,
          reviewer_confirmed: true,
          evidence: {
            ok: true
          }
        };
      },
      async promote() {
        return {
          action_id: 'perm-action-1',
          evidence: {
            ok: true
          }
        };
      }
    };

    const service = createPermanentBlockPromotionService({
      store
    });

    const result = await service.promote({
      package_id: 'pkg-1',
      reason_code: 'policy_blocked_malware',
      reviewer_id: 'reviewer-1',
      reviewer_confirmed_at: '2026-02-28T12:00:00Z',
      created_at: '2026-02-28T12:00:00Z'
    });

    expect(result).toEqual({
      status: 'promoted',
      package_id: 'pkg-1',
      action_id: 'perm-action-1',
      evidence: {
        ok: true
      }
    });
  });
});

describe('security trust gate decision service', () => {
  it('promotes from raw-only to flagged-first after consecutive gate passes', async () => {
    const stateStore = new InMemoryRolloutStateStore();
    const decisionStore = new InMemoryDecisionStore();
    decisionStore.decisions.push(
      {
        run_id: 'prior-1',
        decision_type: 'hold',
        previous_mode: 'raw-only',
        decided_mode: 'raw-only',
        freeze_active: true,
        gate_false_positive_pass: true,
        gate_appeals_sla_pass: true,
        gate_backlog_pass: true,
        window_from: '2026-02-14T00:00:00Z',
        window_to: '2026-02-21T00:00:00Z',
        trigger: 'weekly',
        evidence: {},
        created_at: '2026-02-21T00:00:00Z'
      }
    );
    const metricsStore: SecurityTrustGateMetricsStore = {
      async getSnapshot() {
        return {
          false_positive_numerator: 1,
          false_positive_denominator: 200,
          false_positive_rate: 0.005,
          appeals_sla_numerator: 10,
          appeals_sla_denominator: 10,
          appeals_sla_rate: 1,
          unresolved_critical_backlog_breach_count: 0,
          metrics_generated_at: '2026-02-28T12:00:00Z'
        };
      }
    };

    const service = createSecurityTrustGateDecisionService({
      metricsStore,
      rolloutStateStore: stateStore,
      decisionStore,
      now: () => new Date('2026-02-28T12:00:00Z')
    });

    const result = await service.evaluate({
      run_id: 'run-1',
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z',
      trigger: 'weekly'
    });

    expect(result.decision_type).toBe('promote');
    expect(result.decided_mode).toBe('flagged-first');
    expect(result.freeze_active).toBe(false);
    expect(result.false_positive_pass_streak).toBe(2);
    expect(result.appeals_sla_pass_streak).toBe(2);
  });

  it('freezes and reverts to raw-only when a gate regresses', async () => {
    const stateStore = new InMemoryRolloutStateStore();
    await stateStore.updateState({
      current_mode: 'full-catalog',
      freeze_active: false,
      freeze_reason: null,
      decision_run_id: 'prior',
      decision_evidence: {},
      updated_at: '2026-02-28T09:00:00Z'
    });
    const decisionStore = new InMemoryDecisionStore();
    const metricsStore: SecurityTrustGateMetricsStore = {
      async getSnapshot() {
        return {
          false_positive_numerator: 4,
          false_positive_denominator: 100,
          false_positive_rate: 0.04,
          appeals_sla_numerator: 7,
          appeals_sla_denominator: 10,
          appeals_sla_rate: 0.7,
          unresolved_critical_backlog_breach_count: 2,
          metrics_generated_at: '2026-02-28T12:00:00Z'
        };
      }
    };

    const service = createSecurityTrustGateDecisionService({
      metricsStore,
      rolloutStateStore: stateStore,
      decisionStore,
      now: () => new Date('2026-02-28T12:00:00Z')
    });

    const result = await service.evaluate({
      run_id: 'run-2',
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z',
      trigger: 'weekly'
    });

    expect(result.decision_type).toBe('revert');
    expect(result.decided_mode).toBe('raw-only');
    expect(result.freeze_active).toBe(true);
    expect(result.gate_false_positive_pass).toBe(false);
    expect(result.gate_appeals_sla_pass).toBe(false);
    expect(result.gate_backlog_pass).toBe(false);
  });
});

describe('security appeals metrics service', () => {
  it('returns assignment/response/escalation metrics from the backing store', async () => {
    const metricsStore: SecurityAppealsMetricsStore = {
      async getSnapshot() {
        return {
          window_from: '2026-02-21T00:00:00Z',
          window_to: '2026-02-28T00:00:00Z',
          total_opened: 8,
          critical_opened: 3,
          assigned_count: 8,
          critical_assignment_sla_met_count: 3,
          first_response_recorded_count: 8,
          first_response_sla_met_count: 8,
          escalation_count_total: 1,
          assignment_latency_seconds_p50: 900,
          assignment_latency_seconds_p95: 2500,
          first_response_latency_seconds_p50: 3600,
          first_response_latency_seconds_p95: 15000,
          critical_assignment_sla_rate: 1,
          first_response_sla_rate: 1
        };
      }
    };

    const service = createSecurityAppealsMetricsService({
      metricsStore,
      now: () => new Date('2026-02-28T12:00:00Z')
    });

    const snapshot = await service.collect({
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z'
    });

    expect(snapshot.assigned_count).toBe(8);
    expect(snapshot.critical_assignment_sla_rate).toBe(1);
    expect(snapshot.first_response_sla_rate).toBe(1);
    expect(snapshot.escalation_count_total).toBe(1);
  });
});
