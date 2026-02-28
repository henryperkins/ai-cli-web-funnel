import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCopilotVscodeAdapterContract } from '../../apps/copilot-vscode-adapter/src/index.js';
import { createRuntimeDaemonBootstrap } from '../../apps/runtime-daemon/src/runtime-bootstrap.js';
import { readScopeSidecar } from '../../apps/runtime-daemon/src/scope-sidecar.js';
import { resolveFeatureFlags } from '../../packages/shared-contracts/src/feature-flags.js';

describe('e2e local: adapter + runtime composition', () => {
  it('writes adapter config and verifies runtime readiness with sidecar ownership update', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'forge-e2e-local-'));

    const adapter = createCopilotVscodeAdapterContract(
      {
        async preflight() {
          return {
            outcome: 'allowed',
            install_allowed: true,
            runtime_allowed: true,
            reason_code: null,
            warnings: [],
            policy_blocked: false,
            blocked_by: 'none'
          };
        }
      },
      {
        async on_before_write() {
          return;
        },
        async on_after_write() {
          return;
        },
        async on_lifecycle() {
          return;
        },
        async on_health_check() {
          return {
            healthy: true,
            details: ['ok']
          };
        }
      },
      {},
      {
        workspaceRoot: workspace,
        userProfilePath: join(workspace, 'user-profile.json'),
        daemonDefaultPath: join(workspace, 'daemon-default.json'),
        now: () => new Date('2026-03-01T14:00:00Z')
      }
    );

    const scopes = await adapter.discover_scopes();
    const workspaceScope = scopes.find((scope) => scope.scope === 'workspace');
    if (!workspaceScope) {
      throw new Error('expected workspace scope');
    }

    await adapter.write_entry(workspaceScope, {
      package_id: '8d7e9fe7-2103-46cb-a9bc-d65f86d1b66a',
      package_slug: 'acme/e2e-addon',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted'
    });

    const bootstrap = createRuntimeDaemonBootstrap({
      featureFlags: resolveFeatureFlags({
        runtime: {
          localSupervisorEnabled: true,
          remoteSseEnabled: false,
          remoteStreamableHttpEnabled: false,
          scopeSidecarOwnershipEnabled: true,
          hardcodedVsCodeProfilePath: false
        }
      }),
      policyClient: {
        async preflight() {
          return {
            outcome: 'allowed',
            install_allowed: true,
            runtime_allowed: true,
            reason_code: null,
            warnings: [],
            policy_blocked: false,
            blocked_by: 'none'
          };
        }
      },
      localSupervisorLauncher: {
        async launch() {
          return {
            async waitForExit() {
              return {
                code: 0,
                signal: null
              };
            },
            async healthCheck() {
              return true;
            }
          };
        }
      }
    });

    const run = await bootstrap.run({
      package_id: '8d7e9fe7-2103-46cb-a9bc-d65f86d1b66a',
      package_slug: 'acme/e2e-addon',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted',
      trust_reset_trigger: 'none',
      scope_candidates: scopes,
      policy_input: {
        org_id: 'org-e2e',
        package_id: '8d7e9fe7-2103-46cb-a9bc-d65f86d1b66a',
        requested_permissions: ['read:config'],
        org_policy: {
          mcp_enabled: true,
          server_allowlist: ['8d7e9fe7-2103-46cb-a9bc-d65f86d1b66a'],
          block_flagged: false,
          permission_caps: {
            maxPermissions: 5,
            disallowedPermissions: []
          }
        },
        enforcement: {
          package_id: '8d7e9fe7-2103-46cb-a9bc-d65f86d1b66a',
          state: 'none',
          reason_code: null,
          policy_blocked: false,
          source: 'none',
          updated_at: '2026-03-01T14:00:00Z'
        }
      }
    });

    expect(run.ready).toBe(true);

    const sidecarWrite = await bootstrap.writeScopeSidecarGuarded({
      scope_hash: 'e2e-scope-hash',
      scope_daemon_owned: true,
      record: {
        managed_by: 'control-plane',
        client: 'vscode_copilot',
        scope_path: workspaceScope.scope_path,
        entry_keys: ['8d7e9fe7-2103-46cb-a9bc-d65f86d1b66a'],
        checksum: 'checksum-e2e',
        last_applied_at: '2026-03-01T14:00:00Z'
      },
      options: {
        baseDir: join(workspace, 'runtime-sidecars'),
        owner: 'control-plane',
        allowMerge: true
      }
    });

    expect(sidecarWrite.ok).toBe(true);

    const sidecar = await readScopeSidecar('e2e-scope-hash', join(workspace, 'runtime-sidecars'));
    expect(sidecar).toMatchObject({
      managed_by: 'control-plane',
      client: 'vscode_copilot',
      scope_path: workspaceScope.scope_path
    });

    await rm(workspace, { recursive: true, force: true });
  });
});
