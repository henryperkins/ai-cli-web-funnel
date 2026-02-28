import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CopilotFilesystemAdapterError,
  createCopilotVscodeAdapterContract,
  orderCopilotScopeWrites,
  resolveAdapterTrustTransition
} from '../src/index.js';

async function createTempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('copilot vscode adapter contracts', () => {
  it('orders scope writes deterministically', () => {
    const ordered = orderCopilotScopeWrites([
      {
        scope: 'daemon_default',
        scope_path: '/daemon',
        writable: true,
        approved: true,
        daemon_owned: true
      },
      {
        scope: 'workspace',
        scope_path: '/workspace',
        writable: true,
        approved: true,
        daemon_owned: true
      }
    ]);

    expect(ordered.ordered_writable.map((scope) => scope.scope)).toEqual([
      'workspace',
      'daemon_default'
    ]);
  });

  it('maps policy blocked preflight to policy_blocked trust state', () => {
    const next = resolveAdapterTrustTransition('trusted', {
      outcome: 'policy_blocked',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: 'policy_blocked_malware',
      warnings: [],
      policy_blocked: true,
      blocked_by: 'security_enforcement'
    });

    expect(next).toBe('policy_blocked');
  });

  it('persists entries to filesystem and executes lifecycle hooks', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-');
    const lifecycleLog: string[] = [];

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
          lifecycleLog.push('before');
        },
        async on_after_write() {
          lifecycleLog.push('after');
        },
        async on_lifecycle() {
          return;
        },
        async on_health_check() {
          return {
            healthy: true,
            details: []
          };
        }
      },
      {},
      {
        workspaceRoot: workspace,
        userProfilePath: join(workspace, 'user-profile.json'),
        daemonDefaultPath: join(workspace, 'daemon-default.json'),
        now: () => new Date('2026-03-01T00:00:00Z')
      }
    );

    const scopes = await adapter.discover_scopes();
    const targetScope = scopes[0];
    if (!targetScope) {
      throw new Error('expected at least one scope');
    }

    await adapter.write_entry(targetScope, {
      package_id: 'pkg-1',
      package_slug: 'acme/pkg-1',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted'
    });

    const stored = await adapter.read_entry(targetScope, 'pkg-1');

    expect(stored?.package_id).toBe('pkg-1');
    expect(lifecycleLog).toEqual(['before', 'after']);

    const file = JSON.parse(await readFile(targetScope.scope_path, 'utf8')) as {
      sidecar: { ownership_updated_at: string };
      servers: Array<{ package_id: string }>;
    };
    expect(file.sidecar.ownership_updated_at).toBe('2026-03-01T00:00:00.000Z');
    expect(file.servers).toHaveLength(1);

    await rm(workspace, { recursive: true, force: true });
  });

  it('restores backup when atomic rename fails mid-write', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-rollback-');
    const workspaceFile = join(workspace, '.vscode/mcp.json');

    const baseAdapter = createCopilotVscodeAdapterContract(
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
          return { healthy: true, details: [] };
        }
      },
      {},
      {
        workspaceRoot: workspace,
        now: () => new Date('2026-03-01T00:00:00Z')
      }
    );

    const scope = (await baseAdapter.discover_scopes())[0];
    if (!scope) {
      throw new Error('expected workspace scope');
    }

    await baseAdapter.write_entry(scope, {
      package_id: 'pkg-existing',
      package_slug: 'acme/existing',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted'
    });

    let shouldFailRename = true;

    const failingAdapter = createCopilotVscodeAdapterContract(
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
          return { healthy: true, details: [] };
        }
      },
      {},
      {
        workspaceRoot: workspace,
        now: () => new Date('2026-03-01T00:01:00Z'),
        fs: {
          access: async (path) => access(path),
          mkdir: async (path, options) => mkdir(path, options),
          readFile: async (path, encoding) => readFile(path, encoding),
          writeFile: async (path, data, encoding) => writeFile(path, data, encoding),
          open: async (path, flags, mode) => open(path, flags, mode),
          rename: async (from, to) => {
            if (shouldFailRename && from.includes('.tmp-')) {
              shouldFailRename = false;
              throw new Error('simulated_rename_failure');
            }
            await rename(from, to);
          },
          rm: async (path, options) => rm(path, options)
        }
      }
    );

    let thrown: unknown = null;
    try {
      await failingAdapter.write_entry(scope, {
        package_id: 'pkg-next',
        package_slug: 'acme/next',
        mode: 'local',
        transport: 'stdio',
        trust_state: 'trusted'
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CopilotFilesystemAdapterError);
    expect(['scope_write_rolled_back', 'scope_write_failed']).toContain(
      (thrown as CopilotFilesystemAdapterError).code
    );

    const restored = JSON.parse(await readFile(workspaceFile, 'utf8')) as {
      servers: Array<{ package_id: string }>;
    };
    expect(restored.servers.map((entry) => entry.package_id)).toEqual(['pkg-existing']);

    await rm(workspace, { recursive: true, force: true });
  });

  it('raises deterministic ownership conflicts for non-daemon-owned scopes', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-owner-');

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
          return { healthy: true, details: [] };
        }
      },
      {},
      {
        workspaceRoot: workspace
      }
    );

    const scopes = await adapter.discover_scopes();
    const workspaceScope = scopes[0];
    if (!workspaceScope) {
      throw new Error('expected workspace scope');
    }

    await expect(
      adapter.write_entry(
        {
          ...workspaceScope,
          daemon_owned: false
        },
        {
          package_id: 'pkg-conflict',
          package_slug: 'acme/conflict',
          mode: 'local',
          transport: 'stdio',
          trust_state: 'trusted'
        }
      )
    ).rejects.toMatchObject<CopilotFilesystemAdapterError>({
      code: 'scope_not_daemon_owned'
    });

    await rm(workspace, { recursive: true, force: true });
  });
});
