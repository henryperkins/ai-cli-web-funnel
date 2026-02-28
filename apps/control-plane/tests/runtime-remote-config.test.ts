import { describe, expect, it } from 'vitest';
import { createRuntimeDaemonBootstrap } from '@forge/runtime-daemon/runtime-bootstrap';
import { resolveRuntimeFeatureFlagsFromEnv } from '../src/runtime-feature-flags.js';
import {
  createFetchBackedRemoteProbeClient,
  createRuntimeOAuthTokenClientFromEnv,
  createSecretRefResolver,
  createRuntimeRemoteResolverFromEnv,
  createSecretRefResolverFromEnv
} from '../src/runtime-remote-config.js';

function buildRemoteRequest() {
  return {
    package_id: 'pkg-remote-1',
    package_slug: 'acme/pkg-remote-1',
    correlation_id: 'corr-remote-1',
    mode: 'remote' as const,
    transport: 'streamable-http' as const,
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

function buildAllowedPolicyClient() {
  return {
    async preflight() {
      return {
        outcome: 'allowed' as const,
        install_allowed: true,
        runtime_allowed: true,
        reason_code: null,
        warnings: [],
        policy_blocked: false,
        blocked_by: 'none' as const
      };
    }
  };
}

describe('runtime remote config integration', () => {
  it('falls back from primary secret resolver to env-map resolver deterministically', async () => {
    const resolver = createSecretRefResolver({
      primary: {
        async resolve(secretRef: string) {
          if (secretRef === 'sec://primary') {
            return 'primary-secret';
          }
          return null;
        }
      },
      fallback: createSecretRefResolverFromEnv({
        FORGE_RUNTIME_SECRET_REFS_JSON: JSON.stringify({
          'sec://fallback': 'fallback-secret'
        })
      })
    });

    expect(await resolver.resolve('sec://primary')).toBe('primary-secret');
    expect(await resolver.resolve('sec://fallback')).toBe('fallback-secret');
    expect(await resolver.resolve('sec://missing')).toBeNull();
  });

  it('returns deterministic missing secret_ref failure', async () => {
    const env = {
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL: 'https://remote.example.test/stream',
      FORGE_RUNTIME_REMOTE_AUTH_TYPE: 'bearer',
      FORGE_RUNTIME_REMOTE_SECRET_REF: 'sec://missing'
    };

    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveRuntimeFeatureFlagsFromEnv({
        env: {
          FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'true'
        }
      }),
      policyClient: buildAllowedPolicyClient(),
      remoteResolver: createRuntimeRemoteResolverFromEnv(env),
      secretResolver: createSecretRefResolverFromEnv({}),
      remoteProbeClient: createFetchBackedRemoteProbeClient(async () => {
        throw new Error('probe should not run without auth header');
      })
    });

    const result = await bootstrap.run(buildRemoteRequest());

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('remote_streamable_http_probe_failed');
    expect(result.stages[result.stages.length - 1]?.details).toEqual([
      'remote_auth_failed:secret_ref_not_found'
    ]);
  });

  it('returns deterministic oauth exchange failure when token endpoint fails', async () => {
    const env = {
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL: 'https://remote.example.test/stream',
      FORGE_RUNTIME_REMOTE_AUTH_TYPE: 'oauth2_client_credentials',
      FORGE_RUNTIME_REMOTE_SECRET_REF: 'sec://oauth',
      FORGE_RUNTIME_SECRET_REFS_JSON: JSON.stringify({
        'sec://oauth': JSON.stringify({
          token_url: 'https://auth.example.test/token',
          client_id: 'client-id',
          client_secret: 'client-secret'
        })
      })
    };

    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveRuntimeFeatureFlagsFromEnv({
        env: {
          FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'true'
        }
      }),
      policyClient: buildAllowedPolicyClient(),
      remoteResolver: createRuntimeRemoteResolverFromEnv(env),
      secretResolver: createSecretRefResolverFromEnv(env),
      remoteProbeClient: createFetchBackedRemoteProbeClient(async () => {
        throw new Error('probe should not run after oauth failure');
      }),
      oauthTokenClient: createRuntimeOAuthTokenClientFromEnv(undefined, {
        fetchImpl: async () => new Response('bad gateway', { status: 502 })
      })
    });

    const result = await bootstrap.run(buildRemoteRequest());

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('remote_streamable_http_probe_failed');
    expect(result.stages[result.stages.length - 1]?.details).toEqual([
      'remote_auth_failed:oauth_token_exchange_failed'
    ]);
  });

  it('reuses oauth token cache across repeated remote probes', async () => {
    let tokenFetchCalls = 0;
    let probeCalls = 0;

    const sharedFetch: typeof fetch = async (input, init) => {
      const url = String(input);

      if (url === 'https://auth.example.test/token') {
        tokenFetchCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: 'cached-token',
            token_type: 'Bearer',
            expires_in: 600
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }

      if (url === 'https://remote.example.test/stream') {
        probeCalls += 1;
        const headers = (init?.headers as Record<string, string>) ?? {};
        return new Response(
          JSON.stringify({ ok: true }),
          {
            status: headers.Authorization === 'Bearer cached-token' ? 200 : 401,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }

      return new Response('not found', { status: 404 });
    };

    const env = {
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL: 'https://remote.example.test/stream',
      FORGE_RUNTIME_REMOTE_AUTH_TYPE: 'oauth2_client_credentials',
      FORGE_RUNTIME_REMOTE_SECRET_REF: 'sec://oauth',
      FORGE_RUNTIME_SECRET_REFS_JSON: JSON.stringify({
        'sec://oauth': JSON.stringify({
          token_url: 'https://auth.example.test/token',
          client_id: 'client-id',
          client_secret: 'client-secret'
        })
      })
    };

    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveRuntimeFeatureFlagsFromEnv({
        env: {
          FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'true'
        }
      }),
      policyClient: buildAllowedPolicyClient(),
      remoteResolver: createRuntimeRemoteResolverFromEnv(env),
      secretResolver: createSecretRefResolverFromEnv(env),
      remoteProbeClient: createFetchBackedRemoteProbeClient(sharedFetch),
      oauthTokenClient: createRuntimeOAuthTokenClientFromEnv(undefined, {
        fetchImpl: sharedFetch,
        nowMs: () => 1_000
      })
    });

    const first = await bootstrap.run(buildRemoteRequest());
    const second = await bootstrap.run(buildRemoteRequest());

    expect(first.ready).toBe(true);
    expect(second.ready).toBe(true);
    expect(tokenFetchCalls).toBe(1);
    expect(probeCalls).toBe(2);
  });

  it('redacts secret-like values in oauth failure logs', async () => {
    const events: Array<{ payload: { reason: string } }> = [];
    const client = createRuntimeOAuthTokenClientFromEnv(
      {
        async log(event) {
          events.push({
            payload: {
              reason: event.payload.reason
            }
          });
        }
      },
      {
        fetchImpl: async () => {
          throw new Error(
            'request failed client_secret=super-secret Authorization: Bearer abcdefghijklmnop'
          );
        }
      }
    );

    await expect(
      client.exchange({
        secret_ref: 'sec://oauth',
        correlation_id: 'corr-1',
        secret_payload: JSON.stringify({
          token_url: 'https://auth.example.test/token',
          client_id: 'client-id',
          client_secret: 'client-secret'
        })
      })
    ).rejects.toThrow('oauth_token_network_error');

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.reason).not.toContain('super-secret');
    expect(events[0]?.payload.reason).not.toContain('abcdefghijklmnop');
    expect(events[0]?.payload.reason).toContain('[REDACTED]');
  });
});
