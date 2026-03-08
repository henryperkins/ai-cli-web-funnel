import { describe, expect, it } from 'vitest';
import {
  createDaemonHttpApp,
  type DaemonHttpAppDependencies
} from '../src/daemon-http-app.js';
import type { RuntimePipelineResult, RuntimeStartRequest } from '../src/index.js';

function buildMockPipelineResult(ready: boolean): RuntimePipelineResult {
  return {
    ready,
    failure_reason_code: ready ? null : 'preflight_checks_failed',
    final_trust_state: 'trusted',
    policy: {
      outcome: 'allowed',
      install_allowed: true,
      runtime_allowed: true,
      reason_code: null,
      warnings: [],
      policy_blocked: false,
      blocked_by: 'none'
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
        stage: 'trust_gate',
        ok: true,
        details: ['trust_state=trusted']
      }
    ]
  };
}

function buildDependencies(
  overrides: Partial<DaemonHttpAppDependencies> = {}
): DaemonHttpAppDependencies {
  return {
    pipeline: {
      async run(_request: RuntimeStartRequest) {
        return buildMockPipelineResult(true);
      }
    },
    processRegistry: {
      getStatus(_packageId: string) {
        return null;
      },
      async stop(_packageId: string) {
        return {
          ok: true
        };
      }
    },
    readinessProbe: async () => ({
      ok: true,
      details: ['ready']
    }),
    ...overrides
  };
}

function buildRuntimeRequest() {
  return {
    package_id: 'pkg-1',
    package_slug: 'acme/pkg-1',
    mode: 'local',
    transport: 'stdio',
    trust_state: 'trusted',
    trust_reset_trigger: 'none',
    scope_candidates: [],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-1',
      requested_permissions: [],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-1'],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: 'pkg-1',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-03-01T00:00:00Z'
      }
    }
  };
}

describe('daemon http app', () => {
  it('POST /v1/runtime/verify returns the pipeline result', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle(
      'POST',
      '/v1/runtime/verify',
      JSON.stringify(buildRuntimeRequest())
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.ready).toBe(true);
    expect(body.stages).toHaveLength(2);
  });

  it('POST /v1/runtime/start is an alias for verify', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle(
      'POST',
      '/v1/runtime/start',
      JSON.stringify(buildRuntimeRequest())
    );

    expect(result.status).toBe(200);
  });

  it('returns 400 on invalid JSON body', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('POST', '/v1/runtime/verify', 'not json');

    expect(result.status).toBe(400);
  });

  it('GET /health returns 200', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('GET', '/health', '');

    expect(result.status).toBe(200);
  });

  it('GET /ready returns 200 when the daemon is ready', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('GET', '/ready', '');

    expect(result.status).toBe(200);
  });

  it('GET /ready returns 503 when the daemon is not ready', async () => {
    const app = createDaemonHttpApp(
      buildDependencies({
        readinessProbe: async () => ({
          ok: false,
          details: ['initializing']
        })
      })
    );
    const result = await app.handle('GET', '/ready', '');

    expect(result.status).toBe(503);
  });

  it('returns 404 for unknown routes', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle('GET', '/unknown', '');

    expect(result.status).toBe(404);
  });

  it('POST /v1/runtime/stop returns the process registry result', async () => {
    const app = createDaemonHttpApp(buildDependencies());
    const result = await app.handle(
      'POST',
      '/v1/runtime/stop',
      JSON.stringify({
        package_id: 'pkg-1'
      })
    );

    expect(result.status).toBe(200);
  });
});
