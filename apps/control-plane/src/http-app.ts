import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCatalogPostgresAdapters } from '@forge/catalog/postgres-adapters';
import {
  createSignedReporterIngestionHttpHandler
} from '@forge/security-governance/http-handler';
import type {
  ReporterSignatureVerifier,
  SignedReporterIngestionDependencies,
  SignedReporterIngestionOptions
} from '@forge/security-governance';
import {
  createPostgresReporterDirectory,
  createPostgresReporterNonceStore,
  createPostgresSecurityEnforcementStore,
  createPostgresSecurityOutboxPublisher,
  createPostgresSecurityReportStore,
  type PostgresQueryExecutor as SecurityPostgresQueryExecutor
} from '@forge/security-governance/postgres-adapters';
import { evaluatePolicyPreflight } from '@forge/policy-engine';
import { createRuntimeDaemonBootstrap } from '@forge/runtime-daemon/runtime-bootstrap';
import type { CopilotAdapterContract } from '@forge/copilot-vscode-adapter';
import type { IngestionDependencies } from './index.js';
import { createCatalogRouteService } from './catalog-routes.js';
import { createEventIngestionHttpHandler } from './http-handler.js';
import { resolveRuntimeFeatureFlagsFromEnv } from './runtime-feature-flags.js';
import {
  createFetchBackedRemoteProbeClient,
  createRuntimeOAuthTokenClientFromEnv,
  createSecretRefResolver,
  createRuntimeRemoteResolverFromEnv,
  createSecretRefResolverFromEnv
} from './runtime-remote-config.js';
import {
  createDbBackedReporterSignatureVerifier,
  createDefaultCopilotAdapterForLifecycle,
  createInstallLifecycleService,
  createPostgresInstallOutboxPublisher,
  createPostgresLifecycleIdempotencyAdapter,
  type InstallLifecycleLogger,
  type InstallRuntimeVerifier,
  type PostgresTransactionalQueryExecutor
} from './install-lifecycle.js';
import type { SecretRefResolver } from '@forge/runtime-daemon/remote-connectors';
import {
  createPostgresFraudFlagPipeline,
  createPostgresIdempotencyAdapter,
  createPostgresIngestionPersistenceAdapter,
  createPostgresOutboxPublisher,
  type FraudEvaluationEngine,
  type PostgresQueryExecutor as ControlPlanePostgresQueryExecutor
} from './postgres-adapters.js';

export interface ForgeHttpAppRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  received_at?: string;
}

export interface ForgeHttpAppResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ForgeHttpAppDependencies {
  eventIngestion: IngestionDependencies;
  securityIngestion: SignedReporterIngestionDependencies;
  securityOptions?: SignedReporterIngestionOptions;
  catalogRoutes?: ReturnType<typeof createCatalogRouteService>;
  installLifecycle?: ReturnType<typeof createInstallLifecycleService>;
  readinessProbe?: () => Promise<{ ok: boolean; details?: string[] }>;
}

