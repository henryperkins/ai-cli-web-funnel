import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  healthCommand,
  initCommand,
  installCommand,
  parseArgs,
  planCommand,
  profileExportCommand,
  profileImportCommand,
  profileInstallCommand,
  profileListCommand,
  profileShowCommand,
  searchCommand,
  statusCommand,
  type ParsedArgs,
} from '../src/commands.js';
import {
  DEFAULT_SOLO_ORG_POLICY,
  defaultOrgId,
  resolveConfigPath,
  validateControlPlaneUrl,
} from '../src/config.js';

const DEFAULT_ORG_POLICY = {
  mcp_enabled: true,
  server_allowlist: [],
  block_flagged: true,
  permission_caps: {
    maxPermissions: 10,
    disallowedPermissions: [],
  },
} as const;

const BASE_PROFILE = {
  profile_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Dev Setup',
  description: 'A dev profile',
  author_id: 'author-1',
  visibility: 'public',
  target_sdk: 'codex',
  tags: ['dev'],
  version: '1.0.0',
  profile_hash: 'hash-1',
  packages: [
    {
      package_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      package_slug: 'acme/forge-addon',
      version_pinned: null,
      required: true,
      install_order: 0,
      config_overrides: {},
    },
  ],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
} as const;

const BASE_EXPORT = {
  format_version: '1.0.0',
  profile: {
    profile_id: BASE_PROFILE.profile_id,
    name: BASE_PROFILE.name,
    description: BASE_PROFILE.description,
    author_id: BASE_PROFILE.author_id,
    visibility: BASE_PROFILE.visibility,
    target_sdk: BASE_PROFILE.target_sdk,
    tags: [...BASE_PROFILE.tags],
    version: BASE_PROFILE.version,
    packages: [...BASE_PROFILE.packages],
  },
  exported_at: '2024-01-02T00:00:00Z',
} as const;

const CONFIG_POLICY = {
  mcp_enabled: true,
  server_allowlist: ['pkg-from-config'],
  block_flagged: false,
  permission_caps: {
    maxPermissions: 3,
    disallowedPermissions: ['write:secrets'],
  },
} as const;

const ENV_POLICY = {
  mcp_enabled: false,
  server_allowlist: ['pkg-from-env'],
  block_flagged: true,
  permission_caps: {
    maxPermissions: 1,
    disallowedPermissions: ['read:env'],
  },
} as const;

let stdoutOutput: string;
const tempDirs: string[] = [];

beforeEach(() => {
  stdoutOutput = '';
  const isolatedConfigDir = mkdtempSync(join(tmpdir(), 'forge-cli-config-'));
  tempDirs.push(isolatedConfigDir);
  vi.stubEnv('FORGE_CONFIG', join(isolatedConfigDir, 'config.json'));
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('FORGE_URL', undefined);
  vi.stubEnv('FORGE_ORG_ID', undefined);
  vi.stubEnv('FORGE_ORG_POLICY_FILE', undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeArgs(
  positional: string[],
  flags?: Record<string, string>,
  booleans?: string[]
): ParsedArgs {
  return {
    positional,
    flags: new Map(Object.entries(flags ?? {})),
    booleans: new Set(booleans ?? []),
  };
}

function createTempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cli-'));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cli-'));
  tempDirs.push(dir);
  return dir;
}

function createTempPath(name: string): string {
  return join(createTempDir(), name);
}

function createOrgPolicyFile(): string {
  return createTempFile('org-policy.json', JSON.stringify(DEFAULT_ORG_POLICY, null, 2));
}

function createPolicyFile(policy: unknown): string {
  return createTempFile('org-policy.json', JSON.stringify(policy, null, 2));
}

function createConfigFile(config: unknown): string {
  return createTempFile('config.json', JSON.stringify(config, null, 2));
}

function makePlanFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({
      status: 'planned',
      plan_id: 'plan-abc',
      package_id: '11111111-1111-4111-8111-111111111111',
      package_slug: 'my-addon',
      policy_outcome: 'allow',
      replayed: false,
    }),
  });
}

function mockFetchForResponse(response: { status: number; ok: boolean; body: unknown }): typeof fetch {
  return (async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  })) as unknown as typeof fetch;
}

function setGlobalFetch(response: { status: number; ok: boolean; body: unknown }): void {
  vi.stubGlobal('fetch', mockFetchForResponse(response));
}

