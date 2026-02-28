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

const PLAN_ID = 'plan-remove-rollback-001';
const PLAN_INTERNAL_ID = '00000000-0000-4000-8000-00000000aa11';
const PACKAGE_ID = '11111111-1111-4111-8111-111111111111';

type PlanStatus =
  | 'planned'
  | 'apply_succeeded'
  | 'apply_failed'
  | 'verify_succeeded'
  | 'verify_failed'
  | 'remove_succeeded'
  | 'remove_failed'
  | 'rollback_succeeded'
  | 'rollback_failed';

class RemoveRollbackFakeDb implements PostgresTransactionalQueryExecutor {
  public planStatus: PlanStatus;
  public requiredProfileReferences: number;

  public readonly applyAttempts: Array<{
    attempt_number: number;
    status: 'succeeded' | 'failed' | 'replayed';
    reason_code: string | null;
    details: Record<string, unknown>;
  }> = [];

  public readonly auditStages: Array<'plan' | 'apply' | 'verify' | 'remove' | 'rollback'> = [];

  constructor(initialStatus: PlanStatus = 'apply_succeeded', requiredProfileReferences = 0) {
    this.planStatus = initialStatus;
    this.requiredProfileReferences = requiredProfileReferences;
  }

  seedFailedAttempt(operation: 'apply' | 'update' | 'remove' | 'rollback') {
    this.applyAttempts.push({
      attempt_number: this.applyAttempts.length + 1,
      status: 'failed',
      reason_code: `${operation}_failed_seed`,
      details: {
        operation,
        correlation_id: 'seed-correlation'
      }
    });
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
            package_slug: 'acme/remove-addon',
            target_client: 'vscode_copilot',
            target_mode: 'local',
            status: this.planStatus,
            reason_code: null,
            policy_outcome: 'allowed',
            policy_reason_code: null,
            security_state: 'none',
            planner_version: 'planner-v1',
            plan_hash: 'hash-remove-001',
            policy_input: {
              org_id: 'org-remove',
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
            correlation_id: 'corr-remove-001',
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
            payload: { note: 'action-0' },
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

    if (sql.includes('FROM profile_packages') && sql.includes('required_count')) {
      return {
        rows: [
          {
            required_count: String(this.requiredProfileReferences)
          } as Row
        ],
        rowCount: 1
      };
    }

    if (
      sql.includes('FROM install_apply_attempts') &&
      sql.includes('ORDER BY attempt_number DESC') &&
      sql.includes('LIMIT 1')
    ) {
      const latest = this.applyAttempts[this.applyAttempts.length - 1];
      if (!latest) {
        return { rows: [], rowCount: 0 };
      }

      return {
        rows: [
          {
            attempt_number: latest.attempt_number,
            status: latest.status,
            reason_code: latest.reason_code,
            details: latest.details
          } as Row
        ],
        rowCount: 1
      };
    }

    if (sql.includes('SELECT COALESCE(MAX(attempt_number), 0)::text AS max_attempt')) {
      return {
        rows: [{ max_attempt: String(this.applyAttempts.length) } as Row],
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
      this.planStatus = params[1] as PlanStatus;
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('UPDATE install_plan_actions')) {
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

class CopilotAdapterSpy implements CopilotAdapterContract {
  public readonly writeCalls: Array<{ scope: string; package_id: string }> = [];
  public readonly removeCalls: Array<{ scope: string; package_id: string }> = [];

  private readonly scopes: CopilotScopeDescriptor[] = [
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

  private readonly allowedPolicy: PolicyPreflightResult = {
    outcome: 'allowed',
    reason_code: null,
    install_allowed: true,
    runtime_allowed: true,
    trust_transition: 'none',
    warnings: []
  };

  async discover_scopes() {
    return this.scopes;
  }

  async read_entry() {
    return null;
  }

  async write_entry(scope: CopilotScopeDescriptor, entry: CopilotServerEntry) {
    this.writeCalls.push({
      scope: scope.scope,
      package_id: entry.package_id
    });
  }

  async remove_entry(scope: CopilotScopeDescriptor, packageId: string) {
    this.removeCalls.push({
      scope: scope.scope,
      package_id: packageId
    });
  }

  async policy_preflight(_input: PolicyPreflightInput) {
    return this.allowedPolicy;
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

function createService(db: RemoveRollbackFakeDb, adapter: CopilotAdapterSpy) {
  return createInstallLifecycleService({
    db,
    copilotAdapter: adapter,
    runtimeVerifier: createRuntimeVerifierStub(),
    idempotency: createInMemoryIdempotency(),
    now: () => new Date('2026-03-01T12:00:00Z')
  });
}

describe('install lifecycle remove and rollback', () => {
  it('removes successfully and records remove attempt/audit metadata', async () => {
    const db = new RemoveRollbackFakeDb('apply_succeeded');
    const adapter = new CopilotAdapterSpy();
    const service = createService(db, adapter);

    const response = await service.removePlan(PLAN_ID, 'idem-remove-1', 'corr-remove-1');

    expect(response).toMatchObject({
      status: 'remove_succeeded',
      replayed: false,
      plan_id: PLAN_ID,
      attempt_number: 1,
      reason_code: null
    });

    expect(db.planStatus).toBe('remove_succeeded');
    expect(adapter.removeCalls).toHaveLength(1);
    expect(adapter.removeCalls[0]?.package_id).toBe(PACKAGE_ID);
    expect(db.applyAttempts).toHaveLength(1);
    expect(db.applyAttempts[0]?.details.operation).toBe('remove');
    expect(db.auditStages).toContain('remove');
  });

  it('blocks remove when dependency safety check detects required profile references', async () => {
    const db = new RemoveRollbackFakeDb('verify_succeeded', 2);
    const adapter = new CopilotAdapterSpy();
    const service = createService(db, adapter);

    await expect(service.removePlan(PLAN_ID, 'idem-remove-blocked', null)).rejects.toThrow(
      /remove_dependency_blocked/
    );

    expect(adapter.removeCalls).toHaveLength(0);
    expect(db.applyAttempts).toHaveLength(0);
  });

  it('replays remove when idempotency key is reused with identical payload', async () => {
    const db = new RemoveRollbackFakeDb('verify_failed');
    const adapter = new CopilotAdapterSpy();
    const service = createService(db, adapter);

    const first = await service.removePlan(PLAN_ID, 'idem-remove-replay', null);
    const replay = await service.removePlan(PLAN_ID, 'idem-remove-replay', null);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe('remove_succeeded');
    expect(db.applyAttempts).toHaveLength(1);
  });

  it('rolls back failed update/apply by cleaning up partial install entries', async () => {
    const db = new RemoveRollbackFakeDb('apply_failed');
    db.seedFailedAttempt('update');
    const adapter = new CopilotAdapterSpy();
    const service = createService(db, adapter);

    const response = await service.rollbackPlan(PLAN_ID, 'idem-rollback-cleanup', 'corr-rb-1');

    expect(response).toMatchObject({
      status: 'rollback_succeeded',
      replayed: false,
      plan_id: PLAN_ID,
      attempt_number: 2,
      reason_code: null,
      rollback_mode: 'cleanup_partial_install',
      source_operation: 'update'
    });

    expect(db.planStatus).toBe('rollback_succeeded');
    expect(adapter.removeCalls).toHaveLength(1);
    expect(adapter.writeCalls).toHaveLength(0);
    expect(db.applyAttempts[1]?.details.operation).toBe('rollback');
    expect(db.applyAttempts[1]?.details.rollback_mode).toBe('cleanup_partial_install');
    expect(db.auditStages).toContain('rollback');
  });

  it('rolls back failed remove by restoring removed entries', async () => {
    const db = new RemoveRollbackFakeDb('remove_failed');
    db.seedFailedAttempt('remove');
    const adapter = new CopilotAdapterSpy();
    const service = createService(db, adapter);

    const response = await service.rollbackPlan(PLAN_ID, 'idem-rollback-restore', null);

    expect(response).toMatchObject({
      status: 'rollback_succeeded',
      replayed: false,
      plan_id: PLAN_ID,
      attempt_number: 2,
      reason_code: null,
      rollback_mode: 'restore_removed_entries',
      source_operation: 'remove'
    });

    expect(adapter.writeCalls).toHaveLength(1);
    expect(adapter.removeCalls).toHaveLength(0);
  });

  it('rejects rollback when plan state is invalid or source attempt is unavailable', async () => {
    const invalidStateDb = new RemoveRollbackFakeDb('planned');
    const invalidStateService = createService(invalidStateDb, new CopilotAdapterSpy());

    await expect(
      invalidStateService.rollbackPlan(PLAN_ID, 'idem-rollback-invalid-state', null)
    ).rejects.toThrow(/rollback_invalid_plan_state/);

    const missingSourceDb = new RemoveRollbackFakeDb('apply_failed');
    const missingSourceService = createService(missingSourceDb, new CopilotAdapterSpy());

    await expect(
      missingSourceService.rollbackPlan(PLAN_ID, 'idem-rollback-missing-source', null)
    ).rejects.toThrow(/rollback_source_attempt_missing/);
  });
});
