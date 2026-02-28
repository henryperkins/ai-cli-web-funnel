import { describe, expect, it } from 'vitest';
import {
  createPostgresPermanentBlockPromotionStore,
  createPostgresSecurityAppealsMetricsStore,
  createPostgresSecurityPromotionDecisionStore,
  createPostgresSecurityRolloutStateStore,
  createPostgresSecurityTrustGateMetricsStore,
  type PostgresQueryExecutor
} from '../src/postgres-adapters.js';

describe('security-governance postgres trust adapters', () => {
  it('computes appeals metrics snapshot from postgres aggregates', async () => {
    const db: PostgresQueryExecutor = {
      async query<Row>() {
        return {
          rows: [
            {
              total_opened: '5',
              critical_opened: '2',
              assigned_count: '4',
              critical_assignment_sla_met_count: '2',
              first_response_recorded_count: '5',
              first_response_sla_met_count: '4',
              escalation_count_total: '3',
              assignment_latency_seconds_p50: '1800',
              assignment_latency_seconds_p95: '5400',
              first_response_latency_seconds_p50: '7200',
              first_response_latency_seconds_p95: '14400'
            } as Row
          ],
          rowCount: 1
        };
      }
    };

    const store = createPostgresSecurityAppealsMetricsStore({ db });
    const snapshot = await store.getSnapshot({
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z',
      now_iso: '2026-02-28T12:00:00Z'
    });

    expect(snapshot).toMatchObject({
      total_opened: 5,
      critical_opened: 2,
      assigned_count: 4,
      critical_assignment_sla_met_count: 2,
      first_response_sla_met_count: 4,
      escalation_count_total: 3,
      critical_assignment_sla_rate: 1,
      first_response_sla_rate: 0.8
    });
  });

  it('validates and promotes permanent blocks through SQL functions', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const db: PostgresQueryExecutor = {
      async query<Row>(sql: string, params: readonly unknown[] = []) {
        calls.push({ sql, params });

        if (sql.includes('FROM security_validate_perm_block_requirements')) {
          return {
            rows: [
              {
                eligible: true,
                trusted_reporter_count: '2',
                distinct_active_key_count: '2',
                corroborating_report_count: '3',
                reviewer_confirmed: true,
                evidence: {
                  trusted_reporter_count: 2
                }
              } as Row
            ],
            rowCount: 1
          };
        }

        if (sql.includes('FROM security_promote_policy_block_perm')) {
          return {
            rows: [
              {
                action_id: 'perm-action-1',
                evidence: {
                  trusted_reporter_count: 2
                }
              } as Row
            ],
            rowCount: 1
          };
        }

        throw new Error(`Unhandled SQL: ${sql}`);
      }
    };

    const store = createPostgresPermanentBlockPromotionStore({ db });
    const validation = await store.validate({
      package_id: '5d602d87-33d8-4a09-9d16-5f7486e0e4e7',
      reviewer_id: 'reviewer-1',
      reviewer_confirmed_at: '2026-02-28T12:00:00Z'
    });
    const promotion = await store.promote({
      package_id: '5d602d87-33d8-4a09-9d16-5f7486e0e4e7',
      reason_code: 'policy_blocked_malware',
      reviewer_id: 'reviewer-1',
      reviewer_confirmed_at: '2026-02-28T12:00:00Z',
      created_at: '2026-02-28T12:00:00Z'
    });

    expect(validation.eligible).toBe(true);
    expect(validation.trusted_reporter_count).toBe(2);
    expect(promotion.action_id).toBe('perm-action-1');
    expect(calls).toHaveLength(2);
  });

  it('reads and updates rollout singleton state', async () => {
    let row: {
      current_mode: 'raw-only' | 'flagged-first' | 'full-catalog';
      freeze_active: boolean;
      freeze_reason: string | null;
      decision_run_id: string | null;
      decision_evidence: Record<string, unknown>;
      updated_at: string;
    } | null = null;

    const db: PostgresQueryExecutor = {
      async query<Row>(sql: string, params: readonly unknown[] = []) {
        if (sql.includes('FROM security_enforcement_rollout_state')) {
          return {
            rows: row ? ([{ ...row } as Row]) : [],
            rowCount: row ? 1 : 0
          };
        }

        if (sql.includes('INSERT INTO security_enforcement_rollout_state')) {
          row = {
            current_mode: params[0] as 'raw-only' | 'flagged-first' | 'full-catalog',
            freeze_active: params[1] as boolean,
            freeze_reason: (params[2] as string | null) ?? null,
            decision_run_id: (params[3] as string | null) ?? null,
            decision_evidence: JSON.parse((params[4] as string) ?? '{}') as Record<
              string,
              unknown
            >,
            updated_at: params[5] as string
          };

          return {
            rows: [{ ...row } as Row],
            rowCount: 1
          };
        }

        throw new Error(`Unhandled SQL: ${sql}`);
      }
    };

    const store = createPostgresSecurityRolloutStateStore({ db });
    const bootstrapped = await store.getState();
    expect(bootstrapped.current_mode).toBe('raw-only');
    expect(bootstrapped.freeze_active).toBe(true);

    const updated = await store.updateState({
      current_mode: 'flagged-first',
      freeze_active: false,
      freeze_reason: null,
      decision_run_id: 'run-1',
      decision_evidence: {
        promoted: true
      },
      updated_at: '2026-02-28T12:00:00Z'
    });
    expect(updated.current_mode).toBe('flagged-first');
    expect(updated.freeze_active).toBe(false);
  });

  it('stores and lists promotion decisions', async () => {
    const decisions: Array<Record<string, unknown>> = [];
    const db: PostgresQueryExecutor = {
      async query<Row>(sql: string, params: readonly unknown[] = []) {
        if (sql.includes('INSERT INTO security_enforcement_promotion_decisions')) {
          decisions.unshift({
            run_id: params[0],
            decision_type: params[1],
            previous_mode: params[2],
            decided_mode: params[3],
            freeze_active: params[4],
            gate_false_positive_pass: params[5],
            gate_appeals_sla_pass: params[6],
            gate_backlog_pass: params[7],
            window_from: params[8],
            window_to: params[9],
            trigger: params[10],
            evidence: JSON.parse(params[11] as string),
            created_at: params[12]
          });
          return {
            rows: [] as Row[],
            rowCount: 1
          };
        }

        if (sql.includes('FROM security_enforcement_promotion_decisions')) {
          return {
            rows: decisions.map((entry) => ({ ...entry })) as Row[],
            rowCount: decisions.length
          };
        }

        throw new Error(`Unhandled SQL: ${sql}`);
      }
    };

    const store = createPostgresSecurityPromotionDecisionStore({ db });
    await store.append({
      run_id: 'run-1',
      decision_type: 'promote',
      previous_mode: 'raw-only',
      decided_mode: 'flagged-first',
      freeze_active: false,
      gate_false_positive_pass: true,
      gate_appeals_sla_pass: true,
      gate_backlog_pass: true,
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z',
      trigger: 'weekly',
      evidence: {
        promoted: true
      },
      created_at: '2026-02-28T12:00:00Z'
    });

    const listed = await store.listRecent(5);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.run_id).toBe('run-1');
    expect(listed[0]?.decision_type).toBe('promote');
  });

  it('computes trust-gate metrics snapshot', async () => {
    const db: PostgresQueryExecutor = {
      async query<Row>() {
        return {
          rows: [
            {
              false_positive_numerator: '1',
              false_positive_denominator: '120',
              appeals_sla_numerator: '20',
              appeals_sla_denominator: '20',
              unresolved_critical_backlog_breach_count: '0'
            } as Row
          ],
          rowCount: 1
        };
      }
    };

    const store = createPostgresSecurityTrustGateMetricsStore({ db });
    const snapshot = await store.getSnapshot({
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z',
      now_iso: '2026-02-28T12:00:00Z'
    });

    expect(snapshot.false_positive_rate).toBeCloseTo(1 / 120, 6);
    expect(snapshot.appeals_sla_rate).toBe(1);
    expect(snapshot.unresolved_critical_backlog_breach_count).toBe(0);
  });
});
