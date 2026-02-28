import { describe, expect, it } from 'vitest';
import {
  InMemoryReporterDirectory,
  InMemoryReporterNonceStore,
  InMemorySecurityEnforcementStore,
  InMemorySecurityReportStore,
  computeBodySha256Hex
} from '@forge/security-governance';
import {
  createForgeHttpApp,
  createForgeHttpAppFromPostgres
} from '../src/http-app.js';
import type { IngestionResult } from '../src/index.js';
import type { PostgresQueryExecutor } from '../src/postgres-adapters.js';

function buildEventBody() {
  return {
    schema_version: '1.0.0',
    event_id: '91cf6a57-8de1-4d7c-9072-6f102571f8e1',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T12:00:00Z',
    event_received_at: '2026-02-27T12:00:01Z',
    idempotency_key: 'idem-http-app-001',
    request_id: '74e9f743-965f-4fb4-a04a-7eb4e2d27d25',
    session_id: '6f797f2b-6d11-4a00-a7a8-cef85cf4df4f',
    actor: {
      actor_id: 'anon:integration',
      actor_type: 'anonymous'
    },
    privacy: {
      consent_state: 'granted',
      region: 'US'
    },
    client: {
      app: 'web',
      app_version: '0.1.0',
      user_agent_family: 'chromium',
      device_class: 'desktop',
      referrer_domain: null
    },
    payload: {
      package_id: '0fdf06a7-7e72-4f6b-a7ea-5bc8b8bf40f5',
      action: 'copy_install',
      is_promoted: false,
      command_template_id: 'tmpl-intg'
    }
  } as const;
}

function buildSecurityPayload() {
  return {
    package_id: '5d602d87-33d8-4a09-9d16-5f7486e0e4e7',
    severity: 'critical' as const,
    source_kind: 'raw' as const,
    summary: 'critical malware evidence',
    evidence: [
      {
        kind: 'sha256',
        value: 'payload-signature'
      }
    ],
    metadata: {
      scenario: 'http-app'
    }
  };
}

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
          stored_at: '2026-02-27T12:00:01Z'
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
          persisted_at: '2026-02-27T12:00:01Z'
        };
      }
    }
  };
}

class MinimalNoopDb implements PostgresQueryExecutor {
  async query<Row = Record<string, unknown>>(): Promise<{
    rows: Row[];
    rowCount: number | null;
  }> {
    return {
      rows: [],
      rowCount: 0
    };
  }
}