describe('parseArgs', () => {
  it('parses positional args', () => {
    const result = parseArgs(['search', 'test-query']);
    expect(result.positional).toEqual(['search', 'test-query']);
  });

  it('parses flags with values', () => {
    const result = parseArgs(['--url', 'http://example.com', '--limit', '5']);
    expect(result.flags.get('url')).toBe('http://example.com');
    expect(result.flags.get('limit')).toBe('5');
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['--json', '--help']);
    expect(result.booleans.has('json')).toBe(true);
    expect(result.booleans.has('help')).toBe(true);
  });
});

describe('config helpers', () => {
  it('resolves config path from FORGE_CONFIG first', () => {
    expect(
      resolveConfigPath({
        env: {
          FORGE_CONFIG: '/tmp/custom-forge.json',
          XDG_CONFIG_HOME: '/tmp/xdg',
        },
        homeDir: '/home/tester',
      })
    ).toBe('/tmp/custom-forge.json');
  });

  it('resolves config path from XDG_CONFIG_HOME', () => {
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: '/tmp/xdg' },
        homeDir: '/home/tester',
      })
    ).toBe('/tmp/xdg/forge/config.json');
  });

  it('falls back to the home directory config path', () => {
    expect(resolveConfigPath({ env: {}, homeDir: '/home/tester' })).toBe('/home/tester/.forge/config.json');
  });

  it('validates config URLs', () => {
    expect(validateControlPlaneUrl('https://forge.example.test')).toBe('https://forge.example.test');
    expect(() => validateControlPlaneUrl('file:///tmp/forge.sock')).toThrow('http(s) URL');
    expect(() => validateControlPlaneUrl('localhost:8787')).toThrow('http(s) URL');
  });
});

describe('initCommand', () => {
  it('writes the default solo config to a custom path', async () => {
    const configPath = createTempPath('config.json');

    await initCommand(makeArgs([], { path: configPath, url: 'https://forge.example.test' }));

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(config).toEqual({
      org_id: defaultOrgId(),
      control_plane_url: 'https://forge.example.test',
      org_policy: DEFAULT_SOLO_ORG_POLICY,
    });
    expect((statSync(configPath).mode & 0o777).toString(8)).toBe('600');
    expect(stdoutOutput).toContain(`Forge config written to ${configPath}`);
  });

  it('refuses to overwrite an existing config without force', async () => {
    const configPath = createTempFile('config.json', '{"org_id":"existing"}\n');

    await initCommand(makeArgs([], { path: configPath }));

    expect(readFileSync(configPath, 'utf8')).toBe('{"org_id":"existing"}\n');
    expect(stdoutOutput).toContain('already exists');
    expect(process.exitCode).toBe(1);
  });

  it('overwrites an existing config with force', async () => {
    const configPath = createTempFile('config.json', '{"org_id":"existing"}\n');

    await initCommand(makeArgs([], { path: configPath }, ['force']));

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(config['org_id']).toBe(defaultOrgId());
    expect(config['org_policy']).toEqual(DEFAULT_SOLO_ORG_POLICY);
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects invalid init URLs', async () => {
    const configPath = createTempPath('config.json');

    await initCommand(makeArgs([], { path: configPath, url: 'not-a-url' }));

    expect(existsSync(configPath)).toBe(false);
    expect(stdoutOutput).toContain('--url must be an absolute http(s) URL');
    expect(process.exitCode).toBe(1);
  });
});

