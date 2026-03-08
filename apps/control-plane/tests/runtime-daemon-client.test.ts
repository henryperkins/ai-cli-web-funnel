import type { RuntimePipelineResult } from '@forge/runtime-daemon';
import { describe, expect, it } from 'vitest';
import { createRuntimeDaemonClient } from '../src/runtime-daemon-client.js';

function mockPipelineResult(): RuntimePipelineResult {
  return {
    ready: true,
    failure_reason_code: null,
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
      }
    ]
  };
}

function buildRequest() {
  return {
    package_id: 'pkg-1',
    package_slug: 'acme/pkg-1',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
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

describe('runtime daemon client', () => {
  it('posts to the daemon and returns the pipeline result', async () => {
    const expected = mockPipelineResult();
    let capturedUrl = '';
    let capturedBody = '';

    const client = createRuntimeDaemonClient({
      daemonUrl: 'http://localhost:4100',
      fetchImpl: (async (input, init) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body ?? '');
        return new Response(JSON.stringify(expected), {
          status: 200
        });
      }) as typeof fetch
    });

    const result = await client.run(buildRequest());

    expect(capturedUrl).toBe('http://localhost:4100/v1/runtime/verify');
    expect(JSON.parse(capturedBody).package_id).toBe('pkg-1');
    expect(result.ready).toBe(true);
    expect(result.stages).toHaveLength(1);
  });

  it('returns a synthetic failure on a non-2xx response', async () => {
    const client = createRuntimeDaemonClient({
      daemonUrl: 'http://localhost:4100',
      fetchImpl: (async () => new Response('error', { status: 502 })) as typeof fetch
    });

    const result = await client.run(buildRequest());
    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('health_validate_failed');
    expect(result.stages[0]?.details[0]).toContain('daemon_unreachable:status=502');
  });

  it('returns a synthetic failure on a network error', async () => {
    const client = createRuntimeDaemonClient({
      daemonUrl: 'http://localhost:4100',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch
    });

    const result = await client.run(buildRequest());
    expect(result.ready).toBe(false);
    expect(result.stages[0]?.details[0]).toContain('ECONNREFUSED');
  });
});
