import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCatalogPostgresAdapters } from '@forge/catalog/postgres-adapters';
import {
  INSTALL_LIFECYCLE_HTTP_ERROR_REASON,
  isInstallTrustResetTrigger,
  isInstallTrustState,
  type DependencyEdge,
  type InstallLifecycleCreatePlanRequest,
  type InstallTrustResetTrigger,
  type InstallTrustState
} from '@forge/shared-contracts';
import {
  createSignedReporterIngestionHttpHandler
} from '@forge/security-governance/http-handler';
import type {
  ReporterSignatureVerifier,
  SignedReporterIngestionDependencies,
  SignedReporterIngestionOptions
} from '@forge/security-governance';
import {
  createSecurityRolloutModeResolver
} from '@forge/security-governance';
import {
  createPostgresReporterDirectory,
  createPostgresReporterNonceStore,
  createPostgresSecurityEnforcementStore,
  createPostgresSecurityRolloutStateStore,
  createPostgresSecurityOutboxPublisher,
  createPostgresSecurityReportStore,
  type PostgresQueryExecutor as SecurityPostgresQueryExecutor
} from '@forge/security-governance/postgres-adapters';
import { evaluatePolicyPreflight } from '@forge/policy-engine';
import { createRuntimeDaemonBootstrap } from '@forge/runtime-daemon/runtime-bootstrap';
import type { CopilotAdapterContract } from '@forge/copilot-vscode-adapter';
import type { IngestionDependencies } from './index.js';
import { createCatalogRouteService } from './catalog-routes.js';
import { createProfileRouteService, type ProfileRouteService } from './profile-routes.js';
import { createProfilePostgresAdapters } from './profile-postgres-adapters.js';
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

const PROFILE_VISIBILITY_VALUES = new Set(['public', 'private', 'team']);

function parseRequestPath(rawPath: string): {
  pathname: string;
  query: URLSearchParams;
} {
  const parsed = new URL(rawPath, 'http://forge.local');
  return {
    pathname: parsed.pathname,
    query: parsed.searchParams
  };
}

function parseBoundedInteger(
  value: string | null,
  min: number,
  max: number
): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function isProfileVisibility(value: string): value is import('@forge/shared-contracts').ProfileVisibility {
  return PROFILE_VISIBILITY_VALUES.has(value);
}

function mapProfileRouteError(error: unknown): ForgeHttpAppResponse | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const reason = error.message;

  if (reason === 'profile_not_found') {
    return jsonResponse(404, { status: 'not_found', reason: 'profile_not_found' });
  }

  if (reason === 'install_run_not_found') {
    return jsonResponse(404, { status: 'not_found', reason: 'install_run_not_found' });
  }

  if (reason === 'install_lifecycle_unavailable') {
    return jsonResponse(503, { status: 'not_ready', reason: 'install_lifecycle_unavailable' });
  }

  if (
    reason.startsWith('create_') ||
    reason.startsWith('import_') ||
    reason.startsWith('list_') ||
    reason.startsWith('install_')
  ) {
    return jsonResponse(422, { status: 'invalid_request', reason });
  }

  return null;
}

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
  profileRoutes?: ProfileRouteService;
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

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return null;
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return null;
    }

    output.push(trimmed);
  }

  return output;
}

