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
  const planId = 'plan-wave7-001';
  const createdAt = '2026-03-01T12:00:00Z';
  const planCreateIdempotency = new Map<string, { requestHash: string; replayed: boolean }>();
  const applyIdempotency = new Map<string, true>();
  const verifyIdempotency = new Map<string, true>();
  const updateIdempotency = new Map<string, true>();
  const planState = {
    status: 'planned' as
      | 'planned'
      | 'apply_succeeded'
      | 'apply_failed'
      | 'verify_succeeded'
      | 'verify_failed',
    correlation_id: 'corr-wave7-e2e',
    apply_attempt: 0,
    verify_attempt: 0,
    update_attempt: 0
  };

  function createPlanRequestHash(input: {
    package_id: string;
    org_id: string;
    requested_permissions: string[];
  }): string {
    return [
      input.package_id,
      input.org_id,
      [...input.requested_permissions].sort().join(',')
    ].join('|');
  }

  return {
    async createPlan(
      input: {
        package_id: string;
        package_slug?: string;
        org_id: string;
        requested_permissions: string[];
      },
      idempotencyKey: string | null
    ) {
      if (!idempotencyKey) {
        throw new Error('idempotency_conflict');
      }

      const requestHash = createPlanRequestHash(input);
      const existing = planCreateIdempotency.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new Error('idempotency_conflict');
        }
        return {
          status: 'planned' as const,
          replayed: true,
          plan_id: planId,
          package_id: input.package_id,
          package_slug: input.package_slug ?? 'acme/forge-addon',
          policy_outcome: 'allowed' as const,
          policy_reason_code: null,
          security_state: 'none',
          action_count: 2
        };
      }

      planCreateIdempotency.set(idempotencyKey, { requestHash, replayed: false });
      return {
        status: 'planned' as const,
        replayed: false,
        plan_id: planId,
        package_id: input.package_id,
        package_slug: input.package_slug ?? 'acme/forge-addon',
        policy_outcome: 'allowed' as const,
        policy_reason_code: null,
        security_state: 'none',
        action_count: 2
      };
    },

    async getPlan(requestedPlanId: string) {
      if (requestedPlanId !== planId) {
        return null;
      }
      return {
        internal_id: 'internal-wave7-001',
        plan_id: planId,
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/forge-addon',
        target_client: 'vscode_copilot' as const,
        target_mode: 'local' as const,
        status: planState.status,
        reason_code: null,
        policy_outcome: 'allowed' as const,
        policy_reason_code: null,
        security_state: 'none',
        planner_version: 'planner-v1',
        plan_hash: 'hash-wave7-001',
        policy_input: {
          org_id: 'org-wave7',
          package_id: '11111111-1111-4111-8111-111111111111',
          requested_permissions: ['read:config'],
          org_policy: {
            mcp_enabled: true,
            server_allowlist: ['11111111-1111-4111-8111-111111111111'],
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
            updated_at: createdAt
          }
        },
        runtime_context: {
          trust_state: 'trusted' as const,
          trust_reset_trigger: 'none' as const,
          mode: 'local' as const,
          transport: 'stdio' as const
        },
        correlation_id: planState.correlation_id,
        created_at: createdAt,
        updated_at: createdAt,
        actions: [
          {
            action_order: 0,
            action_type: 'write_entry' as const,
            scope: 'workspace' as const,
            scope_path: '/tmp/workspace.json',
            status:
              planState.status === 'planned' ? 'pending' : 'applied',
            reason_code: 'scheduled',
            payload: {
              package_id: '11111111-1111-4111-8111-111111111111'
            },
            last_error: null
          },
          {
            action_order: 1,
            action_type: 'write_entry' as const,
            scope: 'user_profile' as const,
            scope_path: '/tmp/profile.json',
            status:
              planState.status === 'planned' ? 'pending' : 'applied',
            reason_code: 'scheduled',
            payload: {
              package_id: '11111111-1111-4111-8111-111111111111'
            },
            last_error: null
          }
        ]
      };
    },

    async applyPlan(
      requestedPlanId: string,
      idempotencyKey: string | null
    ) {
      if (requestedPlanId !== planId) {
        throw new Error('plan_not_found');
      }
      if (!idempotencyKey) {
        throw new Error('idempotency_conflict');
      }

      if (applyIdempotency.has(idempotencyKey)) {
        return {
          status: 'apply_succeeded' as const,
          replayed: true,
          plan_id: planId,
          attempt_number: planState.apply_attempt,
          reason_code: null
        };
      }

      planState.status = 'apply_succeeded';
      planState.apply_attempt += 1;
      applyIdempotency.set(idempotencyKey, true);

      return {
        status: 'apply_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: planState.apply_attempt,
        reason_code: null
      };
    },

    async updatePlan(
      requestedPlanId: string,
      idempotencyKey: string | null,
      _correlationId: string | null,
      targetVersion?: string | null
    ) {
      if (requestedPlanId !== planId) {
        throw new Error('plan_not_found');
      }
      if (!idempotencyKey) {
        throw new Error('idempotency_conflict');
      }

      if (updateIdempotency.has(idempotencyKey)) {
        return {
          status: 'update_succeeded' as const,
          replayed: true,
          plan_id: planId,
          attempt_number: planState.update_attempt,
          reason_code: null,
          target_version: targetVersion ?? null
        };
      }

      planState.status = 'apply_succeeded';
      planState.update_attempt += 1;
      updateIdempotency.set(idempotencyKey, true);

      return {
        status: 'update_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: planState.update_attempt,
        reason_code: null,
        target_version: targetVersion ?? null
      };
    },

    async verifyPlan(
      requestedPlanId: string,
      idempotencyKey: string | null
    ) {
      if (requestedPlanId !== planId) {
        throw new Error('plan_not_found');
      }
      if (!idempotencyKey) {
        throw new Error('idempotency_conflict');
      }

      if (verifyIdempotency.has(idempotencyKey)) {
        return {
          status: 'verify_succeeded' as const,
          replayed: true,
          plan_id: planId,
          attempt_number: planState.verify_attempt,
          readiness: true,
          reason_code: null,
          stages: [
            { stage: 'policy_preflight', ok: true, details: ['allowed'] },
            { stage: 'health_validate', ok: true, details: ['ready'] }
          ]
        };
      }

      planState.status = 'verify_succeeded';
      planState.verify_attempt += 1;
      verifyIdempotency.set(idempotencyKey, true);

      return {
        status: 'verify_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: planState.verify_attempt,
        readiness: true,
        reason_code: null,
        stages: [
          { stage: 'policy_preflight', ok: true, details: ['allowed'] },
          { stage: 'health_validate', ok: true, details: ['ready'] }
        ]
      };
    }
  };
}

