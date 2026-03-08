import type { RuntimePipelineResult, RuntimeStartRequest } from './index.js';

export interface DaemonHttpAppDependencies {
  pipeline: {
    run(request: RuntimeStartRequest): Promise<RuntimePipelineResult>;
  };
  processRegistry: {
    getStatus(packageId: string): { package_id: string; state: string; pid?: number } | null;
    stop(packageId: string): Promise<{ ok: boolean }>;
  };
  readinessProbe: () => Promise<{ ok: boolean; details?: string[] }>;
}

export interface DaemonHttpResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

function json(status: number, body: unknown): DaemonHttpResult {
  return {
    status,
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  };
}

function parseJsonBody(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return {
      ok: true,
      value: JSON.parse(rawBody)
    };
  } catch {
    return {
      ok: false
    };
  }
}

function extractPackageIdFromPath(path: string): string | null {
  const match = /^\/v1\/runtime\/status\/([^/]+)$/i.exec(path);
  if (!match?.[1]) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

export function createDaemonHttpApp(dependencies: DaemonHttpAppDependencies) {
  return {
    async handle(method: string, path: string, rawBody: string): Promise<DaemonHttpResult> {
      if (method === 'GET' && (path === '/health' || path === '/healthz')) {
        return json(200, { status: 'ok' });
      }

      if (method === 'GET' && (path === '/ready' || path === '/readyz')) {
        const probe = await dependencies.readinessProbe();
        return json(probe.ok ? 200 : 503, probe);
      }

      if (
        method === 'POST' &&
        (path === '/v1/runtime/start' || path === '/v1/runtime/verify')
      ) {
        const parsed = parseJsonBody(rawBody);
        if (!parsed.ok) {
          return json(400, {
            error: 'invalid_json',
            message: 'Request body must be valid JSON'
          });
        }

        try {
          const result = await dependencies.pipeline.run(parsed.value as RuntimeStartRequest);
          return json(200, result);
        } catch (error) {
          return json(500, {
            error: 'pipeline_error',
            message: error instanceof Error ? error.message : 'unknown'
          });
        }
      }

      if (method === 'POST' && path === '/v1/runtime/stop') {
        const parsed = parseJsonBody(rawBody);
        if (!parsed.ok) {
          return json(400, {
            error: 'invalid_json',
            message: 'Request body must be valid JSON'
          });
        }

        const body =
          typeof parsed.value === 'object' && parsed.value !== null
            ? (parsed.value as { package_id?: unknown })
            : {};

        if (typeof body.package_id !== 'string' || body.package_id.trim().length === 0) {
          return json(400, {
            error: 'missing_package_id'
          });
        }

        const result = await dependencies.processRegistry.stop(body.package_id);
        return json(200, result);
      }

      if (method === 'GET') {
        const packageId = extractPackageIdFromPath(path);
        if (packageId) {
          const status = dependencies.processRegistry.getStatus(packageId);
          if (!status) {
            return json(404, {
              error: 'not_found',
              package_id: packageId
            });
          }

          return json(200, status);
        }
      }

      return json(404, {
        error: 'not_found',
        path
      });
    }
  };
}
