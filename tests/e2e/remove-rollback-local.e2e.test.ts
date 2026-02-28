import { describe, expect, it } from 'vitest';
import {
  InMemoryReporterDirectory,
  InMemoryReporterNonceStore,
  InMemorySecurityReportStore
} from '@forge/security-governance';
import { createForgeHttpApp } from '../../apps/control-plane/src/http-app.js';
import type { IngestionResult } from '../../apps/control-plane/src/index.js';

function createInMemoryEventDependencies() {
  const idempotency = new Map<string, { hash: string; response: IngestionResult }>();

  return {
    idempotency: {
      async get(scope: string, idempotencyKey: string) {
        const entry = idempotency.get(`${scope}:${idempotencyKey}`);
        if (!entry) {
          return null;
        }

        return {
          scope,
          idempotency_key: idempotencyKey,
          request_hash: entry.hash,
          response_code: 202,
          response_body: entry.response,
          stored_at: '2026-03-01T12:00:00Z'
        };
      },
      async put(record: {
        scope: string;
        idempotency_key: string;
        request_hash: string;
        response_body: IngestionResult;
      }) {
        idempotency.set(`${record.scope}:${record.idempotency_key}`, {
          hash: record.request_hash,
          response: record.response_body
        });
      }
    },
    persistence: {
      async appendRawEvent() {
        return {
          raw_event_id: '00000000-0000-4000-8000-000000000001',
          persisted_at: '2026-03-01T12:00:00Z'
        };
      }
    }
  };
}