describe('forge http app composition', () => {
  it('routes /v1/events and preserves route-level headers for replay status', async () => {
    const app = createForgeHttpApp({
      eventIngestion: createInMemoryEventDependencies(),
      securityIngestion: {
        reporters: new InMemoryReporterDirectory({
          'reporter-a': {
            reporter_id: 'reporter-a',
            reporter_tier: 'A',
            reporter_status: 'active'
          }
        }),
        nonceStore: new InMemoryReporterNonceStore(),
        persistence: new InMemorySecurityReportStore(),
        projectionStore: new InMemorySecurityEnforcementStore(),
        signatureVerifier: {
          async verify() {
            return true;
          }
        }
      }
    });

    const first = await app.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEventBody(),
      received_at: '2026-02-27T12:00:01Z'
    });
    const replay = await app.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEventBody(),
      received_at: '2026-02-27T12:00:01Z'
    });

    expect(first.statusCode).toBe(202);
    expect(first.headers['x-idempotent-replay']).toBe('false');
    expect(replay.statusCode).toBe(202);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
  });

  it('routes /v1/security/reports and preserves security status headers', async () => {
    const payload = buildSecurityPayload();
    const app = createForgeHttpApp({
      eventIngestion: createInMemoryEventDependencies(),
      securityIngestion: {
        reporters: new InMemoryReporterDirectory({
          'reporter-a': {
            reporter_id: 'reporter-a',
            reporter_tier: 'A',
            reporter_status: 'active'
          }
        }),
        nonceStore: new InMemoryReporterNonceStore(),
        persistence: new InMemorySecurityReportStore(),
        projectionStore: new InMemorySecurityEnforcementStore(),
        signatureVerifier: {
          async verify() {
            return true;
          }
        },
        idFactory: () => 'report-http-app-1'
      },
      securityOptions: {
        now: () => new Date('2026-02-27T12:00:00Z')
      }
    });

    const response = await app.handle({
      method: 'POST',
      path: '/v1/security/reports',
      received_at: '2026-02-27T12:00:00Z',
      headers: {
        'x-reporter-id': 'reporter-a',
        'x-key-id': 'key-a',
        'x-timestamp': '2026-02-27T12:00:00Z',
        'x-nonce': 'nonce-http-app-1',
        'x-body-sha256': computeBodySha256Hex(payload),
        'x-signature': 'sig-valid'
      },
      body: payload
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers['x-security-report-status']).toBe('accepted');
  });

  it('serves health/readiness endpoints and 404 for unknown routes', async () => {
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
      readinessProbe: async () => ({
        ok: false,
        details: ['db_not_ready']
      })
    });

    const health = await app.handle({
      method: 'GET',
      path: '/healthz',
      headers: {},
      body: null
    });
    const readiness = await app.handle({
      method: 'GET',
      path: '/readyz',
      headers: {},
      body: null
    });
    const missing = await app.handle({
      method: 'GET',
      path: '/not-a-route',
      headers: {},
      body: null
    });

    expect(health.statusCode).toBe(200);
    expect((health.body as { status: string }).status).toBe('ok');
    expect(readiness.statusCode).toBe(503);
    expect((readiness.body as { status: string }).status).toBe('not_ready');
    expect(missing.statusCode).toBe(404);
  });

  it('supports postgres/query-executor and signature verifier injection for app composition', async () => {
    const app = createForgeHttpAppFromPostgres({
      db: new MinimalNoopDb(),
      signatureVerifier: {
        async verify() {
          return true;
        }
      }
    });

    const health = await app.handle({
      method: 'GET',
      path: '/health',
      headers: {},
      body: null
    });

    expect(health.statusCode).toBe(200);
  });

  it('serves catalog list/detail/search routes with deterministic status handling', async () => {
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
              package_slug: 'acme/catalog-addon',
              canonical_repo: 'github.com/acme/catalog-addon',
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
            package_slug: 'acme/catalog-addon',
            canonical_repo: 'github.com/acme/catalog-addon',
            updated_at: '2026-03-01T00:00:00Z',
            aliases: [],
            lineage_summary: []
          };
        },
        async searchPackages() {
          return {
            query: 'catalog',
            semantic_fallback: false,
            results: [
              {
                package_id: '11111111-1111-4111-8111-111111111111',
                package_slug: 'acme/catalog-addon',
                canonical_repo: 'github.com/acme/catalog-addon',
                updated_at: '2026-03-01T00:00:00Z',
                score: 0.91,
                actions: {
                  view_on_github: {
                    label: 'View on GitHub',
                    href: 'https://github.com/acme/catalog-addon'
                  },
                  open_in_vscode: {
                    label: 'Open in VS Code',
                    uri: 'vscode://forge.install?package_id=11111111-1111-4111-8111-111111111111&package_slug=acme%2Fcatalog-addon',
                    fallback: {
                      install_plan_path: '/v1/install/plans',
                      package_id: '11111111-1111-4111-8111-111111111111',
                      package_slug: 'acme/catalog-addon'
                    }
                  }
                },
                ranking: {
                  ranking_model_version: 'ranking-v0-foundation',
                  embedding_model_version: 'test',
                  vector_collection_version: 'test',
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
      }
    });

    const list = await app.handle({
      method: 'GET',
      path: '/v1/packages',
      headers: {},
      body: null
    });
    const detail = await app.handle({
      method: 'GET',
      path: '/v1/packages/11111111-1111-4111-8111-111111111111',
      headers: {},
      body: null
    });
    const missing = await app.handle({
      method: 'GET',
      path: '/v1/packages/22222222-2222-4222-8222-222222222222',
      headers: {},
      body: null
    });
    const searchInvalid = await app.handle({
      method: 'POST',
      path: '/v1/packages/search',
      headers: {},
      body: {}
    });
    const search = await app.handle({
      method: 'POST',
      path: '/v1/packages/search',
      headers: {},
      body: {
        query: 'catalog'
      }
    });

    expect(list.statusCode).toBe(200);
    expect((list.body as { packages: unknown[] }).packages).toHaveLength(1);
    expect(detail.statusCode).toBe(200);
    expect((detail.body as { package_id: string }).package_id).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(missing.statusCode).toBe(404);
    expect(searchInvalid.statusCode).toBe(422);
    expect(search.statusCode).toBe(200);
    expect((search.body as { semantic_fallback: boolean }).semantic_fallback).toBe(false);
  });

  it('serves install lifecycle plan/apply/verify routes with replay/conflict semantics', async () => {
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
      installLifecycle: {
        async createPlan(_request, idempotencyKey) {
          if (idempotencyKey === 'conflict') {
            throw new Error('idempotency_conflict');
          }

          return {
            status: 'planned',
            replayed: idempotencyKey === 'replay',
            plan_id: 'plan-http-1',
            package_id: '11111111-1111-4111-8111-111111111111',
            package_slug: 'acme/catalog-addon',
            policy_outcome: 'allowed',
            policy_reason_code: null,
            security_state: 'none',
            action_count: 2
          };
        },
        async getPlan(planId) {
          if (planId === 'missing') {
            return null;
          }

          return {
            internal_id: 'internal-1',
            plan_id: planId,
            package_id: '11111111-1111-4111-8111-111111111111',
            package_slug: 'acme/catalog-addon',
            target_client: 'vscode_copilot',
            target_mode: 'local',
            status: 'planned',
            reason_code: null,
            policy_outcome: 'allowed',
            policy_reason_code: null,
            security_state: 'none',
            planner_version: 'planner-v1',
            plan_hash: 'hash',
            policy_input: {
              org_id: 'org',
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
                state: 'none',
                reason_code: null,
                policy_blocked: false,
                source: 'none',
                updated_at: '2026-03-01T00:00:00Z'
              }
            },
            runtime_context: {
              trust_state: 'trusted',
              trust_reset_trigger: 'none',
              mode: 'local',
              transport: 'stdio'
            },
            correlation_id: null,
            created_at: '2026-03-01T00:00:00Z',
            updated_at: '2026-03-01T00:00:00Z',
            actions: []
          };
        },
        async applyPlan(planId, idempotencyKey) {
          if (planId === 'missing') {
            throw new Error('plan_not_found');
          }
          if (idempotencyKey === 'conflict') {
            throw new Error('idempotency_conflict');
          }

          return {
            status: 'apply_succeeded',
            replayed: idempotencyKey === 'replay',
            plan_id: planId,
            attempt_number: 1,
            reason_code: null
          };
        },
        async verifyPlan(planId, idempotencyKey) {
          if (planId === 'missing') {
            throw new Error('plan_not_found');
          }
          if (idempotencyKey === 'conflict') {
            throw new Error('idempotency_conflict');
          }

          return {
            status: 'verify_succeeded',
            replayed: idempotencyKey === 'replay',
            plan_id: planId,
            attempt_number: 1,
            readiness: true,
            reason_code: null,
            stages: [
              {
                stage: 'policy_preflight',
                ok: true,
                details: ['allowed']
              }
            ]
          };
        }
      }
    });

    const invalidCreate = await app.handle({
      method: 'POST',
      path: '/v1/install/plans',
      headers: {},
      body: {}
    });
    const created = await app.handle({
      method: 'POST',
      path: '/v1/install/plans',
      headers: {
        'idempotency-key': 'new-key'
      },
      body: {
        package_id: '11111111-1111-4111-8111-111111111111',
        org_id: 'org-1',
        requested_permissions: [],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: [],
          block_flagged: false,
          permission_caps: {
            maxPermissions: 5,
            disallowedPermissions: []
          }
        }
      }
    });
    const createConflict = await app.handle({
      method: 'POST',
      path: '/v1/install/plans',
      headers: {
        'idempotency-key': 'conflict'
      },
      body: {
        package_id: '11111111-1111-4111-8111-111111111111',
        org_id: 'org-1',
        requested_permissions: [],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: [],
          block_flagged: false,
          permission_caps: {
            maxPermissions: 5,
            disallowedPermissions: []
          }
        }
      }
    });
    const getPlan = await app.handle({
      method: 'GET',
      path: '/v1/install/plans/plan-http-1',
      headers: {},
      body: null
    });
    const applyReplay = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-http-1/apply',
      headers: {
        'idempotency-key': 'replay'
      },
      body: null
    });
    const installReplay = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-http-1/install',
      headers: {
        'idempotency-key': 'replay'
      },
      body: null
    });
    const applyMissing = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/missing/apply',
      headers: {},
      body: null
    });
    const verifyReplay = await app.handle({
      method: 'POST',
      path: '/v1/install/plans/plan-http-1/verify',
      headers: {
        'idempotency-key': 'replay'
      },
      body: null
    });

    expect(invalidCreate.statusCode).toBe(422);
    expect(created.statusCode).toBe(201);
    expect(created.headers['x-idempotent-replay']).toBe('false');
    expect(createConflict.statusCode).toBe(409);
    expect(getPlan.statusCode).toBe(200);
    expect(applyReplay.statusCode).toBe(200);
    expect(applyReplay.headers['x-idempotent-replay']).toBe('true');
    expect(installReplay.statusCode).toBe(200);
    expect(installReplay.headers['x-idempotent-replay']).toBe('true');
    expect(applyMissing.statusCode).toBe(404);
    expect(verifyReplay.statusCode).toBe(200);
    expect(verifyReplay.headers['x-idempotent-replay']).toBe('true');
  });
});