describe('e2e local: discover -> plan -> install -> verify', () => {
  it('executes full flow with retrieval metadata assertions and idempotent replay', async () => {
    const lifecycle = buildLifecycleHarness();
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
      catalogRoutes: {
        async listPackages() {
          return [
            {
              package_id: '11111111-1111-4111-8111-111111111111',
              package_slug: 'acme/forge-addon',
              canonical_repo: 'github.com/acme/forge-addon',
              updated_at: '2026-03-01T00:00:00Z'
            }
          ];
        },
        async getPackage(packageId: string) {
          if (packageId !== '11111111-1111-4111-8111-111111111111') {
            return null;
          }
          return {
            package_id: packageId,
            package_slug: 'acme/forge-addon',
            canonical_repo: 'github.com/acme/forge-addon',
            updated_at: '2026-03-01T00:00:00Z',
            aliases: [],
            lineage_summary: []
          };
        },
        async searchPackages() {
          return {
            query: 'forge addon',
            semantic_fallback: false,
            results: [
              {
                package_id: '11111111-1111-4111-8111-111111111111',
                package_slug: 'acme/forge-addon',
                canonical_repo: 'github.com/acme/forge-addon',
                updated_at: '2026-03-01T00:00:00Z',
                score: 0.91,
                actions: {
                  view_on_github: {
                    label: 'View on GitHub',
                    href: 'https://github.com/acme/forge-addon'
                  },
                  open_in_vscode: {
                    label: 'Open in VS Code',
                    uri: 'vscode://forge.install?package_id=11111111-1111-4111-8111-111111111111&package_slug=acme%2Fforge-addon',
                    fallback: {
                      install_plan_path: '/v1/install/plans',
                      package_id: '11111111-1111-4111-8111-111111111111',
                      package_slug: 'acme/forge-addon'
                    }
                  }
                },
                ranking: {
                  ranking_model_version: 'ranking-v0-foundation',
                  embedding_model_version: 'text-embedding-3-large',
                  vector_collection_version: 'forge-packages-v1',
                  semantic_fallback: false,
                  deterministic_contract: 'fixed-weight-v0',
                  feature_gates: {
                    requireQueryRelevance: true,
                    enableBehavioralSignals: true,
                    enableColdStartPriorBlend: true,
                    minImpressionsForBehavioralSignals: 100
                  },
                  feature_availability: {
                    query_relevance: true,
                    freshness: true,
                    popularity: true,
                    ctr: false,
                    action_rate: false,
                    cold_start_prior: true
                  },
                  fallbacks_used: []
                }
              }
            ]
          };
        }
      },
      installLifecycle: lifecycle
    });

    const discoverSearch = await app.handle({
      method: 'POST',
      path: '/v1/packages/search',
      headers: {},
      body: {
        query: 'forge addon',
        limit: 10
      }
    });
    expect(discoverSearch.statusCode).toBe(200);
    const discoverBody = discoverSearch.body as {
      semantic_fallback: boolean;
      results: Array<{
        ranking: {
          embedding_model_version: string;
          vector_collection_version: string;
          semantic_fallback: boolean;
        };
      }>;
    };
    expect(discoverBody.semantic_fallback).toBe(false);
    expect(discoverBody.results[0]?.ranking.embedding_model_version).toBe(
      'text-embedding-3-large'
    );
    expect(discoverBody.results[0]?.ranking.vector_collection_version).toBe(
      'forge-packages-v1'
    );
    expect(discoverBody.results[0]?.ranking.semantic_fallback).toBe(false);

    const planCreate = await app.handle({
      method: 'POST',
      path: '/v1/install/plans',
      headers: {
        'idempotency-key': 'plan-wave7-idem-1',
        'x-correlation-id': 'corr-wave7-e2e'
      },
      body: {
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/forge-addon',
        org_id: 'org-wave7',
        requested_permissions: ['read:config'],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: ['11111111-1111-4111-8111-111111111111'],
          block_flagged: false,
          permission_caps: {
            maxPermissions: 5,
            disallowedPermissions: []
          }
        }
      }
    });
    expect(planCreate.statusCode).toBe(201);
    expect(planCreate.headers['x-idempotent-replay']).toBe('false');

    const planReplay = await app.handle({
      method: 'POST',
      path: '/v1/install/plans',
      headers: {
        'idempotency-key': 'plan-wave7-idem-1',
        'x-correlation-id': 'corr-wave7-e2e'
      },
      body: {
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/forge-addon',
        org_id: 'org-wave7',
        requested_permissions: ['read:config'],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: ['11111111-1111-4111-8111-111111111111'],
          block_flagged: false,
          permission_caps: {
            maxPermissions: 5,
            disallowedPermissions: []
          }
        }
      }
    });
    expect(planReplay.statusCode).toBe(201);
    expect(planReplay.headers['x-idempotent-replay']).toBe('true');

    const install = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-wave7-001/install',
      headers: {
        'idempotency-key': 'apply-wave7-idem-1'
      },
      body: null
    });
    expect(install.statusCode).toBe(200);
    expect((install.body as { status: string }).status).toBe('apply_succeeded');

    const verify = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-wave7-001/verify',
      headers: {
        'idempotency-key': 'verify-wave7-idem-1'
      },
      body: null
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.body as { status: string; readiness: boolean })).toMatchObject({
      status: 'verify_succeeded',
      readiness: true
    });

    const update = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-wave7-001/update',
      headers: {
        'idempotency-key': 'update-wave7-idem-1'
      },
      body: {
        target_version: '2.0.0'
      }
    });
    expect(update.statusCode).toBe(200);
    expect((update.body as { status: string; target_version: string | null })).toMatchObject({
      status: 'update_succeeded',
      target_version: '2.0.0'
    });

    const finalPlan = await app.handle({
      method: 'GET',
      path: '/v1/install/plans/plan-wave7-001',
      headers: {},
      body: null
    });
    expect(finalPlan.statusCode).toBe(200);
    expect((finalPlan.body as { status: string }).status).toBe('apply_succeeded');
  });
});
