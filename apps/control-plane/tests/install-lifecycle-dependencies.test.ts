import { describe, expect, it } from 'vitest';
import {
  createInstallLifecycleService,
  type LifecycleIdempotencyAdapter,
  type PostgresQueryExecutor,
  type PostgresTransactionalQueryExecutor
} from '../src/install-lifecycle.js';
import type { CopilotAdapterContract, CopilotScopeDescriptor, CopilotServerEntry } from '@forge/copilot-vscode-adapter';
import type { PolicyPreflightInput, PolicyPreflightResult } from '@forge/policy-engine';
import type { RuntimePipelineResult, RuntimeStartRequest } from '@forge/runtime-daemon';

const ROOT_PACKAGE_ID = '11111111-1111-4111-8111-111111111111';
const DEP_A = '22222222-2222-4222-8222-222222222222';
const DEP_B = '33333333-3333-4333-8333-333333333333';

class CreatePlanFakeDb implements PostgresTransactionalQueryExecutor {
  private readonly installPlanInternalId = '00000000-0000-4000-8000-000000000001';

  async withTransaction<T>(callback: (tx: PostgresQueryExecutor) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('FROM registry.packages')) {
      const packageId = params[0] as string;
      if (packageId === ROOT_PACKAGE_ID) {
        return {
          rows: [
            {
              package_id: ROOT_PACKAGE_ID,
              package_slug: 'acme/root-addon'
            } as Row
          ],
          rowCount: 1
        };
      }

      return {
        rows: [],
        rowCount: 0
      };
    }

    if (sql.includes('FROM security_enforcement_projections')) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (sql.includes('INSERT INTO install_plans')) {
      return {
        rows: [
          {
            internal_id: this.installPlanInternalId
          } as Row
        ],
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO install_plan_actions')) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO install_plan_audit')) {
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
      scope: 'user_profile',
      scope_path: '/tmp/profile.json',
      writable: true,
      approved: true,
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
        stages: [
          {
            stage: 'policy_preflight',
            ok: true,
            details: ['allowed']
          }
        ]
      };
    }
  };
}

describe('install lifecycle dependency resolution', () => {
  it('adds deterministic dependency resolution summary to createPlan response', async () => {
    const service = createInstallLifecycleService({
      db: new CreatePlanFakeDb(),
      copilotAdapter: createTestCopilotAdapter(),
      runtimeVerifier: createRuntimeVerifierStub(),
      idempotency: createInMemoryIdempotency(),
      idFactory: () => 'plan-dep-test-001',
      now: () => new Date('2026-03-01T12:00:00Z')
    });

    const response = await service.createPlan(
      {
        package_id: ROOT_PACKAGE_ID,
        package_slug: 'acme/root-addon',
        org_id: 'org-dep-test',
        requested_permissions: [],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: [ROOT_PACKAGE_ID, DEP_A, DEP_B],
          block_flagged: false,
          permission_caps: {
            maxPermissions: 10,
            disallowedPermissions: []
          }
        },
        dependency_edges: [
          {
            from_package_id: ROOT_PACKAGE_ID,
            to_package_id: DEP_A,
            constraint: '^1.0.0',
            required: true
          },
          {
            from_package_id: DEP_A,
            to_package_id: DEP_B,
            constraint: '^2.0.0',
            required: true
          }
        ],
        known_package_ids: [ROOT_PACKAGE_ID, DEP_A, DEP_B]
      },
      'idem-dep-test-001'
    );

    expect(response.status).toBe('planned');
    expect(response.plan_id).toBe('plan-dep-test-001');
    expect(response.dependency_resolution).toBeDefined();
    expect(response.dependency_resolution?.resolved_order).toEqual([
      DEP_B,
      DEP_A,
      ROOT_PACKAGE_ID
    ]);
    expect(response.dependency_resolution?.resolved_count).toBe(3);
    expect(response.dependency_resolution?.conflicts).toEqual([]);
  });

  it('fails createPlan with deterministic taxonomy on cycle', async () => {
    const service = createInstallLifecycleService({
      db: new CreatePlanFakeDb(),
      copilotAdapter: createTestCopilotAdapter(),
      runtimeVerifier: createRuntimeVerifierStub(),
      idempotency: createInMemoryIdempotency(),
      idFactory: () => 'plan-dep-test-002',
      now: () => new Date('2026-03-01T12:00:00Z')
    });

    await expect(
      service.createPlan(
        {
          package_id: ROOT_PACKAGE_ID,
          org_id: 'org-dep-test',
          requested_permissions: [],
          org_policy: {
            mcp_enabled: true,
            server_allowlist: [ROOT_PACKAGE_ID, DEP_A],
            block_flagged: false,
            permission_caps: {
              maxPermissions: 10,
              disallowedPermissions: []
            }
          },
          dependency_edges: [
            {
              from_package_id: ROOT_PACKAGE_ID,
              to_package_id: DEP_A,
              constraint: '^1.0.0',
              required: true
            },
            {
              from_package_id: DEP_A,
              to_package_id: ROOT_PACKAGE_ID,
              constraint: '^1.0.0',
              required: true
            }
          ],
          known_package_ids: [ROOT_PACKAGE_ID, DEP_A]
        },
        'idem-dep-test-002'
      )
    ).rejects.toThrow(/dependency_resolution_failed:/);
  });
});