describe('searchCommand', () => {
  it('formats results as table', async () => {
    setGlobalFetch({
      status: 200,
      ok: true,
      body: {
        query: 'test',
        semantic_fallback: false,
        results: [
          { package_id: 'pkg-1', package_slug: 'test-pkg', score: 0.95 },
          { package_id: 'pkg-2', package_slug: null, score: 0.8 },
        ],
      },
    });

    await searchCommand(makeArgs(['test']));

    expect(stdoutOutput).toContain('PACKAGE_ID');
    expect(stdoutOutput).toContain('pkg-1');
    expect(stdoutOutput).toContain('0.9500');
  });

  it('sets a failing exit code for API errors', async () => {
    setGlobalFetch({
      status: 500,
      ok: false,
      body: { message: 'internal error' },
    });

    await searchCommand(makeArgs(['test']));

    expect(stdoutOutput).toContain('Error (HTTP 500)');
    expect(process.exitCode).toBe(1);
  });

  it('uses explicit URL without parsing a malformed config file', async () => {
    const configPath = createTempFile('config.json', '{not json');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: 'test',
        semantic_fallback: false,
        results: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await searchCommand(makeArgs(['test'], { path: configPath, url: 'https://forge.example.test' }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://forge.example.test/v1/packages/search');
    expect(stdoutOutput).toContain('PACKAGE_ID');
    expect(process.exitCode).toBeUndefined();
  });

  it('uses FORGE_URL without parsing a malformed config file', async () => {
    const configPath = createTempFile('config.json', '{not json');
    vi.stubEnv('FORGE_URL', 'https://forge-env.example.test');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: 'test',
        semantic_fallback: false,
        results: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await searchCommand(makeArgs(['test'], { path: configPath }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://forge-env.example.test/v1/packages/search');
    expect(process.exitCode).toBeUndefined();
  });
});

describe('planCommand', () => {
  it('resolves a non-UUID input via exact slug lookup', async () => {
    const orgPolicyFile = createOrgPolicyFile();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          package_id: '11111111-1111-4111-8111-111111111111',
          package_slug: 'my-addon',
          canonical_repo: 'github.com/acme/my-addon',
          updated_at: '2026-03-09T00:00:00Z',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          package_id: '11111111-1111-4111-8111-111111111111',
          package_slug: 'my-addon',
          canonical_repo: 'github.com/acme/my-addon',
          updated_at: '2026-03-09T00:00:00Z',
          aliases: [],
          lineage_summary: [],
          declared_permissions: ['read:config'],
          freshness: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          status: 'planned',
          plan_id: 'plan-abc',
          package_id: '11111111-1111-4111-8111-111111111111',
          package_slug: 'my-addon',
          policy_outcome: 'allow',
          replayed: false,
        }),
      });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['my-addon'], {
        'org-id': 'org-1',
        'org-policy-file': orgPolicyFile,
      })
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8787/v1/packages/resolve?slug=my-addon'
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://localhost:8787/v1/packages/11111111-1111-4111-8111-111111111111'
    );
    expect(stdoutOutput).toContain(
      'Resolved slug "my-addon" to package 11111111-1111-4111-8111-111111111111'
    );

    const createPlanInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(JSON.parse(createPlanInit.body as string)).toMatchObject({
      package_id: '11111111-1111-4111-8111-111111111111',
      org_id: 'org-1',
      requested_permissions: ['read:config'],
      org_policy: DEFAULT_ORG_POLICY,
    });
  });

  it('suggests search when an exact slug is not found', async () => {
    setGlobalFetch({
      status: 404,
      ok: false,
      body: { status: 'not_found', reason: 'package_not_found' },
    });

    await planCommand(
      makeArgs(['missing-addon'], {
        'org-id': 'org-1',
        'org-policy-file': createOrgPolicyFile(),
      })
    );

    expect(stdoutOutput).toContain('No package found with slug "missing-addon"');
    expect(stdoutOutput).toContain('forge search "missing-addon"');
    expect(process.exitCode).toBe(1);
  });

  it('fails closed when declared permissions are missing from package metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          package_id: '11111111-1111-4111-8111-111111111111',
          package_slug: 'my-addon',
          canonical_repo: 'github.com/acme/my-addon',
          updated_at: '2026-03-09T00:00:00Z',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          package_id: '11111111-1111-4111-8111-111111111111',
          package_slug: 'my-addon',
          canonical_repo: 'github.com/acme/my-addon',
          updated_at: '2026-03-09T00:00:00Z',
          aliases: [],
          lineage_summary: [],
          declared_permissions: null,
          freshness: null,
        }),
      });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['my-addon'], {
        'org-id': 'org-1',
        'org-policy-file': createOrgPolicyFile(),
      })
    );

    expect(stdoutOutput).toContain('does not publish declared permissions');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });

  it('uses built-in solo org defaults without explicit org flags', async () => {
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(makeArgs(['11111111-1111-4111-8111-111111111111'], { permissions: 'read:config' }));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: defaultOrgId(),
      requested_permissions: ['read:config'],
      org_policy: DEFAULT_SOLO_ORG_POLICY,
    });
    expect(stdoutOutput).toContain('Using default solo org policy');
    expect(process.exitCode).toBeUndefined();
  });

  it('omits the default-policy hint in JSON output', async () => {
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(makeArgs(['11111111-1111-4111-8111-111111111111'], { permissions: 'read:config' }, ['json']));

    expect(stdoutOutput).not.toContain('Using default solo org policy');
    expect(JSON.parse(stdoutOutput)).toMatchObject({ plan_id: 'plan-abc' });
  });

  it('uses config org context and control-plane URL', async () => {
    const configPath = createConfigFile({
      org_id: 'config-org',
      control_plane_url: 'https://forge.example.test',
      org_policy: CONFIG_POLICY,
    });
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        permissions: 'read:config',
      })
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://forge.example.test/v1/install/plans');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'config-org',
      org_policy: CONFIG_POLICY,
    });
    expect(stdoutOutput).not.toContain('Using default solo org policy');
  });

  it('allows partial org-id overrides while keeping config policy', async () => {
    const configPath = createConfigFile({
      org_id: 'config-org',
      org_policy: CONFIG_POLICY,
    });
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        'org-id': 'flag-org',
        permissions: 'read:config',
      })
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'flag-org',
      org_policy: CONFIG_POLICY,
    });
  });

  it('allows partial policy-file overrides while keeping config org-id', async () => {
    const configPath = createConfigFile({
      org_id: 'config-org',
      org_policy: CONFIG_POLICY,
    });
    const policyFile = createPolicyFile(ENV_POLICY);
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        'org-policy-file': policyFile,
        permissions: 'read:config',
      })
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'config-org',
      org_policy: ENV_POLICY,
    });
  });

  it('uses env org context before config and explicit flags before env', async () => {
    const configPath = createConfigFile({
      org_id: 'config-org',
      org_policy: CONFIG_POLICY,
    });
    const envPolicyFile = createPolicyFile(ENV_POLICY);
    const flagPolicyFile = createPolicyFile(DEFAULT_ORG_POLICY);
    vi.stubEnv('FORGE_ORG_ID', 'env-org');
    vi.stubEnv('FORGE_ORG_POLICY_FILE', envPolicyFile);
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        'org-id': 'flag-org',
        'org-policy-file': flagPolicyFile,
        permissions: 'read:config',
      })
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'flag-org',
      org_policy: DEFAULT_ORG_POLICY,
    });
  });

  it('uses env org context before config when flags are absent', async () => {
    const configPath = createConfigFile({
      org_id: 'config-org',
      org_policy: CONFIG_POLICY,
    });
    const envPolicyFile = createPolicyFile(ENV_POLICY);
    vi.stubEnv('FORGE_ORG_ID', 'env-org');
    vi.stubEnv('FORGE_ORG_POLICY_FILE', envPolicyFile);
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        permissions: 'read:config',
      })
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'env-org',
      org_policy: ENV_POLICY,
    });
  });

  it('uses explicit org/url overrides without parsing a malformed config file', async () => {
    const configPath = createTempFile('config.json', '{not json');
    const policyFile = createPolicyFile(ENV_POLICY);
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        url: 'https://forge.example.test',
        'org-id': 'flag-org',
        'org-policy-file': policyFile,
        permissions: 'read:config',
      })
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://forge.example.test/v1/install/plans');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'flag-org',
      org_policy: ENV_POLICY,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('uses env org/url overrides without parsing a malformed config file', async () => {
    const configPath = createTempFile('config.json', '{not json');
    const policyFile = createPolicyFile(ENV_POLICY);
    vi.stubEnv('FORGE_URL', 'https://forge-env.example.test');
    vi.stubEnv('FORGE_ORG_ID', 'env-org');
    vi.stubEnv('FORGE_ORG_POLICY_FILE', policyFile);
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        permissions: 'read:config',
      })
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://forge-env.example.test/v1/install/plans');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'env-org',
      org_policy: ENV_POLICY,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('shows the default-policy hint for partial configs without org policy', async () => {
    const configPath = createConfigFile({
      org_id: 'config-org',
      control_plane_url: 'https://forge.example.test',
    });
    const fetchMock = makePlanFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        permissions: 'read:config',
      })
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      org_id: 'config-org',
      org_policy: DEFAULT_SOLO_ORG_POLICY,
    });
    expect(stdoutOutput).toContain('Using default solo org policy');
    expect(stdoutOutput).toContain(configPath);
  });

  it('prints optional org flags in usage', async () => {
    await planCommand(makeArgs([]));

    expect(stdoutOutput).toContain(
      'Usage: forge plan <package_id_or_slug> [--org-id <org>] [--org-policy-file <file>] [--permissions <p1,p2>]'
    );
    expect(stdoutOutput).not.toContain('forge plan <package_id_or_slug> --org-id');
    expect(process.exitCode).toBe(1);
  });

  it('fails loudly for malformed config before API calls', async () => {
    const configPath = createTempFile('config.json', '{not json');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        permissions: 'read:config',
      })
    );

    expect(stdoutOutput).toContain(`Invalid Forge config at ${configPath}`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid config control-plane URLs before API calls', async () => {
    const configPath = createConfigFile({ control_plane_url: 'ftp://forge.example.test' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['11111111-1111-4111-8111-111111111111'], {
        path: configPath,
        permissions: 'read:config',
      })
    );

    expect(stdoutOutput).toContain(`Invalid Forge config at ${configPath}`);
    expect(stdoutOutput).toContain('control_plane_url must be an absolute http(s) URL');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('suggests package ids when an exact slug is ambiguous', async () => {
    setGlobalFetch({
      status: 409,
      ok: false,
      body: { status: 'conflict', reason: 'package_slug_ambiguous' },
    });

    await planCommand(
      makeArgs(['duplicate-addon'], {
        'org-id': 'org-1',
        'org-policy-file': createOrgPolicyFile(),
      })
    );

    expect(stdoutOutput).toContain('matches multiple packages');
    expect(stdoutOutput).toContain('retry with a package_id');
    expect(process.exitCode).toBe(1);
  });
});