function buildLifecycleHarness() {
  const plans = new Map<
    string,
    {
      status:
        | 'planned'
        | 'apply_succeeded'
        | 'apply_failed'
        | 'verify_succeeded'
        | 'verify_failed'
        | 'remove_failed'
        | 'rollback_failed';
      remove_attempt: number;
      rollback_attempt: number;
      rollback_source: 'apply' | 'update' | 'remove' | 'rollback' | null;
    }
  >([
    [
      'plan-remove-ok',
      {
        status: 'apply_succeeded',
        remove_attempt: 0,
        rollback_attempt: 0,
        rollback_source: null
      }
    ],
    [
      'plan-rollback-ok',
      {
        status: 'remove_failed',
        remove_attempt: 0,
        rollback_attempt: 0,
        rollback_source: 'remove'
      }
    ],
    [
      'plan-invalid-state',
      {
        status: 'planned',
        remove_attempt: 0,
        rollback_attempt: 0,
        rollback_source: null
      }
    ],
    [
      'plan-missing-source',
      {
        status: 'apply_failed',
        remove_attempt: 0,
        rollback_attempt: 0,
        rollback_source: null
      }
    ]
  ]);

  const removeReplay = new Map<string, { planId: string }>();
  const rollbackReplay = new Map<string, { planId: string }>();

  return {
    async createPlan() {
      return {
        status: 'planned' as const,
        replayed: false,
        plan_id: 'plan-e2e-unused',
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/remove-addon',
        policy_outcome: 'allowed' as const,
        policy_reason_code: null,
        security_state: 'none',
        action_count: 1,
        policy_decision: {
          outcome: 'allowed' as const,
          reason_code: null,
          blocked: false,
          source: 'policy_preflight' as const
        }
      };
    },

    async getPlan(planId: string) {
      const state = plans.get(planId);
      if (!state) {
        return null;
      }

      return {
        internal_id: `internal-${planId}`,
        plan_id: planId,
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/remove-addon',
        target_client: 'vscode_copilot' as const,
        target_mode: 'local' as const,
        status: state.status,
        reason_code: null,
        policy_outcome: 'allowed' as const,
        policy_reason_code: null,
        security_state: 'none',
        planner_version: 'planner-v1',
        plan_hash: `hash-${planId}`,
        policy_input: {
          org_id: 'org-e2e',
          package_id: '11111111-1111-4111-8111-111111111111',
          requested_permissions: [],
          org_policy: {
            mcp_enabled: true,
            server_allowlist: [],
            block_flagged: false,
            permission_caps: {
              maxPermissions: 5,
              disallowedPermissions: []
            }
          },
          enforcement: {
            package_id: '11111111-1111-4111-8111-111111111111',
            state: 'none' as const,
            reason_code: null,
            policy_blocked: false,
            source: 'none' as const,
            updated_at: '2026-03-01T12:00:00Z'
          }
        },
        runtime_context: {
          trust_state: 'trusted' as const,
          trust_reset_trigger: 'none' as const,
          mode: 'local' as const,
          transport: 'stdio' as const
        },
        correlation_id: null,
        created_at: '2026-03-01T12:00:00Z',
        updated_at: '2026-03-01T12:00:00Z',
        actions: []
      };
    },

    async applyPlan(planId: string) {
      if (!plans.has(planId)) {
        throw new Error('plan_not_found');
      }
      return {
        status: 'apply_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: 1,
        reason_code: null,
        policy_decision: {
          outcome: 'allowed' as const,
          reason_code: null,
          blocked: false,
          source: 'policy_preflight' as const
        }
      };
    },

    async updatePlan(planId: string) {
      if (!plans.has(planId)) {
        throw new Error('plan_not_found');
      }
      return {
        status: 'update_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: 1,
        reason_code: null,
        target_version: null,
        policy_decision: {
          outcome: 'allowed' as const,
          reason_code: null,
          blocked: false,
          source: 'policy_preflight' as const
        }
      };
    },

    async removePlan(planId: string, idempotencyKey: string | null) {
      if (!plans.has(planId)) {
        throw new Error('plan_not_found');
      }

      if (idempotencyKey === 'conflict') {
        throw new Error('idempotency_conflict');
      }

      if (idempotencyKey) {
        const replay = removeReplay.get(idempotencyKey);
        if (replay?.planId === planId) {
          const state = plans.get(planId)!;
          return {
            status: 'remove_succeeded' as const,
            replayed: true,
            plan_id: planId,
            attempt_number: state.remove_attempt,
            reason_code: null,
            policy_decision: {
              outcome: 'allowed' as const,
              reason_code: null,
              blocked: false,
              source: 'policy_preflight' as const
            }
          };
        }
      }

      const state = plans.get(planId)!;
      if (state.status === 'planned') {
        throw new Error('remove_invalid_plan_state');
      }

      state.remove_attempt += 1;
      state.status = 'verify_failed';
      if (idempotencyKey) {
        removeReplay.set(idempotencyKey, { planId });
      }

      return {
        status: 'remove_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: state.remove_attempt,
        reason_code: null,
        policy_decision: {
          outcome: 'allowed' as const,
          reason_code: null,
          blocked: false,
          source: 'policy_preflight' as const
        }
      };
    },

    async rollbackPlan(planId: string, idempotencyKey: string | null) {
      if (!plans.has(planId)) {
        throw new Error('plan_not_found');
      }

      if (idempotencyKey === 'conflict') {
        throw new Error('idempotency_conflict');
      }

      if (idempotencyKey) {
        const replay = rollbackReplay.get(idempotencyKey);
        if (replay?.planId === planId) {
          const state = plans.get(planId)!;
          return {
            status: 'rollback_succeeded' as const,
            replayed: true,
            plan_id: planId,
            attempt_number: state.rollback_attempt,
            reason_code: null,
            rollback_mode: state.rollback_source === 'remove' ? 'restore_removed_entries' : 'cleanup_partial_install',
            source_operation: state.rollback_source ?? 'apply',
            policy_decision: {
              outcome: 'allowed' as const,
              reason_code: null,
              blocked: false,
              source: 'policy_preflight' as const
            }
          };
        }
      }

      const state = plans.get(planId)!;
      if (!['apply_failed', 'remove_failed', 'rollback_failed'].includes(state.status)) {
        throw new Error('rollback_invalid_plan_state');
      }

      if (!state.rollback_source) {
        throw new Error('rollback_source_attempt_missing');
      }

      state.rollback_attempt += 1;
      state.status = 'verify_failed';
      if (idempotencyKey) {
        rollbackReplay.set(idempotencyKey, { planId });
      }

      return {
        status: 'rollback_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: state.rollback_attempt,
        reason_code: null,
        rollback_mode:
          state.rollback_source === 'remove'
            ? ('restore_removed_entries' as const)
            : ('cleanup_partial_install' as const),
        source_operation: state.rollback_source,
        policy_decision: {
          outcome: 'allowed' as const,
          reason_code: null,
          blocked: false,
          source: 'policy_preflight' as const
        }
      };
    },

    async verifyPlan(planId: string) {
      if (!plans.has(planId)) {
        throw new Error('plan_not_found');
      }

      return {
        status: 'verify_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: 1,
        readiness: true,
        reason_code: null,
        stages: [{ stage: 'policy_preflight' as const, ok: true, details: ['allowed'] }],
        policy_decision: {
          outcome: 'allowed' as const,
          reason_code: null,
          blocked: false,
          source: 'runtime_preflight' as const
        }
      };
    }
  };
}