export interface ForgeHttpAppPostgresDependencies {
  db: ControlPlanePostgresQueryExecutor &
    SecurityPostgresQueryExecutor &
    PostgresTransactionalQueryExecutor;
  signatureVerifier?: ReporterSignatureVerifier;
  fraudEvaluator?: FraudEvaluationEngine;
  securityOptions?: SignedReporterIngestionOptions;
  idFactory?: () => string;
  readinessProbe?: () => Promise<{ ok: boolean; details?: string[] }>;
  retrievalSearchService?: {
    search(query: string, limit: number): Promise<{
      documents: Array<{
        id: string;
        text: string;
        metadata?: Record<string, unknown>;
        bm25_score: number;
        semantic_score: number;
        fused_score: number;
      }>;
      semantic_fallback: boolean;
    }>;
    config?: {
      embeddingModel?: string;
      qdrantCollection?: string;
    };
  };
  copilotAdapter?: CopilotAdapterContract;
  runtimeVerifier?: InstallRuntimeVerifier;
  installLogger?: InstallLifecycleLogger;
  featureFlagEnv?: NodeJS.ProcessEnv;
  secretResolver?: SecretRefResolver;
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): ForgeHttpAppResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    },
    body
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function resolveIdempotencyKey(headers: Record<string, string | undefined>): string | null {
  const key = headers['idempotency-key'] ?? headers['x-idempotency-key'] ?? null;
  if (!key) {
    return null;
  }

  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveCorrelationId(headers: Record<string, string | undefined>): string | null {
  const correlationId = headers['x-correlation-id'];
  if (!correlationId) {
    return null;
  }

  const trimmed = correlationId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createForgeHttpApp(dependencies: ForgeHttpAppDependencies) {
  const eventHandler = createEventIngestionHttpHandler(dependencies.eventIngestion);
  const securityHandler = createSignedReporterIngestionHttpHandler(
    dependencies.securityIngestion,
    dependencies.securityOptions
  );

  return {
    async handle(request: ForgeHttpAppRequest): Promise<ForgeHttpAppResponse> {
      if (
        request.method === 'GET' &&
        (request.path === '/health' || request.path === '/healthz')
      ) {
        return jsonResponse(200, {
          status: 'ok'
        });
      }

      if (
        request.method === 'GET' &&
        (request.path === '/ready' || request.path === '/readyz')
      ) {
        if (!dependencies.readinessProbe) {
          return jsonResponse(200, {
            status: 'ready'
          });
        }

        const readiness = await dependencies.readinessProbe();
        return jsonResponse(
          readiness.ok ? 200 : 503,
          readiness.ok
            ? { status: 'ready' }
            : {
                status: 'not_ready',
                details: readiness.details ?? []
              }
        );
      }

      if (request.method === 'GET' && request.path === '/v1/packages') {
        if (!dependencies.catalogRoutes) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'catalog_routes_unavailable'
          });
        }

        const packages = await dependencies.catalogRoutes.listPackages();
        return jsonResponse(200, {
          packages
        });
      }

      if (request.method === 'GET' && /^\/v1\/packages\/[^/]+$/i.test(request.path)) {
        if (!dependencies.catalogRoutes) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'catalog_routes_unavailable'
          });
        }

        const packageId = request.path.split('/')[3];
        if (!packageId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: 'missing_package_id'
          });
        }

        const detail = await dependencies.catalogRoutes.getPackage(packageId);
        if (!detail) {
          return jsonResponse(404, {
            status: 'not_found',
            reason: 'package_not_found'
          });
        }

        return jsonResponse(200, detail);
      }

      if (request.method === 'POST' && request.path === '/v1/packages/search') {
        if (!dependencies.catalogRoutes) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'catalog_routes_unavailable'
          });
        }

        const body = asObject(request.body);
        const query = body?.query;
        const limit = body?.limit;

        if (typeof query !== 'string' || query.trim().length === 0) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: 'query_required'
          });
        }

        const searchResponse = await dependencies.catalogRoutes.searchPackages({
          query,
          ...(typeof limit === 'number' ? { limit } : {})
        });
        return jsonResponse(200, searchResponse);
      }

      if (request.method === 'POST' && request.path === '/v1/install/plans') {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'install_lifecycle_unavailable'
          });
        }

        const body = asObject(request.body);
        if (!body) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: 'body_object_required'
          });
        }

        const idempotencyKey = resolveIdempotencyKey(request.headers);

        if (
          typeof body.package_id !== 'string' ||
          typeof body.org_id !== 'string' ||
          !Array.isArray(body.requested_permissions) ||
          typeof body.org_policy !== 'object' ||
          body.org_policy === null
        ) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: 'missing_required_fields'
          });
        }

        try {
          const correlationId = resolveCorrelationId(request.headers);
          const response = await dependencies.installLifecycle.createPlan(
            {
              package_id: body.package_id,
              ...(typeof body.package_slug === 'string'
                ? { package_slug: body.package_slug }
                : {}),
              ...(correlationId ? { correlation_id: correlationId } : {}),
              org_id: body.org_id,
              requested_permissions: body.requested_permissions
                .filter((entry): entry is string => typeof entry === 'string'),
              org_policy: body.org_policy as {
                mcp_enabled: boolean;
                server_allowlist: string[];
                block_flagged: boolean;
                permission_caps: {
                  maxPermissions: number;
                  disallowedPermissions: string[];
                };
              },
              ...(typeof body.trust_state === 'string'
                ? {
                    trust_state: body.trust_state as
                      | 'untrusted'
                      | 'trusted'
                      | 'trust_expired'
                      | 'denied'
                      | 'policy_blocked'
                  }
                : {}),
              ...(typeof body.trust_reset_trigger === 'string'
                ? {
                    trust_reset_trigger: body.trust_reset_trigger as
                      | 'major_version_bump'
                      | 'author_changed'
                      | 'permission_escalation'
                      | 'user_revoked'
                      | 'none'
                  }
                : {})
            },
            idempotencyKey
          );

          return jsonResponse(201, response, {
            'x-idempotent-replay': response.replayed ? 'true' : 'false'
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('idempotency_conflict')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: 'idempotency_key_reused_with_different_payload'
            });
          }

          if (error instanceof Error && error.message.includes('package_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: 'package_not_found'
            });
          }

          throw error;
        }
      }

      if (request.method === 'GET' && /^\/v1\/install\/plans\/[^/]+$/i.test(request.path)) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'install_lifecycle_unavailable'
          });
        }

        const planId = request.path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: 'missing_plan_id'
          });
        }

        const plan = await dependencies.installLifecycle.getPlan(planId);
        if (!plan) {
          return jsonResponse(404, {
            status: 'not_found',
            reason: 'plan_not_found'
          });
        }

        return jsonResponse(200, plan);
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/(?:apply|install)$/i.test(request.path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'install_lifecycle_unavailable'
          });
        }

        const planId = request.path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: 'missing_plan_id'
          });
        }

        try {
          const response = await dependencies.installLifecycle.applyPlan(
            planId,
            resolveIdempotencyKey(request.headers),
            resolveCorrelationId(request.headers)
          );

          return jsonResponse(200, response, {
            'x-idempotent-replay': response.replayed ? 'true' : 'false'
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('idempotency_conflict')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: 'idempotency_key_reused_with_different_payload'
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: 'plan_not_found'
            });
          }

          throw error;
        }
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/verify$/i.test(request.path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'install_lifecycle_unavailable'
          });
        }

        const planId = request.path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: 'missing_plan_id'
          });
        }

        try {
          const response = await dependencies.installLifecycle.verifyPlan(
            planId,
            resolveIdempotencyKey(request.headers),
            resolveCorrelationId(request.headers)
          );

          return jsonResponse(200, response, {
            'x-idempotent-replay': response.replayed ? 'true' : 'false'
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('idempotency_conflict')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: 'idempotency_key_reused_with_different_payload'
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: 'plan_not_found'
            });
          }

          throw error;
        }
      }

      if (request.method === 'POST' && request.path === '/v1/events') {
        return eventHandler.handle({
          method: 'POST',
          path: '/v1/events',
          headers: request.headers,
          body: request.body,
          ...(request.received_at ? { received_at: request.received_at } : {})
        });
      }

      if (request.method === 'POST' && request.path === '/v1/security/reports') {
        return securityHandler.handle({
          method: 'POST',
          path: '/v1/security/reports',
          headers: request.headers,
          body: request.body,
          ...(request.received_at ? { received_at: request.received_at } : {})
        });
      }

      return jsonResponse(404, {
        status: 'not_found',
        message: 'Route not found'
      });
    }
  };
}

