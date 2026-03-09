import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  healthCommand,
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

const DEFAULT_ORG_POLICY = {
  mcp_enabled: true,
  server_allowlist: [],
  block_flagged: false,
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

let stdoutOutput: string;
const tempDirs: string[] = [];

beforeEach(() => {
  stdoutOutput = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

function createOrgPolicyFile(): string {
  return createTempFile('org-policy.json', JSON.stringify(DEFAULT_ORG_POLICY, null, 2));
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

  it('fails when org policy input is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await planCommand(
      makeArgs(['my-addon'], {
        'org-id': 'org-1',
      })
    );

    expect(stdoutOutput).toContain('Missing required flag: --org-policy-file');
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
});
