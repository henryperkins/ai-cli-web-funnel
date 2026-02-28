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

const PLAN_ID = 'plan-update-test-001';
const PLAN_INTERNAL_ID = '00000000-0000-4000-8000-000000000123';
const PACKAGE_ID = '11111111-1111-4111-8111-111111111111';

class UpdatePlanFakeDb implements PostgresTransactionalQueryExecutor {
  public planStatus:
    | 'planned'
    | 'apply_succeeded'
    | 'apply_failed'
    | 'verify_succeeded'
    | 'verify_failed';

  public readonly applyAttempts: Array<{
    attempt_number: number;
    status: 'succeeded' | 'failed' | 'replayed';
    reason_code: string | null;
    details: Record<string, unknown>;
  }> = [];

  constructor(
    initialStatus:
      | 'planned'
      | 'apply_succeeded'
      | 'apply_failed'
      | 'verify_succeeded'
      | 'verify_failed' = 'apply_succeeded'
  ) {
    this.planStatus = initialStatus;
  }

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
            package_slug: 'acme/update-addon',
            target_client: 'vscode_copilot',
            target_mode: 'local',
            status: this.planStatus,
            reason_code: null,
            policy_outcome: 'allowed',
            policy_reason_code: null,
            security_state: 'none',
            planner_version: 'planner-v1',
            plan_hash: 'hash-update-001',
            policy_input: {
              org_id: 'org-update',
              package_id: PACKAGE_ID,
              requested_permissions: [],
              org_policy: {
                mcp_enabled: true,
                server_allowlist: [PACKAGE_ID],
                block_flagged: false,
                permission_caps: {
                  maxPermissions: 5,
                  disallowedPermissions: []
                }
              },
              enforcement: {
                package_id: PACKAGE_ID,
                state: 'none',
                reason_code: null,
                policy_blocked: false,
                source: 'none',
                updated_at: '2026-03-01T12:00:00Z'
              }
            },
            runtime_context: {
              trust_state: 'trusted',
              trust_reset_trigger: 'none',
              mode: 'local',
              transport: 'stdio'
            },
            correlation_id: 'corr-update-001',
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
            reason_code: 'scheduled',
            payload: { note: 'update' },
            last_error: null
          } as Row,
          {
            action_order: 1,
            action_type: 'skip_scope',
            scope: 'daemon_default',
            scope_path: '/tmp/daemon.json',
            status: 'pending',
            reason_code: 'not_approved',
            payload: { note: 'skip' },
            last_error: null
          } as Row
        ],
        rowCount: 2
      };
    }

    if (sql.includes('SELECT COALESCE(MAX(attempt_number), 0)::text AS max_attempt')) {
      const maxAttempt = this.applyAttempts.length;
      return {
        rows: [{ max_attempt: String(maxAttempt) } as Row],
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO install_apply_attempts')) {
      this.applyAttempts.push({
        attempt_number: params[1] as number,
        status: params[2] as 'succeeded' | 'failed' | 'replayed',
        reason_code: params[3] as string | null,
        details: JSON.parse(params[4] as string) as Record<string, unknown>
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('UPDATE install_plans')) {
      this.planStatus = params[1] as
        | 'planned'
        | 'apply_succeeded'
        | 'apply_failed'
        | 'verify_succeeded'
        | 'verify_failed';
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('UPDATE install_plan_actions')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO install_plan_audit')) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

function createInMemoryIdempotency(): LifecycleIdempotencyAdapter {
  const records = new Map<
    string,
    {
      request_hash: string;
      response_body: unknown;
      stored_at: string;
    }
  >();

  return {
    async get(scope, idempotencyKey) {
      const key = `${scope}:${idempotencyKey}`;
      const record = records.get(key);
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
      const key = `${record.scope}:${record.idempotency_key}`;
      const existing = records.get(key);
      if (existing && existing.request_hash !== record.request_hash) {
        throw new Error('idempotency_conflict');
      }

      records.set(key, {
        request_hash: record.request_hash,
        response_body: record.response_body,
        stored_at: record.stored_at
      });
    }
  };
}

function createTestCopilotAdapter(): CopilotAdapterContract {
  const scopes: CopilotScopeDescriptor[] = [
    {
      scope: 'workspace',
      scope_path: '/tmp/workspace.json',
      writable: true,
      approved: true,
      daemon_owned: true
    },
    {
      scope: 'daemon_default',
      scope_path: '/tmp/daemon.json',
      writable: false,
      approved: false,
      daemon_owned: true
    }
  ];

  const allowedPolicy: PolicyPreflightResult = {
    outcome: 'allowed',
    reason_code: null,
    install_allowed: true,
    runtime_allowed: true,
    trust_transition: 'none',
    warnings: []
  };

  return {
    async discover_scopes() {
      return scopes;
    },
    async read_entry() {
      return null;
    },
    async write_entry(_scope: CopilotScopeDescriptor, _entry: CopilotServerEntry) {
      return;
    },
    async remove_entry() {
      return;
    },
    async policy_preflight(_input: PolicyPreflightInput) {
      return allowedPolicy;
    },
    lifecycle_hooks: {
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
    },
    remote_hooks: {}
  };
}

function createRuntimeVerifierStub(): {
  run(request: RuntimeStartRequest): Promise<RuntimePipelineResult>;
  writeScopeSidecarGuarded(request: {
    scope_hash: string;
    scope_daemon_owned: boolean;
    record: {
      package_id: string;
      package_slug: string;
      plan_id: string;
      applied_at: string;
      scope: string;
      scope_path: string;
    };
  }): Promise<{ ok: boolean; reason_code: string | null }>;
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
    },
    async writeScopeSidecarGuarded() {
      return {
        ok: true,
        reason_code: null
      };
    }
  };
}

function createService(db: UpdatePlanFakeDb) {
  return createInstallLifecycleService({
    db,
    copilotAdapter: createTestCopilotAdapter(),
    runtimeVerifier: createRuntimeVerifierStub(),
    idempotency: createInMemoryIdempotency(),
    now: () => new Date('2026-03-01T12:00:00Z')
  });
}

describe('install lifecycle update prototype', () => {
  it('updates successfully and records prototype details', async () => {
    const db = new UpdatePlanFakeDb('apply_succeeded');
    const service = createService(db);

    const response = await service.updatePlan(
      PLAN_ID,
      'idem-update-1',
      'corr-update-1',
      '2.0.0'
    );

    expect(response).toMatchObject({
      status: 'update_succeeded',
      replayed: false,
      plan_id: PLAN_ID,
      attempt_number: 1,
      reason_code: null,
      target_version: '2.0.0'
    });

    expect(db.planStatus).toBe('apply_succeeded');
    expect(db.applyAttempts).toHaveLength(1);
    expect(db.applyAttempts[0]?.status).toBe('succeeded');
    expect(db.applyAttempts[0]?.details.operation).toBe('update');
    expect(db.applyAttempts[0]?.details.target_version).toBe('2.0.0');
  });

  it('replays update when idempotency key and payload match', async () => {
    const db = new UpdatePlanFakeDb('verify_succeeded');
    const service = createService(db);

    const first = await service.updatePlan(PLAN_ID, 'idem-update-replay', null, '2.1.0');
    const replay = await service.updatePlan(PLAN_ID, 'idem-update-replay', null, '2.1.0');

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe('update_succeeded');
    expect(replay.target_version).toBe('2.1.0');
  });

  it('rejects idempotency key reuse with different payload hash', async () => {
    const db = new UpdatePlanFakeDb('verify_succeeded');
    const service = createService(db);

    await service.updatePlan(PLAN_ID, 'idem-update-conflict', null, '2.2.0');

    await expect(
      service.updatePlan(PLAN_ID, 'idem-update-conflict', null, '2.3.0')
    ).rejects.toThrow(/idempotency_conflict/);
  });

  it('rejects update when plan is in invalid state', async () => {
    const db = new UpdatePlanFakeDb('planned');
    const service = createService(db);

    await expect(
      service.updatePlan(PLAN_ID, 'idem-update-invalid-state', null, '2.0.0')
    ).rejects.toThrow(/update_invalid_plan_state/);
  });
});