describe('e2e local: remove and rollback lifecycle routes', () => {
  it('supports remove happy path with idempotent replay semantics', async () => {
    const app = createForgeHttpApp({
      eventIngestion: createInMemoryEventDependencies(),
      securityIngestion: {
        reporters: new InMemoryReporterDirectory({}),
        nonceStore: new InMemoryReporterNonceStore(),
        persistence: new InMemorySecurityReportStore(),
        signatureVerifier: {
          async verify() {
            return true;
          }
        }
      },
      installLifecycle: buildLifecycleHarness()
    });

    const first = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-remove-ok/remove',
      headers: {
        'idempotency-key': 'idem-remove-1'
      },
      body: null
    });

    const replay = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-remove-ok/uninstall',
      headers: {
        'idempotency-key': 'idem-remove-1'
      },
      body: null
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(first.headers['x-idempotent-replay']).toBe('false');
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect((first.body as { status: string }).status).toBe('remove_succeeded');
  });

  it('supports rollback happy path with restore mode and replay semantics', async () => {
    const app = createForgeHttpApp({
      eventIngestion: createInMemoryEventDependencies(),
      securityIngestion: {
        reporters: new InMemoryReporterDirectory({}),
        nonceStore: new InMemoryReporterNonceStore(),
        persistence: new InMemorySecurityReportStore(),
        signatureVerifier: {
          async verify() {
            return true;
          }
        }
      },
      installLifecycle: buildLifecycleHarness()
    });

    const first = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-rollback-ok/rollback',
      headers: {
        'idempotency-key': 'idem-rollback-1'
      },
      body: null
    });

    const replay = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-rollback-ok/rollback',
      headers: {
        'idempotency-key': 'idem-rollback-1'
      },
      body: null
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect((first.body as { rollback_mode: string }).rollback_mode).toBe('restore_removed_entries');
    expect((replay.body as { replayed: boolean }).replayed).toBe(true);
  });

  it('returns deterministic invalid-state/conflict errors for remove and rollback', async () => {
    const app = createForgeHttpApp({
      eventIngestion: createInMemoryEventDependencies(),
      securityIngestion: {
        reporters: new InMemoryReporterDirectory({}),
        nonceStore: new InMemoryReporterNonceStore(),
        persistence: new InMemorySecurityReportStore(),
        signatureVerifier: {
          async verify() {
            return true;
          }
        }
      },
      installLifecycle: buildLifecycleHarness()
    });

    const removeInvalid = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-invalid-state/remove',
      headers: {},
      body: null
    });
    const removeConflict = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-remove-ok/remove',
      headers: {
        'idempotency-key': 'conflict'
      },
      body: null
    });

    const rollbackInvalid = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-invalid-state/rollback',
      headers: {},
      body: null
    });
    const rollbackMissingSource = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-missing-source/rollback',
      headers: {},
      body: null
    });
    const rollbackConflict = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-rollback-ok/rollback',
      headers: {
        'idempotency-key': 'conflict'
      },
      body: null
    });

    expect(removeInvalid.statusCode).toBe(422);
    expect((removeInvalid.body as { reason: string }).reason).toBe('remove_invalid_plan_state');
    expect(removeConflict.statusCode).toBe(409);
    expect((removeConflict.body as { reason: string }).reason).toBe(
      'idempotency_key_reused_with_different_payload'
    );

    expect(rollbackInvalid.statusCode).toBe(422);
    expect((rollbackInvalid.body as { reason: string }).reason).toBe('rollback_invalid_plan_state');
    expect(rollbackMissingSource.statusCode).toBe(409);
    expect((rollbackMissingSource.body as { reason: string }).reason).toBe(
      'rollback_source_attempt_missing'
    );
    expect(rollbackConflict.statusCode).toBe(409);
    expect((rollbackConflict.body as { reason: string }).reason).toBe(
      'idempotency_key_reused_with_different_payload'
    );
  });
});
