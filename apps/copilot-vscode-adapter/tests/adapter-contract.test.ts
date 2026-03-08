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
  type CopilotAdapterContract,
  type CopilotAdapterFilesystemOptions,
  createCopilotVscodeAdapterContract,
  orderCopilotScopeWrites,
  resolveAdapterTrustTransition
} from '../src/index.js';

async function createTempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function createTestAdapter(
  options: CopilotAdapterFilesystemOptions = {},
  lifecycleLog: string[] = []
): CopilotAdapterContract {
  return createCopilotVscodeAdapterContract(
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
    options
  );
}

function createScopeFileJson(
  servers: Array<{
    package_id: string;
    package_slug: string;
    mode: 'local' | 'remote';
    transport: 'stdio' | 'sse' | 'streamable-http';
    trust_state: 'trusted' | 'untrusted' | 'trust_expired' | 'denied' | 'policy_blocked';
  }> = []
): string {
  return (
    JSON.stringify(
      {
        schema_version: '1',
        managed_by: 'forge',
        updated_at: '2026-03-01T00:00:00.000Z',
        sidecar: {
          ownership_updated_at: '2026-03-01T00:00:00.000Z'
        },
        servers
      },
      null,
      2
    ) + '\n'
  );
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
      },
      {
        scope: 'user_profile',
        scope_path: '/user',
        writable: true,
        approved: true,
        daemon_owned: false
      }
    ]);

    expect(ordered.ordered_writable.map((scope) => scope.scope)).toEqual([
      'workspace',
      'daemon_default'
    ]);
    expect(ordered.blocked.map((scope) => scope.scope)).toEqual(['user_profile']);
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

  it('requires explicit scope paths instead of ambient defaults', async () => {
    const adapter = createTestAdapter();

    await expect(adapter.discover_scopes()).resolves.toEqual([]);
  });

  it('refuses to rewrite foreign scope files and reports them as not daemon-owned', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-foreign-');
    const scopePath = join(workspace, '.vscode/mcp.json');

    await mkdir(join(workspace, '.vscode'), { recursive: true });
    await writeFile(
      scopePath,
      JSON.stringify(
        {
          managed_by: 'user',
          servers: [
            {
              package_id: 'foreign',
              package_slug: 'acme/foreign',
              mode: 'local',
              transport: 'stdio',
              trust_state: 'trusted',
              extra: true
            }
          ]
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const adapter = createTestAdapter({
      workspaceRoot: workspace
    });

    const scope = (await adapter.discover_scopes())[0];
    if (!scope) {
      throw new Error('expected workspace scope');
    }

    expect(scope.daemon_owned).toBe(false);

    await expect(
      adapter.write_entry(scope, {
        package_id: 'pkg-1',
        package_slug: 'acme/pkg-1',
        mode: 'local',
        transport: 'stdio',
        trust_state: 'trusted'
      })
    ).rejects.toMatchObject<CopilotFilesystemAdapterError>({
      code: 'scope_not_daemon_owned'
    });

    expect(await readFile(scopePath, 'utf8')).toContain('"managed_by": "user"');

    await rm(workspace, { recursive: true, force: true });
  });

  for (const [label, contents] of [
    ['empty', ''],
    ['whitespace-only', '  \n\t']
  ] as const) {
    it(`heals ${label} scope files during write_entry`, async () => {
      const workspace = await createTempWorkspace(`forge-copilot-adapter-${label}-`);
      const scopePath = join(workspace, '.vscode/mcp.json');

      await mkdir(join(workspace, '.vscode'), { recursive: true });
      await writeFile(scopePath, contents, 'utf8');

      const adapter = createTestAdapter({
        workspaceRoot: workspace,
        now: () => new Date('2026-03-01T00:00:00Z')
      });

      const scope = (await adapter.discover_scopes())[0];
      if (!scope) {
        throw new Error('expected workspace scope');
      }

      expect(scope.daemon_owned).toBe(true);

      await adapter.write_entry(scope, {
        package_id: 'pkg-1',
        package_slug: 'acme/pkg-1',
        mode: 'local',
        transport: 'stdio',
        trust_state: 'trusted'
      });

      expect(JSON.parse(await readFile(scopePath, 'utf8'))).toMatchObject({
        managed_by: 'forge',
        schema_version: '1',
        servers: [{ package_id: 'pkg-1' }]
      });

      await rm(workspace, { recursive: true, force: true });
    });
  }

  it('persists entries to filesystem and executes lifecycle hooks', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-');
    const lifecycleLog: string[] = [];

    const adapter = createTestAdapter(
      {
        workspaceRoot: workspace,
        userProfilePath: join(workspace, 'user-profile.json'),
        daemonDefaultPath: join(workspace, 'daemon-default.json'),
        now: () => new Date('2026-03-01T00:00:00Z')
      },
      lifecycleLog
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

    const baseAdapter = createTestAdapter({
      workspaceRoot: workspace,
      now: () => new Date('2026-03-01T00:00:00Z')
    });

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

    const failingAdapter = createTestAdapter({
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
    });

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

  it('does not create scope files during no-op remove cleanup', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-remove-missing-');
    const adapter = createTestAdapter({
      workspaceRoot: workspace
    });

    const scope = (await adapter.discover_scopes())[0];
    if (!scope) {
      throw new Error('expected workspace scope');
    }

    await adapter.remove_entry(scope, 'pkg-missing');

    await expect(access(scope.scope_path)).rejects.toBeInstanceOf(Error);

    await rm(workspace, { recursive: true, force: true });
  });

  it('does not rewrite recoverable empty scope files during no-op remove cleanup', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-remove-empty-');
    const scopePath = join(workspace, '.vscode/mcp.json');

    await mkdir(join(workspace, '.vscode'), { recursive: true });
    await writeFile(scopePath, '', 'utf8');

    const adapter = createTestAdapter({
      workspaceRoot: workspace
    });

    const scope = (await adapter.discover_scopes())[0];
    if (!scope) {
      throw new Error('expected workspace scope');
    }

    expect(scope.daemon_owned).toBe(true);

    await adapter.remove_entry(scope, 'pkg-missing');

    expect(await readFile(scopePath, 'utf8')).toBe('');

    await rm(workspace, { recursive: true, force: true });
  });

  it('does not rewrite scope files when remove_entry has no matching package', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-remove-noop-');
    const scopePath = join(workspace, '.vscode/mcp.json');

    await mkdir(join(workspace, '.vscode'), { recursive: true });
    const original = createScopeFileJson([
      {
        package_id: 'pkg-existing',
        package_slug: 'acme/existing',
        mode: 'local',
        transport: 'stdio',
        trust_state: 'trusted'
      }
    ]);
    await writeFile(scopePath, original, 'utf8');

    const adapter = createTestAdapter({
      workspaceRoot: workspace,
      now: () => new Date('2026-03-01T00:05:00Z')
    });

    const scope = (await adapter.discover_scopes())[0];
    if (!scope) {
      throw new Error('expected workspace scope');
    }

    await adapter.remove_entry(scope, 'pkg-missing');

    expect(await readFile(scopePath, 'utf8')).toBe(original);

    await rm(workspace, { recursive: true, force: true });
  });

  it('serializes concurrent writes so entries are not lost', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-concurrent-');
    const scopePath = join(workspace, '.vscode/mcp.json');

    await mkdir(join(workspace, '.vscode'), { recursive: true });
    await writeFile(scopePath, createScopeFileJson(), 'utf8');

    let scopeReadCount = 0;
    let releaseFirstTempOpen: () => void = () => undefined;
    const firstTempOpenBlocked = new Promise<void>((resolve) => {
      releaseFirstTempOpen = resolve;
    });
    let firstTempOpenReached: () => void = () => undefined;
    const firstTempOpenSeen = new Promise<void>((resolve) => {
      firstTempOpenReached = resolve;
    });
    let blockFirstTempOpen = true;

    const adapter = createTestAdapter({
      workspaceRoot: workspace,
      fs: {
        access: async (path) => access(path),
        mkdir: async (path, options) => mkdir(path, options),
        readFile: async (path, encoding) => {
          if (path === scopePath) {
            scopeReadCount += 1;
          }
          return readFile(path, encoding);
        },
        writeFile: async (path, data, encoding) => writeFile(path, data, encoding),
        open: async (path, flags, mode) => {
          if (blockFirstTempOpen && path.includes('.tmp-')) {
            blockFirstTempOpen = false;
            firstTempOpenReached();
            await firstTempOpenBlocked;
          }
          return open(path, flags, mode);
        },
        rename: async (from, to) => rename(from, to),
        rm: async (path, options) => rm(path, options)
      }
    });

    const scope = (await adapter.discover_scopes())[0];
    if (!scope) {
      throw new Error('expected workspace scope');
    }

    scopeReadCount = 0;

    const firstWrite = adapter.write_entry(scope, {
      package_id: 'pkg-a',
      package_slug: 'acme/pkg-a',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted'
    });

    await firstTempOpenSeen;

    const secondWrite = adapter.write_entry(scope, {
      package_id: 'pkg-b',
      package_slug: 'acme/pkg-b',
      mode: 'local',
      transport: 'stdio',
      trust_state: 'trusted'
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(scopeReadCount).toBe(2);

    releaseFirstTempOpen();

    await Promise.all([firstWrite, secondWrite]);

    const stored = JSON.parse(await readFile(scopePath, 'utf8')) as {
      servers: Array<{ package_id: string }>;
    };
    expect(stored.servers.map((entry) => entry.package_id)).toEqual(['pkg-a', 'pkg-b']);

    await rm(workspace, { recursive: true, force: true });
  });

  it('raises deterministic ownership conflicts for non-daemon-owned scopes', async () => {
    const workspace = await createTempWorkspace('forge-copilot-adapter-owner-');

    const adapter = createTestAdapter({
      workspaceRoot: workspace
    });

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