describe('installCommand', () => {
  it('prints apply result', async () => {
    setGlobalFetch({
      status: 200,
      ok: true,
      body: {
        status: 'applied',
        plan_id: 'p-1',
        replayed: false,
        attempt_number: 1,
        reason_code: null,
      },
    });

    await installCommand(makeArgs(['p-1']));

    expect(stdoutOutput).toContain('applied');
    expect(stdoutOutput).toContain('p-1');
  });
});

describe('statusCommand', () => {
  it('prints plan detail with actions', async () => {
    setGlobalFetch({
      status: 200,
      ok: true,
      body: {
        plan_id: 'p-1',
        package_id: 'pkg-1',
        package_slug: 'test',
        status: 'planned',
        policy_outcome: 'allow',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        actions: [{ action_order: 1, action_type: 'install', scope: 'user', status: 'pending' }],
      },
    });

    await statusCommand(makeArgs(['p-1']));

    expect(stdoutOutput).toContain('Actions:');
    expect(stdoutOutput).toContain('install');
    expect(stdoutOutput).toContain('pending');
  });
});

describe('healthCommand', () => {
  it('prints health status', async () => {
    setGlobalFetch({
      status: 200,
      ok: true,
      body: { status: 'ok', version: '1.0.0' },
    });

    await healthCommand(makeArgs([]));

    expect(stdoutOutput).toContain('ok');
    expect(stdoutOutput).toContain('1.0.0');
  });
});