export function createForgeHttpAppFromPostgres(
  dependencies: ForgeHttpAppPostgresDependencies
) {
  const eventIngestion: IngestionDependencies = {
    idempotency: createPostgresIdempotencyAdapter({ db: dependencies.db }),
    persistence: createPostgresIngestionPersistenceAdapter({ db: dependencies.db }),
    fraudPipeline: createPostgresFraudFlagPipeline({
      db: dependencies.db,
      ...(dependencies.fraudEvaluator ? { evaluator: dependencies.fraudEvaluator } : {})
    }),
    outboxPublisher: createPostgresOutboxPublisher({ db: dependencies.db })
  };

  const signatureVerifier =
    dependencies.signatureVerifier ??
    createDbBackedReporterSignatureVerifier({
      db: dependencies.db
    });

  const securityIngestion: SignedReporterIngestionDependencies = {
    reporters: createPostgresReporterDirectory({ db: dependencies.db }),
    nonceStore: createPostgresReporterNonceStore({ db: dependencies.db }),
    persistence: createPostgresSecurityReportStore({ db: dependencies.db }),
    projectionStore: createPostgresSecurityEnforcementStore({ db: dependencies.db }),
    outboxPublisher: createPostgresSecurityOutboxPublisher({ db: dependencies.db }),
    signatureVerifier,
    ...(dependencies.idFactory ? { idFactory: dependencies.idFactory } : {})
  };

  const catalogRoutes = createCatalogRouteService({
    catalog: createCatalogPostgresAdapters({ db: dependencies.db }),
    ...(dependencies.retrievalSearchService
      ? {
          retrieval: {
            search: dependencies.retrievalSearchService.search,
            ...(dependencies.retrievalSearchService.config
              ? { config: dependencies.retrievalSearchService.config }
              : {})
          }
        }
      : {})
  });

  const runtimeVerifier =
    dependencies.runtimeVerifier ??
    (() => {
      const featureFlags = resolveRuntimeFeatureFlagsFromEnv({
        ...(dependencies.featureFlagEnv
          ? { env: dependencies.featureFlagEnv }
          : {})
      });

      const runtimeLogger = {
        log(event: { event_name: string; occurred_at: string; payload: Record<string, unknown> }) {
          console.log(JSON.stringify(event));
        }
      };

      const bootstrap = createRuntimeDaemonBootstrap({
        featureFlags,
        policyClient: {
          async preflight(input) {
            return evaluatePolicyPreflight(input);
          }
        },
        remoteResolver: createRuntimeRemoteResolverFromEnv(
          dependencies.featureFlagEnv
        ),
        secretResolver: createSecretRefResolver({
          ...(dependencies.secretResolver ? { primary: dependencies.secretResolver } : {}),
          fallback: createSecretRefResolverFromEnv(dependencies.featureFlagEnv)
        }),
        remoteProbeClient: createFetchBackedRemoteProbeClient(),
        oauthTokenClient: createRuntimeOAuthTokenClientFromEnv(runtimeLogger),
        logger: runtimeLogger
      });

      return {
        async run(request) {
          return bootstrap.run(request);
        },
        async writeScopeSidecarGuarded(request) {
          const checksum = createHash('sha256')
            .update(
              JSON.stringify({
                package_id: request.record.package_id,
                package_slug: request.record.package_slug,
                plan_id: request.record.plan_id,
                scope_path: request.record.scope_path
              })
            )
            .digest('hex');

          return bootstrap.writeScopeSidecarGuarded({
            scope_hash: request.scope_hash,
            scope_daemon_owned: request.scope_daemon_owned,
            record: {
              managed_by: 'control-plane',
              client: 'vscode_copilot',
              scope_path: request.record.scope_path,
              entry_keys: [request.record.package_id, request.record.plan_id, request.record.scope],
              checksum,
              last_applied_at: request.record.applied_at
            },
            options: {
              ...(request.options?.baseDir ? { baseDir: request.options.baseDir } : {}),
              owner: request.options?.owner ?? 'control-plane',
              allowMerge: request.options?.allowMerge ?? true
            }
          });
        }
      } satisfies InstallRuntimeVerifier;
    })();

  const installLifecycle = createInstallLifecycleService({
    db: dependencies.db,
    copilotAdapter: dependencies.copilotAdapter ?? createDefaultCopilotAdapterForLifecycle(),
    runtimeVerifier,
    idempotency: createPostgresLifecycleIdempotencyAdapter({ db: dependencies.db }),
    outboxPublisher: createPostgresInstallOutboxPublisher({ db: dependencies.db }),
    ...(dependencies.installLogger ? { logger: dependencies.installLogger } : {})
  });

  return createForgeHttpApp({
    eventIngestion,
    securityIngestion,
    catalogRoutes,
    installLifecycle,
    ...(dependencies.securityOptions
      ? {
          securityOptions: dependencies.securityOptions
        }
      : {}),
    ...(dependencies.readinessProbe
      ? {
          readinessProbe: dependencies.readinessProbe
        }
      : {})
  });
}

function normalizeHeaders(request: IncomingMessage): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(',');
      continue;
    }
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function createForgeHttpNodeListener(
  app: ReturnType<typeof createForgeHttpApp>
) {
  return async function forgeHttpNodeListener(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const body = await readBody(request);
    const appResponse = await app.handle({
      method: request.method ?? 'GET',
      path,
      headers: normalizeHeaders(request),
      body,
      received_at: new Date().toISOString()
    });

    response.statusCode = appResponse.statusCode;
    for (const [key, value] of Object.entries(appResponse.headers)) {
      response.setHeader(key, value);
    }

    response.end(JSON.stringify(appResponse.body));
  };
}
