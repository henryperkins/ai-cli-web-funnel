import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  createPermanentBlockPromotionService,
  createSecurityRolloutModeResolver,
  createSecurityTrustGateDecisionService
} from '../../packages/security-governance/src/index.js';
import {
  createPostgresPermanentBlockPromotionStore,
  createPostgresSecurityPromotionDecisionStore,
  createPostgresSecurityRolloutStateStore,
  createPostgresSecurityTrustGateMetricsStore
} from '../../packages/security-governance/src/postgres-adapters.js';
import {
  createIntegrationDbExecutor,
  resetIntegrationTables,
  seedPackage,
  seedReporter
} from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

const packageId = '17fa9db2-feb8-4f8d-9d2a-c6aa78d0073e';

describe('integration-db: security trust gates and promotion workflow', () => {
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const db = createIntegrationDbExecutor(pool);

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  beforeEach(async () => {
    await resetIntegrationTables(pool);
    await seedPackage(pool, packageId);
    await seedReporter(pool, 'reporter-a');
    await seedReporter(pool, 'reporter-b');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('enforces two-source + reviewer confirmation before permanent block promotion', async () => {
    await pool.query(
      `
        INSERT INTO security_reports (
          report_id,
          reporter_id,
          reporter_key_id,
          package_id,
          severity,
          source_kind,
          signature_valid,
          evidence_minimums_met,
          abuse_suspected,
          reason_code,
          queue,
          projected_state,
          body_sha256,
          request_timestamp,
          request_nonce,
          summary,
          evidence_count,
          metadata,
          created_at
        )
        VALUES
          (
            'perm-report-1',
            'reporter-a',
            'key-a',
            $1::uuid,
            'critical',
            'raw',
            TRUE,
            TRUE,
            FALSE,
            'needs_human_review',
            'queued_review',
            'policy_blocked_temp',
            'abc',
            '2026-02-28T10:00:00Z'::timestamptz,
            'nonce-a',
            'report-a',
            1,
            '{}'::jsonb,
            '2026-02-28T10:00:00Z'::timestamptz
          ),
          (
            'perm-report-2',
            'reporter-b',
            'key-b',
            $1::uuid,
            'critical',
            'raw',
            TRUE,
            TRUE,
            FALSE,
            'needs_human_review',
            'queued_review',
            'policy_blocked_temp',
            'def',
            '2026-02-28T10:05:00Z'::timestamptz,
            'nonce-b',
            'report-b',
            1,
            '{}'::jsonb,
            '2026-02-28T10:05:00Z'::timestamptz
          )
      `,
      [packageId]
    );

    const store = createPostgresPermanentBlockPromotionStore({ db });
    const service = createPermanentBlockPromotionService({
      store
    });

    const promoted = await service.promote({
      package_id: packageId,
      reason_code: 'policy_blocked_malware',
      reviewer_id: 'reviewer-1',
      reviewer_confirmed_at: '2026-02-28T11:00:00Z',
      created_at: '2026-02-28T11:00:00Z'
    });

    expect(promoted.status).toBe('promoted');
    expect(promoted.action_id).toBeTruthy();

    const actions = await pool.query<{ state: string }>(
      `
        SELECT state::text AS state
        FROM security_enforcement_actions
        WHERE package_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [packageId]
    );

    const projection = await pool.query<{ state: string; policy_blocked: boolean }>(
      `
        SELECT state::text AS state, policy_blocked
        FROM security_enforcement_projections
        WHERE package_id = $1::uuid
        LIMIT 1
      `,
      [packageId]
    );

    expect(actions.rows[0]?.state).toBe('policy_blocked_perm');
    expect(projection.rows[0]?.state).toBe('policy_blocked_perm');
    expect(projection.rows[0]?.policy_blocked).toBe(true);
  });

  it('logs trust gate decisions and updates rollout state', async () => {
    const decisionStore = createPostgresSecurityPromotionDecisionStore({ db });
    const rolloutStateStore = createPostgresSecurityRolloutStateStore({ db });
    const metricsStore = createPostgresSecurityTrustGateMetricsStore({ db });

    await decisionStore.append({
      run_id: 'trust-prior',
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
      evidence: {
        bootstrap: true
      },
      created_at: '2026-02-21T00:00:00Z'
    });

    const actionSeed = await pool.query<{ id: string }>(
      `
        INSERT INTO security_enforcement_actions (
          action_id,
          package_id,
          state,
          reason_code,
          source,
          active,
          created_at
        )
        VALUES (
          'appeal-action-seed',
          $1::uuid,
          'flagged',
          'needs_human_review',
          'security_governance',
          TRUE,
          '2026-02-25T10:00:00Z'::timestamptz
        )
        RETURNING id::text AS id
      `,
      [packageId]
    );

    const enforcementActionId = actionSeed.rows[0]?.id;
    if (!enforcementActionId) {
      throw new Error('failed_to_seed_enforcement_action');
    }

    await pool.query(
      `
        INSERT INTO security_appeals (
          enforcement_action_id,
          package_id,
          status,
          priority,
          opened_at,
          assigned_at,
          first_response_at,
          resolved_at,
          resolution,
          escalation_count,
          reviewer_id,
          reviewer_confirmed_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          'resolved',
          'critical',
          '2026-02-25T10:00:00Z'::timestamptz,
          '2026-02-25T10:15:00Z'::timestamptz,
          '2026-02-25T10:45:00Z'::timestamptz,
          '2026-02-25T11:00:00Z'::timestamptz,
          'upheld',
          0,
          'reviewer-1',
          '2026-02-25T10:30:00Z'::timestamptz
        )
      `,
      [enforcementActionId, packageId]
    );

    const service = createSecurityTrustGateDecisionService({
      metricsStore,
      rolloutStateStore,
      decisionStore,
      now: () => new Date('2026-02-28T12:00:00Z')
    });

    const result = await service.evaluate({
      run_id: 'trust-run-1',
      window_from: '2026-02-21T00:00:00Z',
      window_to: '2026-02-28T00:00:00Z',
      trigger: 'weekly'
    });

    expect(result.decision_type).toBe('promote');
    expect(result.decided_mode).toBe('flagged-first');
    expect(result.freeze_active).toBe(false);

    const state = await rolloutStateStore.getState();
    expect(state.current_mode).toBe('flagged-first');
    expect(state.freeze_active).toBe(false);
    expect(state.decision_run_id).toBe('trust-run-1');

    const persistedDecision = await pool.query<{
      decision_type: string;
      decided_mode: string;
      gate_false_positive_pass: boolean;
      gate_appeals_sla_pass: boolean;
      gate_backlog_pass: boolean;
    }>(
      `
        SELECT
          decision_type,
          decided_mode::text AS decided_mode,
          gate_false_positive_pass,
          gate_appeals_sla_pass,
          gate_backlog_pass
        FROM security_enforcement_promotion_decisions
        WHERE run_id = 'trust-run-1'
        LIMIT 1
      `
    );

    expect(persistedDecision.rows[0]).toMatchObject({
      decision_type: 'promote',
      decided_mode: 'flagged-first',
      gate_false_positive_pass: true,
      gate_appeals_sla_pass: true,
      gate_backlog_pass: true
    });
  });

  it('reads rollout state through resolver and forces raw-only when frozen', async () => {
    const rolloutStateStore = createPostgresSecurityRolloutStateStore({ db });

    await rolloutStateStore.updateState({
      current_mode: 'full-catalog',
      freeze_active: true,
      freeze_reason: 'manual_freeze',
      decision_run_id: 'manual',
      decision_evidence: {
        manual: true
      },
      updated_at: '2026-02-28T12:00:00Z'
    });

    const resolver = createSecurityRolloutModeResolver({
      rolloutStateStore
    });

    const resolution = await resolver.resolveProjection({
      projected_state: 'policy_blocked_temp',
      source_kind: 'curated'
    });

    expect(resolution.mode).toBe('raw-only');
    expect(resolution.state).toBe('flagged');
    expect(resolution.freeze_active).toBe(true);
  });
});