function asDependencyEdges(
  value: unknown
): DependencyEdge[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const output: DependencyEdge[] = [];
  for (const rawEdge of value) {
    const edge = asObject(rawEdge);
    if (!edge) {
      return null;
    }

    if (
      typeof edge.from_package_id !== 'string' ||
      edge.from_package_id.trim().length === 0 ||
      typeof edge.to_package_id !== 'string' ||
      edge.to_package_id.trim().length === 0 ||
      typeof edge.constraint !== 'string' ||
      edge.constraint.trim().length === 0 ||
      typeof edge.required !== 'boolean'
    ) {
      return null;
    }

    output.push({
      from_package_id: edge.from_package_id.trim(),
      to_package_id: edge.to_package_id.trim(),
      constraint: edge.constraint.trim(),
      required: edge.required
    });
  }

  return output;
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
      const parsedPath = parseRequestPath(request.path);
      const path = parsedPath.pathname;

      if (
        request.method === 'GET' &&
        (path === '/health' || path === '/healthz')
      ) {
        return jsonResponse(200, {
          status: 'ok'
        });
      }

      if (
        request.method === 'GET' &&
        (path === '/ready' || path === '/readyz')
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

      if (request.method === 'GET' && path === '/v1/packages') {
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

      if (request.method === 'GET' && path === '/v1/packages/freshness') {
        if (!dependencies.catalogRoutes) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'catalog_routes_unavailable'
          });
        }

        const freshness = await dependencies.catalogRoutes.getFreshnessStatus();
        return jsonResponse(200, freshness);
      }

      if (request.method === 'GET' && /^\/v1\/packages\/[^/]+$/i.test(path)) {
        if (!dependencies.catalogRoutes) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: 'catalog_routes_unavailable'
          });
        }

        const packageId = path.split('/')[3];
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

      if (request.method === 'POST' && path === '/v1/packages/search') {
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

      if (request.method === 'POST' && path === '/v1/install/plans') {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const body = asObject(request.body);
        if (!body) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.bodyObjectRequired
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
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingRequiredFields
          });
        }

        const requestedPermissions = asStringArray(body.requested_permissions);
        if (requestedPermissions === null) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingRequiredFields
          });
        }

        let dependencyEdges: DependencyEdge[] | undefined;
        if (body.dependency_edges !== undefined) {
          const parsedDependencyEdges = asDependencyEdges(body.dependency_edges);
          if (parsedDependencyEdges === null) {
            return jsonResponse(422, {
              status: 'invalid_request',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.dependencyEdgesInvalid
            });
          }

          dependencyEdges = parsedDependencyEdges;
        }

        let knownPackageIds: string[] | undefined;
        if (body.known_package_ids !== undefined) {
          const parsedKnownPackageIds = asStringArray(body.known_package_ids);
          if (parsedKnownPackageIds === null) {
            return jsonResponse(422, {
              status: 'invalid_request',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.knownPackageIdsInvalid
            });
          }

          knownPackageIds = parsedKnownPackageIds;
        }

        const trustStateInput = body.trust_state;
        if (
          trustStateInput !== undefined &&
          (typeof trustStateInput !== 'string' || !isInstallTrustState(trustStateInput))
        ) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.trustStateInvalid
          });
        }

        const trustResetTriggerInput = body.trust_reset_trigger;
        if (
          trustResetTriggerInput !== undefined &&
          (typeof trustResetTriggerInput !== 'string' ||
            !isInstallTrustResetTrigger(trustResetTriggerInput))
        ) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.trustResetTriggerInvalid
          });
        }

        try {
          const correlationId = resolveCorrelationId(request.headers);
          const createPlanRequest: InstallLifecycleCreatePlanRequest = {
            package_id: body.package_id,
            ...(typeof body.package_slug === 'string'
              ? { package_slug: body.package_slug }
              : {}),
            ...(correlationId ? { correlation_id: correlationId } : {}),
            org_id: body.org_id,
            requested_permissions: requestedPermissions,
            org_policy: body.org_policy as {
              mcp_enabled: boolean;
              server_allowlist: string[];
              block_flagged: boolean;
              permission_caps: {
                maxPermissions: number;
                disallowedPermissions: string[];
              };
            },
            ...(trustStateInput !== undefined
              ? {
                  trust_state: trustStateInput as InstallTrustState
                }
              : {}),
            ...(trustResetTriggerInput !== undefined
              ? {
                  trust_reset_trigger: trustResetTriggerInput as InstallTrustResetTrigger
                }
              : {}),
            ...(dependencyEdges !== undefined
              ? { dependency_edges: dependencyEdges }
              : {}),
            ...(knownPackageIds !== undefined
              ? { known_package_ids: knownPackageIds }
              : {})
          };

          const response = await dependencies.installLifecycle.createPlan(
            createPlanRequest,
            idempotencyKey
          );

          return jsonResponse(201, response, {
            'x-idempotent-replay': response.replayed ? 'true' : 'false'
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('idempotency_conflict')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
            });
          }

          if (error instanceof Error && error.message.includes('package_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.packageNotFound
            });
          }

          if (error instanceof Error && error.message.includes('dependency_resolution_failed:')) {
            return jsonResponse(422, {
              status: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.dependencyResolutionFailed,
              reason: error.message
            });
          }

          throw error;
        }
      }

      if (request.method === 'GET' && /^\/v1\/install\/plans\/[^/]+$/i.test(path)) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const planId = path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingPlanId
          });
        }

        const plan = await dependencies.installLifecycle.getPlan(planId);
        if (!plan) {
          return jsonResponse(404, {
            status: 'not_found',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound
          });
        }

        return jsonResponse(200, plan);
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/(?:apply|install)$/i.test(path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const planId = path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingPlanId
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
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound
            });
          }

          throw error;
        }
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/update$/i.test(path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const planId = path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingPlanId
          });
        }

        const body = request.body === null ? null : asObject(request.body);
        if (request.body !== null && body === null) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.bodyObjectRequired
          });
        }

        const targetVersion = body?.target_version;
        if (
          targetVersion !== undefined &&
          (typeof targetVersion !== 'string' || targetVersion.trim().length === 0)
        ) {
          return jsonResponse(422, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.targetVersionInvalid
          });
        }

        try {
          const response = await dependencies.installLifecycle.updatePlan(
            planId,
            resolveIdempotencyKey(request.headers),
            resolveCorrelationId(request.headers),
            typeof targetVersion === 'string' ? targetVersion.trim() : null
          );

          return jsonResponse(200, response, {
            'x-idempotent-replay': response.replayed ? 'true' : 'false'
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('idempotency_conflict')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound
            });
          }

          if (error instanceof Error && error.message.includes('update_invalid_plan_state')) {
            return jsonResponse(422, {
              status: 'invalid_request',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.updateInvalidPlanState
            });
          }

          throw error;
        }
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/(?:remove|uninstall)$/i.test(path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const planId = path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingPlanId
          });
        }

        try {
          const response = await dependencies.installLifecycle.removePlan(
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
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound
            });
          }

          if (error instanceof Error && error.message.includes('remove_invalid_plan_state')) {
            return jsonResponse(422, {
              status: 'invalid_request',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.removeInvalidPlanState
            });
          }

          if (error instanceof Error && error.message.includes('remove_dependency_blocked')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.removeDependencyBlocked
            });
          }

          throw error;
        }
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/rollback$/i.test(path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const planId = path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingPlanId
          });
        }

        try {
          const response = await dependencies.installLifecycle.rollbackPlan(
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
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound
            });
          }

          if (error instanceof Error && error.message.includes('rollback_invalid_plan_state')) {
            return jsonResponse(422, {
              status: 'invalid_request',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.rollbackInvalidPlanState
            });
          }

          if (error instanceof Error && error.message.includes('rollback_source_attempt_missing')) {
            return jsonResponse(409, {
              status: 'conflict',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.rollbackSourceAttemptMissing
            });
          }

          throw error;
        }
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/install\/plans\/[^/]+\/verify$/i.test(path)
      ) {
        if (!dependencies.installLifecycle) {
          return jsonResponse(503, {
            status: 'not_ready',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.installLifecycleUnavailable
          });
        }

        const planId = path.split('/')[4];
        if (!planId) {
          return jsonResponse(400, {
            status: 'invalid_request',
            reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.missingPlanId
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
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
            });
          }

          if (error instanceof Error && error.message.includes('plan_not_found')) {
            return jsonResponse(404, {
              status: 'not_found',
              reason: INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound
            });
          }

          throw error;
        }
      }

      if (request.method === 'POST' && path === '/v1/events') {
        return eventHandler.handle({
          method: 'POST',
          path: '/v1/events',
          headers: request.headers,
          body: request.body,
          ...(request.received_at ? { received_at: request.received_at } : {})
        });
      }

      if (request.method === 'POST' && path === '/v1/security/reports') {
        return securityHandler.handle({
          method: 'POST',
          path: '/v1/security/reports',
          headers: request.headers,
          body: request.body,
          ...(request.received_at ? { received_at: request.received_at } : {})
        });
      }

      // --- Profile routes ---

      if (request.method === 'POST' && path === '/v1/profiles') {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const body = asObject(request.body);
        if (
          !body ||
          typeof body.name !== 'string' ||
          typeof body.author_id !== 'string' ||
          !Array.isArray(body.packages)
        ) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'missing_required_fields' });
        }

        try {
          const result = await dependencies.profileRoutes.createProfile(
            body as unknown as import('@forge/shared-contracts').ProfileCreateInput
          );
          return jsonResponse(201, result);
        } catch (error) {
          const mapped = mapProfileRouteError(error);
          if (mapped) {
            return mapped;
          }
          throw error;
        }
      }

      if (request.method === 'GET' && path === '/v1/profiles') {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const limit = parseBoundedInteger(parsedPath.query.get('limit'), 1, 100);
        const offset = parseBoundedInteger(parsedPath.query.get('offset'), 0, 1_000_000);

        if (parsedPath.query.get('limit') !== null && limit === null) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'list_limit_out_of_range' });
        }

        if (parsedPath.query.get('offset') !== null && offset === null) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'list_offset_out_of_range' });
        }

        const authorIdRaw = parsedPath.query.get('author_id');
        const authorId = authorIdRaw?.trim() ?? null;
        if (authorIdRaw !== null && !authorId) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'list_author_id_invalid' });
        }

        const visibilityRaw = parsedPath.query.get('visibility');
        if (visibilityRaw !== null && !isProfileVisibility(visibilityRaw)) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'list_visibility_invalid' });
        }

        const options = {
          ...(limit !== null ? { limit } : {}),
          ...(offset !== null ? { offset } : {}),
          ...(authorId ? { author_id: authorId } : {}),
          ...(visibilityRaw ? { visibility: visibilityRaw } : {})
        };

        try {
          const result = await dependencies.profileRoutes.listProfiles(options);
          return jsonResponse(200, result);
        } catch (error) {
          const mapped = mapProfileRouteError(error);
          if (mapped) {
            return mapped;
          }
          throw error;
        }
      }

      if (request.method === 'GET' && /^\/v1\/profiles\/[^/]+$/i.test(path)) {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const profileId = path.split('/')[3];
        if (!profileId) {
          return jsonResponse(400, { status: 'invalid_request', reason: 'missing_profile_id' });
        }

        const result = await dependencies.profileRoutes.getProfile(profileId);
        if (!result.profile) {
          return jsonResponse(404, { status: 'not_found', reason: 'profile_not_found' });
        }

        return jsonResponse(200, result);
      }

      if (request.method === 'POST' && /^\/v1\/profiles\/[^/]+\/export$/i.test(path)) {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const profileId = path.split('/')[3];
        if (!profileId) {
          return jsonResponse(400, { status: 'invalid_request', reason: 'missing_profile_id' });
        }

        const result = await dependencies.profileRoutes.exportProfile(profileId);
        if (!result.export) {
          return jsonResponse(404, { status: 'not_found', reason: 'profile_not_found' });
        }

        return jsonResponse(200, result);
      }

      if (request.method === 'POST' && path === '/v1/profiles/import') {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const body = asObject(request.body);
        if (
          !body ||
          body.format_version !== '1.0.0' ||
          typeof body.profile !== 'object' ||
          body.profile === null
        ) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'invalid_import_payload' });
        }

        try {
          const result = await dependencies.profileRoutes.importProfile(
            body as unknown as import('@forge/shared-contracts').ProfileImportInput
          );
          return jsonResponse(201, result);
        } catch (error) {
          const mapped = mapProfileRouteError(error);
          if (mapped) {
            return mapped;
          }
          throw error;
        }
      }

      if (
        request.method === 'POST' &&
        /^\/v1\/profiles\/[^/]+\/install$/i.test(path)
      ) {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const profileId = path.split('/')[3];
        if (!profileId) {
          return jsonResponse(400, { status: 'invalid_request', reason: 'missing_profile_id' });
        }

        const body = asObject(request.body);
        if (
          !body ||
          typeof body.org_id !== 'string' ||
          typeof body.org_policy !== 'object' ||
          body.org_policy === null
        ) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'missing_required_fields' });
        }

        if (
          body.mode !== undefined &&
          body.mode !== 'plan_only' &&
          body.mode !== 'apply_verify'
        ) {
          return jsonResponse(422, { status: 'invalid_request', reason: 'install_mode_invalid' });
        }

        try {
          const correlationId = resolveCorrelationId(request.headers);
          const result = await dependencies.profileRoutes.installProfile(profileId, {
            org_id: body.org_id as string,
            org_policy: body.org_policy as {
              mcp_enabled: boolean;
              server_allowlist: string[];
              block_flagged: boolean;
              permission_caps: { maxPermissions: number; disallowedPermissions: string[] };
            },
            ...(typeof body.mode === 'string'
              ? { mode: body.mode as import('@forge/shared-contracts').ProfileInstallMode }
              : {}),
            ...(correlationId ? { correlation_id: correlationId } : {})
          });

          return jsonResponse(201, result);
        } catch (error) {
          const mapped = mapProfileRouteError(error);
          if (mapped) {
            return mapped;
          }

          throw error;
        }
      }

      if (
        request.method === 'GET' &&
        /^\/v1\/profiles\/install-runs\/[^/]+$/i.test(path)
      ) {
        if (!dependencies.profileRoutes) {
          return jsonResponse(503, { status: 'not_ready', reason: 'profile_routes_unavailable' });
        }

        const runId = path.split('/')[4];
        if (!runId) {
          return jsonResponse(400, { status: 'invalid_request', reason: 'missing_run_id' });
        }

        const result = await dependencies.profileRoutes.getInstallRun(runId);
        if (!result.run) {
          return jsonResponse(404, { status: 'not_found', reason: 'install_run_not_found' });
        }

        return jsonResponse(200, result);
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

  const rolloutStateStore = createPostgresSecurityRolloutStateStore({
    db: dependencies.db
  });

  const securityIngestion: SignedReporterIngestionDependencies = {
    reporters: createPostgresReporterDirectory({ db: dependencies.db }),
    nonceStore: createPostgresReporterNonceStore({ db: dependencies.db }),
    persistence: createPostgresSecurityReportStore({ db: dependencies.db }),
    projectionStore: createPostgresSecurityEnforcementStore({ db: dependencies.db }),
    rolloutModeResolver: createSecurityRolloutModeResolver({
      rolloutStateStore
    }),
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

  const profileRoutes = createProfileRouteService({
    profileAdapters: createProfilePostgresAdapters({ db: dependencies.db }),
    installLifecycle,
    ...(dependencies.idFactory ? { idFactory: dependencies.idFactory } : {})
  });

  return createForgeHttpApp({
    eventIngestion,
    securityIngestion,
    catalogRoutes,
    installLifecycle,
    profileRoutes,
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
