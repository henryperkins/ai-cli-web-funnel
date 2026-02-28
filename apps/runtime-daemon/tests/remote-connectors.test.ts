import { describe, expect, it } from 'vitest';
import { createRemoteConnectors } from '../src/remote-connectors.js';

function buildRequest() {
  return {
    package_id: 'pkg-remote-1',
    package_slug: 'acme/pkg-remote-1',
    mode: 'remote' as const,
    transport: 'sse' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-remote-1',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-remote-1'],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: 'pkg-remote-1',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-02-27T00:00:00Z'
      }
    }
  };
}

describe('remote connectors', () => {
  it('connects SSE with api-key auth secret resolution', async () => {
    const connectors = createRemoteConnectors(
      {
        async resolve() {
          return {
            sse_url: 'https://example.test/sse',
            auth: {
              type: 'api-key',
              secret_ref: 'sec://api-key',
              header_name: 'x-api-key'
            }
          };
        }
      },
      {
        async resolve() {
          return 'top-secret';
        }
      },
      {
        async probeSse(_url, headers) {
          return {
            ok: headers['x-api-key'] === 'top-secret'
          };
        },
        async probeStreamableHttp() {
          return { ok: true };
        }
      }
    );

    const result = await connectors.connect_sse?.(buildRequest());
    expect(result).toEqual({
      ok: true,
      details: ['remote_sse_probe_ok']
    });
  });

  it('returns deterministic failure when auth secret cannot be resolved', async () => {
    const connectors = createRemoteConnectors(
      {
        async resolve() {
          return {
            streamable_http_url: 'https://example.test/stream',
            auth: {
              type: 'bearer',
              secret_ref: 'sec://missing'
            }
          };
        }
      },
      {
        async resolve() {
          return null;
        }
      },
      {
        async probeSse() {
          return { ok: true };
        },
        async probeStreamableHttp() {
          return { ok: true };
        }
      }
    );

    const result = await connectors.connect_streamable_http?.({
      ...buildRequest(),
      transport: 'streamable-http'
    });

    expect(result).toEqual({
      ok: false,
      reason_code: 'remote_streamable_http_probe_failed',
      details: ['remote_auth_failed:secret_ref_not_found']
    });
  });

  it('fails fast when endpoint config is missing for selected transport', async () => {
    const connectors = createRemoteConnectors(
      {
        async resolve() {
          return null;
        }
      },
      {
        async resolve() {
          return null;
        }
      },
      {
        async probeSse() {
          return { ok: true };
        },
        async probeStreamableHttp() {
          return { ok: true };
        }
      }
    );

    const result = await connectors.connect_sse?.(buildRequest());

    expect(result).toEqual({
      ok: false,
      reason_code: 'remote_sse_probe_failed',
      details: ['remote_config_missing_sse_url']
    });
  });
});