describe('profile subcommands', () => {
  it('profileListCommand formats the real list response shape', async () => {
    setGlobalFetch({
      status: 200,
      ok: true,
      body: {
        profiles: [
          {
            profile_id: BASE_PROFILE.profile_id,
            name: BASE_PROFILE.name,
            author_id: BASE_PROFILE.author_id,
            visibility: BASE_PROFILE.visibility,
            target_sdk: BASE_PROFILE.target_sdk,
            tags: BASE_PROFILE.tags,
            version: BASE_PROFILE.version,
            package_count: BASE_PROFILE.packages.length,
            created_at: BASE_PROFILE.created_at,
            updated_at: BASE_PROFILE.updated_at,
          },
        ],
      },
    });

    await profileListCommand(makeArgs([]));

    expect(stdoutOutput).toContain('PROFILE_ID');
    expect(stdoutOutput).toContain('codex');
    expect(stdoutOutput).toContain('1.0.0');
  });

  it('profileShowCommand unwraps the profile envelope', async () => {
    setGlobalFetch({
      status: 200,
      ok: true,
      body: {
        profile: BASE_PROFILE,
      },
    });

    await profileShowCommand(makeArgs([BASE_PROFILE.profile_id]));

    expect(stdoutOutput).toContain(BASE_PROFILE.profile_id);
    expect(stdoutOutput).toContain(BASE_PROFILE.name);
    expect(stdoutOutput).toContain(BASE_PROFILE.target_sdk);
  });

  it('profileExportCommand writes the export payload without the HTTP envelope', async () => {
    const outputFile = createTempFile('profile-export.json', '');
    setGlobalFetch({
      status: 200,
      ok: true,
      body: {
        export: BASE_EXPORT,
      },
    });

    await profileExportCommand(
      makeArgs([BASE_PROFILE.profile_id], {
        output: outputFile,
      })
    );

    expect(stdoutOutput).toContain(`Profile exported to ${outputFile}`);
    expect(JSON.parse(readFileSync(outputFile, 'utf8'))).toEqual(BASE_EXPORT);
  });

  it('profileImportCommand normalizes legacy export envelopes before posting', async () => {
    const inputFile = createTempFile(
      'profile-import.json',
      JSON.stringify({ export: BASE_EXPORT }, null, 2)
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        profile: BASE_PROFILE,
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await profileImportCommand(makeArgs([inputFile]));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      format_version: '1.0.0',
      profile: BASE_EXPORT.profile,
    });
    expect(stdoutOutput).toContain(BASE_PROFILE.profile_id);
    expect(stdoutOutput).toContain(BASE_PROFILE.name);
  });

  it('profileImportCommand rejects invalid payloads before calling the API', async () => {
    const inputFile = createTempFile('invalid-profile.json', JSON.stringify({ nope: true }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await profileImportCommand(makeArgs([inputFile]));

    expect(stdoutOutput).toContain('Invalid profile import payload');
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('profileInstallCommand sends org policy and formats run results', async () => {
    const orgPolicyFile = createOrgPolicyFile();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        run: {
          run_id: 'run-1',
          profile_id: BASE_PROFILE.profile_id,
          status: 'partially_failed',
          total_packages: 2,
          succeeded_count: 1,
          failed_count: 1,
          skipped_count: 0,
          correlation_id: null,
          started_at: '2026-03-09T00:00:00Z',
          completed_at: '2026-03-09T00:00:02Z',
          plans: [],
        },
        plan_results: [
          {
            plan_id: 'plan-1',
            package_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            install_order: 0,
            status: 'verified',
          },
          {
            plan_id: null,
            package_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            install_order: 1,
            status: 'failed',
            error: 'package_not_found',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await profileInstallCommand(
      makeArgs([BASE_PROFILE.profile_id], {
        'org-id': 'org-1',
        'org-policy-file': orgPolicyFile,
      })
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      org_id: 'org-1',
      org_policy: DEFAULT_ORG_POLICY,
      mode: 'plan_only',
    });
    expect(stdoutOutput).toContain('run_id');
    expect(stdoutOutput).toContain('Plan Results:');
    expect(stdoutOutput).toContain('plan-1');
    expect(stdoutOutput).toContain('package_not_found');
  });

  it('profileInstallCommand can use default solo org context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        run: {
          run_id: 'run-default',
          profile_id: BASE_PROFILE.profile_id,
          status: 'planned',
          total_packages: 1,
          succeeded_count: 1,
          failed_count: 0,
          skipped_count: 0,
          correlation_id: null,
          started_at: '2026-03-09T00:00:00Z',
          completed_at: null,
          plans: [],
        },
        plan_results: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await profileInstallCommand(makeArgs([BASE_PROFILE.profile_id]));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      org_id: defaultOrgId(),
      org_policy: DEFAULT_SOLO_ORG_POLICY,
      mode: 'plan_only',
    });
    expect(stdoutOutput).toContain('Using default solo org policy');
    expect(stdoutOutput).toContain('run-default');
  });

  it('profileInstallCommand prints optional org flags in usage', async () => {
    await profileInstallCommand(makeArgs([]));

    expect(stdoutOutput).toContain(
      'Usage: forge profile install <id> [--org-id <org>] [--org-policy-file <file>] [--mode <plan_only|apply_verify>]'
    );
    expect(stdoutOutput).not.toContain('forge profile install <id> --org-id');
    expect(process.exitCode).toBe(1);
  });
});
