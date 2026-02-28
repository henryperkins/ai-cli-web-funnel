import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveFeatureFlags } from '@forge/shared-contracts';
import { readScopeSidecar } from '../src/scope-sidecar.js';
import { createRuntimeDaemonBootstrap } from '../src/runtime-bootstrap.js';

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    package_id: 'pkg-runtime-1',
    package_slug: 'acme/pkg-runtime-1',
    correlation_id: 'corr-runtime-1',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [
      {
        scope: 'workspace' as const,
        scope_path: '/workspace',
        writable: true,
        approved: true,
        daemon_owned: true
      }
    ],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-runtime-1',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-runtime-1'],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: 'pkg-runtime-1',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-02-27T00:00:00Z'
      }
    },
    ...overrides
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

describe('runtime bootstrap composition', () => {
  it('fails local runtime deterministically when local supervisor flag is disabled', async () => {
    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          localSupervisorEnabled: false
        }
      }),
      policyClient: buildAllowedPolicyClient()
    });

    const result = await bootstrap.run(buildRequest());

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('preflight_checks_failed');
    expect(result.stages.find((stage) => stage.stage === 'preflight_checks')?.details).toEqual([
      'runtime_local_supervisor_disabled'
    ]);
  });

  it('supports enabled local supervisor and returns ready when process is healthy', async () => {
    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          localSupervisorEnabled: true
        }
      }),
      policyClient: buildAllowedPolicyClient(),
      localSupervisorLauncher: {
        async launch() {
          return {
            async healthCheck() {
              return true;
            },
            async waitForExit() {
              return {
                code: 0,
                signal: null
              };
            }
          };
        }
      },
      localSupervisorOptions: {
        sleep: async () => {}
      }
    });

    const result = await bootstrap.run(buildRequest());

    expect(result.ready).toBe(true);
    expect(result.failure_reason_code).toBeNull();
  });

  it('returns deterministic remote hook-missing reason when SSE feature flag is disabled', async () => {
    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          remoteSseEnabled: false
        }
      }),
      policyClient: buildAllowedPolicyClient()
    });

    const result = await bootstrap.run(
      buildRequest({
        mode: 'remote',
        transport: 'sse'
      })
    );

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('remote_sse_hook_missing');
    expect(result.stages[result.stages.length - 1]).toMatchObject({
      stage: 'remote_connect',
      details: ['runtime_remote_sse_disabled']
    });
  });

  it('connects streamable-http when feature flag and connector dependencies are enabled', async () => {
    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          remoteStreamableHttpEnabled: true
        }
      }),
      policyClient: buildAllowedPolicyClient(),
      remoteResolver: {
        async resolve() {
          return {
            streamable_http_url: 'https://example.test/stream',
            auth: {
              type: 'bearer',
              secret_ref: 'sec://bearer'
            }
          };
        }
      },
      secretResolver: {
        async resolve() {
          return 'remote-token';
        }
      },
      remoteProbeClient: {
        async probeSse() {
          return { ok: true };
        },
        async probeStreamableHttp(_url, headers) {
          return {
            ok: headers.Authorization === 'Bearer remote-token'
          };
        }
      }
    });

    const result = await bootstrap.run(
      buildRequest({
        mode: 'remote',
        transport: 'streamable-http'
      })
    );

    expect(result.ready).toBe(true);
    expect(result.failure_reason_code).toBeNull();
  });

  it('guards scope-sidecar writes behind feature flags and daemon-ownership checks', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'forge-runtime-bootstrap-sidecar-'));

    const disabledBootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          scopeSidecarOwnershipEnabled: false
        }
      }),
      policyClient: buildAllowedPolicyClient()
    });

    const disabledResult = await disabledBootstrap.writeScopeSidecarGuarded({
      scope_hash: 'scope-disabled',
      scope_daemon_owned: true,
      record: {
        managed_by: 'runtime-daemon',
        client: 'vscode',
        scope_path: '/workspace/.forge',
        entry_keys: ['entry'],
        checksum: 'checksum-1',
        last_applied_at: '2026-02-27T12:00:00Z'
      },
      options: {
        baseDir
      }
    });

    expect(disabledResult).toEqual({
      ok: false,
      reason_code: 'runtime_scope_sidecar_ownership_disabled',
      path: null,
      written: false,
      merged: false
    });

    const enabledBootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          scopeSidecarOwnershipEnabled: true
        }
      }),
      policyClient: buildAllowedPolicyClient()
    });

    const notOwned = await enabledBootstrap.writeScopeSidecarGuarded({
      scope_hash: 'scope-not-owned',
      scope_daemon_owned: false,
      record: {
        managed_by: 'runtime-daemon',
        client: 'vscode',
        scope_path: '/workspace/.forge',
        entry_keys: ['entry'],
        checksum: 'checksum-2',
        last_applied_at: '2026-02-27T12:01:00Z'
      },
      options: {
        baseDir
      }
    });

    expect(notOwned.reason_code).toBe('runtime_scope_not_daemon_owned');

    const written = await enabledBootstrap.writeScopeSidecarGuarded({
      scope_hash: 'scope-owned',
      scope_daemon_owned: true,
      record: {
        managed_by: 'runtime-daemon',
        client: 'vscode',
        scope_path: '/workspace/.forge',
        entry_keys: ['entry'],
        checksum: 'checksum-3',
        last_applied_at: '2026-02-27T12:02:00Z'
      },
      options: {
        baseDir
      }
    });

    expect(written.ok).toBe(true);
    expect(await readScopeSidecar('scope-owned', baseDir)).toMatchObject({
      managed_by: 'runtime-daemon',
      checksum: 'checksum-3'
    });
  });
});
