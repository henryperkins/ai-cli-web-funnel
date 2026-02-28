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

const PLAN_ID = 'plan-verify-test-001';
const PLAN_INTERNAL_ID = '00000000-0000-4000-8000-00000000bb11';
const PACKAGE_ID = '11111111-1111-4111-8111-111111111111';

class VerifyPlanFakeDb implements PostgresTransactionalQueryExecutor {
  public planStatus:
    | 'planned'
    | 'apply_succeeded'
    | 'apply_failed'
    | 'verify_succeeded'
    | 'verify_failed';

  public readonly verifyAttempts: Array<{
    attempt_number: number;
    status: 'succeeded' | 'failed' | 'replayed';
    reason_code:
      | 'policy_preflight_blocked'
      | 'trust_gate_blocked'
      | 'preflight_checks_failed'
      | 'start_or_connect_failed'
      | 'remote_sse_hook_missing'
      | 'remote_streamable_http_hook_missing'
      | 'remote_sse_probe_failed'
      | 'remote_streamable_http_probe_failed'
      | 'health_validate_failed'
      | 'supervise_failed'
      | null;
    readiness: boolean;
    stage_outcomes: RuntimePipelineResult['stages'];
    details: Record<string, unknown>;
  }> = [];

  public readonly auditStages: Array<'plan' | 'apply' | 'verify' | 'remove' | 'rollback'> = [];

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
            package_slug: 'acme/verify-addon',
            target_client: 'vscode_copilot',
            target_mode: 'local',
            status: this.planStatus,
            reason_code: null,
            policy_outcome: 'allowed',
            policy_reason_code: null,
            security_state: 'none',
            planner_version: 'planner-v1',
            plan_hash: 'hash-verify-001',
            policy_input: {
              org_id: 'org-verify',
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
            correlation_id: 'corr-plan-verify-001',
            created_at: '2026-03-01T12:00:00Z',
            updated_at: '2026-03-01T12:00:00Z'
          } as Row
        ],
        rowCount: 1
      };
    }

    if (sql.includes('FROM install_plan_actions')) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (sql.includes('SELECT COALESCE(MAX(attempt_number), 0)::text AS max_attempt')) {
      const maxAttempt = this.verifyAttempts.length;
      return {
        rows: [{ max_attempt: String(maxAttempt) } as Row],
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO install_verify_attempts')) {
      this.verifyAttempts.push({
        attempt_number: params[1] as number,
        status: params[2] as 'succeeded' | 'failed' | 'replayed',
        reason_code: params[3] as
          | 'policy_preflight_blocked'
          | 'trust_gate_blocked'
          | 'preflight_checks_failed'
          | 'start_or_connect_failed'
          | 'remote_sse_hook_missing'
          | 'remote_streamable_http_hook_missing'
          | 'remote_sse_probe_failed'
          | 'remote_streamable_http_probe_failed'
          | 'health_validate_failed'
          | 'supervise_failed'
          | null,
        readiness: params[4] as boolean,
        stage_outcomes: JSON.parse(params[5] as string) as RuntimePipelineResult['stages'],
        details: JSON.parse(params[6] as string) as Record<string, unknown>
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

    if (sql.includes('INSERT INTO install_plan_audit')) {
      this.auditStages.push(params[1] as 'plan' | 'apply' | 'verify' | 'remove' | 'rollback');
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

class RuntimeVerifierSpy {
  public readonly requests: RuntimeStartRequest[] = [];

  constructor(private readonly result: RuntimePipelineResult) {}

  async run(request: RuntimeStartRequest): Promise<RuntimePipelineResult> {
    this.requests.push(request);
    return this.result;
  }

  async writeScopeSidecarGuarded() {
    return {
      ok: true,
      reason_code: null
    };
  }
}

function createService(db: VerifyPlanFakeDb, runtimeVerifier: RuntimeVerifierSpy) {
  return createInstallLifecycleService({
    db,
    copilotAdapter: createTestCopilotAdapter(),
    runtimeVerifier,
    idempotency: createInMemoryIdempotency(),
    now: () => new Date('2026-03-01T12:00:00Z')
  });
}

describe('install lifecycle verify', () => {
  it('persists verify stage outcomes/readiness and returns machine-readable failure reasons', async () => {
    const db = new VerifyPlanFakeDb('apply_succeeded');
    const runtimeVerifier = new RuntimeVerifierSpy({
      ready: false,
      failure_reason_code: 'health_validate_failed',
      final_trust_state: 'trusted',
      policy: {
        outcome: 'allowed',
        reason_code: null,
        install_allowed: true,
        runtime_allowed: true,
        trust_transition: 'none',
        warnings: []
      },
      scope_resolution: {
        ordered_writable_scopes: [],
        blocked_scopes: []
      },
      stages: [
        {
          stage: 'policy_preflight',
          ok: true,
          details: ['allowed']
        },
        {
          stage: 'health_validate',
          ok: false,
          details: ['connection refused']
        }
      ]
    });

    const service = createService(db, runtimeVerifier);

    const response = await service.verifyPlan(PLAN_ID, 'idem-verify-1', 'corr-verify-1');

    expect(response).toMatchObject({
      status: 'verify_failed',
      replayed: false,
      plan_id: PLAN_ID,
      attempt_number: 1,
      readiness: false,
      reason_code: 'health_validate_failed'
    });
    expect(response.stages).toHaveLength(2);
    expect(response.stages[1]).toMatchObject({
      stage: 'health_validate',
      ok: false
    });

    expect(db.verifyAttempts).toHaveLength(1);
    expect(db.verifyAttempts[0]).toMatchObject({
      attempt_number: 1,
      status: 'failed',
      reason_code: 'health_validate_failed',
      readiness: false
    });
    expect(db.verifyAttempts[0]?.stage_outcomes).toHaveLength(2);
    expect(db.planStatus).toBe('verify_failed');
    expect(db.auditStages).toContain('verify');
  });

  it('propagates explicit correlation and falls back to persisted plan correlation when absent', async () => {
    const db = new VerifyPlanFakeDb('apply_succeeded');
    const runtimeVerifier = new RuntimeVerifierSpy({
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
      scope_resolution: {
        ordered_writable_scopes: [],
        blocked_scopes: []
      },
      stages: [
        {
          stage: 'policy_preflight',
          ok: true,
          details: ['allowed']
        }
      ]
    });

    const service = createService(db, runtimeVerifier);

    await service.verifyPlan(PLAN_ID, 'idem-verify-corr-1', 'corr-explicit-verify');
    await service.verifyPlan(PLAN_ID, 'idem-verify-corr-2', null);

    expect(runtimeVerifier.requests[0]?.correlation_id).toBe('corr-explicit-verify');
    expect(runtimeVerifier.requests[1]?.correlation_id).toBe('corr-plan-verify-001');
  });

  it('replays verify when idempotency key is reused with same payload', async () => {
    const db = new VerifyPlanFakeDb('apply_succeeded');
    const runtimeVerifier = new RuntimeVerifierSpy({
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
      scope_resolution: {
        ordered_writable_scopes: [],
        blocked_scopes: []
      },
      stages: [
        {
          stage: 'policy_preflight',
          ok: true,
          details: ['allowed']
        }
      ]
    });

    const service = createService(db, runtimeVerifier);

    const first = await service.verifyPlan(PLAN_ID, 'idem-verify-replay', null);
    const replay = await service.verifyPlan(PLAN_ID, 'idem-verify-replay', null);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(db.verifyAttempts).toHaveLength(1);
    expect(runtimeVerifier.requests).toHaveLength(1);
  });
});