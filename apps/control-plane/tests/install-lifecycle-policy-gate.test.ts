import { describe, expect, it } from 'vitest';
import {
  createInstallLifecycleService,
  type LifecycleIdempotencyAdapter,
  type PostgresQueryExecutor,
  type PostgresTransactionalQueryExecutor
} from '../src/install-lifecycle.js';
import type {
  CopilotAdapterContract,
  CopilotScopeDescriptor,
  CopilotServerEntry
} from '@forge/copilot-vscode-adapter';
import type { PolicyPreflightInput, PolicyPreflightResult } from '@forge/policy-engine';
import type { RuntimePipelineResult, RuntimeStartRequest } from '@forge/runtime-daemon';

const PLAN_ID = 'plan-policy-gate-001';
const PLAN_INTERNAL_ID = '00000000-0000-4000-8000-00000000bb11';
const PACKAGE_ID = '11111111-1111-4111-8111-111111111111';

class PolicyGateFakeDb implements PostgresTransactionalQueryExecutor {
  public planStatus: 'planned' | 'apply_failed' | 'apply_succeeded' = 'planned';

  async withTransaction<T>(callback: (tx: PostgresQueryExecutor) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('FROM install_plans') && sql.includes('WHERE plan_id = $1')) {
      const requestedPlanId = params[0] as string;
      if (requestedPlanId !== PLAN_ID) {
        return { rows: [], rowCount: 0 };
      }

      return {
        rows: [
          {
            internal_id: PLAN_INTERNAL_ID,
            plan_id: PLAN_ID,
            package_id: PACKAGE_ID,
            package_slug: 'acme/policy-blocked-addon',
            target_client: 'vscode_copilot',
            target_mode: 'local',
            status: this.planStatus,
            reason_code: 'policy_preflight_blocked',
            policy_outcome: 'policy_blocked',
            policy_reason_code: 'org_policy_blocked',
            security_state: 'policy_blocked_perm',
            planner_version: 'planner-v1',
            plan_hash: 'hash-policy-gate',
            policy_input: {
              org_id: 'org-policy',
              package_id: PACKAGE_ID,
              requested_permissions: ['write:settings'],
              org_policy: {
                mcp_enabled: true,
                server_allowlist: [],
                block_flagged: true,
                permission_caps: {
                  maxPermissions: 1,
                  disallowedPermissions: ['write:settings']
                }
              },
              enforcement: {
                package_id: PACKAGE_ID,
                state: 'policy_blocked_perm',
                reason_code: 'org_policy_blocked',
                policy_blocked: true,
                source: 'org_policy',
                updated_at: '2026-03-01T12:00:00Z'
              }
            },
            runtime_context: {
              trust_state: 'policy_blocked',
              trust_reset_trigger: 'none',
              mode: 'local',
              transport: 'stdio'
            },
            correlation_id: 'corr-policy-gate-1',
            created_at: '2026-03-01T12:00:00Z',
            updated_at: '2026-03-01T12:00:00Z'
          } as Row
        ],
        rowCount: 1
      };
    }

    if (sql.includes('FROM install_plan_actions')) {
      return {
        rows: [
          {
            action_order: 0,
            action_type: 'write_entry',
            scope: 'workspace',
            scope_path: '/tmp/workspace.json',
            status: 'pending',
            reason_code: 'scope_writable_approved',
            payload: { note: 'blocked' },
            last_error: null
          } as Row
        ],
        rowCount: 1
      };
    }

    if (sql.includes('SELECT COALESCE(MAX(attempt_number), 0)::text AS max_attempt')) {
      return {
        rows: [{ max_attempt: '0' } as Row],
        rowCount: 1
      };
    }

    if (sql.includes('UPDATE install_plans')) {
      this.planStatus = params[1] as 'planned' | 'apply_failed' | 'apply_succeeded';
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (
      sql.includes('INSERT INTO install_apply_attempts') ||
      sql.includes('UPDATE install_plan_actions') ||
      sql.includes('INSERT INTO install_plan_audit')
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    return {
      rows: [],
      rowCount: 0
    };
  }
}

function createInMemoryIdempotency(): LifecycleIdempotencyAdapter {
  const records = new Map<string, { request_hash: string; response_body: unknown; stored_at: string }>();

  return {
    async get(scope, idempotencyKey) {
      const record = records.get(`${scope}:${idempotencyKey}`);
      if (!record) {
        return null;
      }

      return {
        scope,
        idempotency_key: idempotencyKey,
        request_hash: record.request_hash,
        response_code: 200,
        response_body: record.response_body,
        stored_at: record.stored_at
      };
    },
    async put(record) {
      records.set(`${record.scope}:${record.idempotency_key}`, {
        request_hash: record.request_hash,
        response_body: record.response_body,
        stored_at: record.stored_at
      });
    }
  };
}

class PolicyGateAdapterSpy implements CopilotAdapterContract {
  public writeCalls = 0;

  private readonly scopes: CopilotScopeDescriptor[] = [
    {
      scope: 'workspace',
      scope_path: '/tmp/workspace.json',
      writable: true,
      approved: true,
      daemon_owned: true
    }
  ];

  private readonly blockedPolicy: PolicyPreflightResult = {
    outcome: 'policy_blocked',
    reason_code: 'org_policy_blocked',
    install_allowed: false,
    runtime_allowed: false,
    trust_transition: 'lockdown',
    warnings: []
  };

  async discover_scopes() {
    return this.scopes;
  }

  async read_entry() {
    return null;
  }

  async write_entry(_scope: CopilotScopeDescriptor, _entry: CopilotServerEntry) {
    this.writeCalls += 1;
  }

  async remove_entry() {
    return;
  }

  async policy_preflight(_input: PolicyPreflightInput) {
    return this.blockedPolicy;
  }

  lifecycle_hooks = {
    async on_before_write() {
      return;
    },
    async on_after_write() {
      return;
    },
    async on_lifecycle() {
      return;
    },
    async on_health_check() {
      return {
        healthy: true,
        details: []
      };
    }
  };

  remote_hooks = {};
}

function createRuntimeVerifierStub(): {
  run(request: RuntimeStartRequest): Promise<RuntimePipelineResult>;
} {
  return {
    async run(_request: RuntimeStartRequest) {
      return {
        ready: true,
        failure_reason_code: null,
        final_trust_state: 'trusted',
        policy: {
          outcome: 'allowed',
          reason_code: null,
          install_allowed: true,
          runtime_allowed: true,
          trust_transition: 'none',
          warnings: []
        },
        stages: []
      };
    }
  };
}

describe('install lifecycle policy gate enforcement', () => {
  it('fails closed on apply when policy outcome is blocked and does not write adapter entries', async () => {
    const db = new PolicyGateFakeDb();
    const adapter = new PolicyGateAdapterSpy();

    const service = createInstallLifecycleService({
      db,
      copilotAdapter: adapter,
      runtimeVerifier: createRuntimeVerifierStub(),
      idempotency: createInMemoryIdempotency(),
      now: () => new Date('2026-03-01T12:00:00Z')
    });

    const response = await service.applyPlan(PLAN_ID, 'idem-policy-blocked', 'corr-policy-blocked');

    expect(response).toMatchObject({
      status: 'apply_failed',
      replayed: false,
      plan_id: PLAN_ID,
      attempt_number: 1,
      reason_code: 'trust_gate_blocked',
      policy_decision: {
        outcome: 'policy_blocked',
        reason_code: 'org_policy_blocked',
        blocked: true,
        source: 'policy_preflight'
      }
    });

    expect(adapter.writeCalls).toBe(0);
    expect(db.planStatus).toBe('apply_failed');
  });
});
