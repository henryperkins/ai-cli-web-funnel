import { describe, expect, it } from 'vitest';
import {
  normalizeGitHubRepos,
  type GitHubRepoMetadata,
  type GitHubReleaseMetadata
} from '../src/sources/github-connector.js';

function buildRepo(overrides?: Partial<GitHubRepoMetadata>): GitHubRepoMetadata {
  return {
    id: 100001,
    full_name: 'acme/mcp-server',
    html_url: 'https://github.com/acme/mcp-server',
    description: 'An MCP server for testing',
    homepage: null,
    stargazers_count: 42,
    topics: ['mcp', 'server'],
    updated_at: '2026-01-15T10:00:00Z',
    pushed_at: '2026-01-20T12:00:00Z',
    default_branch: 'main',
    language: 'TypeScript',
    license: { spdx_id: 'MIT' },
    fork: false,
    archived: false,
    ...overrides
  };
}

describe('github connector normalization', () => {
  it('normalizes a standard repo to CatalogSourceCandidate', () => {
    const repos = [buildRepo()];
    const result = normalizeGitHubRepos(repos);

    expect(result.candidates).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const candidate = result.candidates[0]!;
    expect(candidate.source_name).toBe('github');
    expect(candidate.github_repo_id).toBe(100001);
    expect(candidate.github_repo_locator).toBe('https://github.com/acme/mcp-server');
    expect(candidate.tool_kind).toBe('mcp');
    expect(candidate.package_slug).toBe('acme/mcp-server');
    expect(candidate.canonical_repo).toBe('github.com/acme/mcp-server');
    expect(candidate.source_updated_at).toBe('2026-01-20T12:00:00Z');

    expect(candidate.fields).toMatchObject({
      githubRepoId: 100001,
      name: 'mcp-server',
      description: 'An MCP server for testing',
      stars: 42,
      lastUpdated: '2026-01-20T12:00:00Z',
      tags: ['mcp', 'server'],
      runtimeRequirements: { language: 'TypeScript' }
    });
  });

  it('skips archived repos', () => {
    const repos = [buildRepo({ archived: true })];
    const result = normalizeGitHubRepos(repos);

    expect(result.candidates).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe('archived');
  });

  it('skips forked repos', () => {
    const repos = [buildRepo({ fork: true })];
    const result = normalizeGitHubRepos(repos);

    expect(result.candidates).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe('fork');
  });

  it('includes homepage as url_alias', () => {
    const repos = [buildRepo({ homepage: 'https://acme.io/mcp' })];
    const result = normalizeGitHubRepos(repos);

    const aliases = result.candidates[0]!.aliases!;
    expect(aliases).toHaveLength(1);
    expect(aliases[0]!.alias_type).toBe('url_alias');
    expect(aliases[0]!.alias_value).toBe('https://acme.io/mcp');
  });

  it('respects custom toolKind option', () => {
    const repos = [buildRepo()];
    const result = normalizeGitHubRepos(repos, { toolKind: 'plugin' });
    expect(result.candidates[0]!.tool_kind).toBe('plugin');
  });

  it('omits license field when spdx_id is null or NOASSERTION', () => {
    const repos = [buildRepo({ license: null })];
    const result = normalizeGitHubRepos(repos);
    expect(result.candidates[0]!.fields).not.toHaveProperty('license');

    const repos2 = [buildRepo({ license: { spdx_id: 'NOASSERTION' } })];
    const result2 = normalizeGitHubRepos(repos2);
    expect(result2.candidates[0]!.fields).not.toHaveProperty('license');
  });

  it('omits tags when topics array is empty', () => {
    const repos = [buildRepo({ topics: [] })];
    const result = normalizeGitHubRepos(repos);
    expect(result.candidates[0]!.fields!.tags).toBeUndefined();
  });

  it('deduplicates and sorts topics', () => {
    const repos = [buildRepo({ topics: ['zeta', 'alpha', 'zeta', 'beta'] })];
    const result = normalizeGitHubRepos(repos);
    expect(result.candidates[0]!.fields!.tags).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('enriches with latest release version when available', () => {
    const repos = [buildRepo()];
    const releases = new Map<string, GitHubReleaseMetadata>([
      [
        'acme/mcp-server',
        {
          tag_name: 'v1.2.3',
          name: 'Release 1.2.3',
          published_at: '2026-01-18T14:00:00Z',
          prerelease: false,
          draft: false
        }
      ]
    ]);

    const result = normalizeGitHubRepos(repos, { latestReleases: releases });
    expect(result.candidates[0]!.fields!.latestVersion).toBe('v1.2.3');
  });

  it('skips prerelease versions', () => {
    const repos = [buildRepo()];
    const releases = new Map<string, GitHubReleaseMetadata>([
      [
        'acme/mcp-server',
        {
          tag_name: 'v2.0.0-beta.1',
          name: 'Beta',
          published_at: '2026-01-18T14:00:00Z',
          prerelease: true,
          draft: false
        }
      ]
    ]);

    const result = normalizeGitHubRepos(repos, { latestReleases: releases });
    expect(result.candidates[0]!.fields!.latestVersion).toBeUndefined();
  });

  it('uses updated_at as fallback when pushed_at is null', () => {
    const repos = [buildRepo({ pushed_at: null as unknown as string })];
    const result = normalizeGitHubRepos(repos);
    expect(result.candidates[0]!.source_updated_at).toBe('2026-01-15T10:00:00Z');
  });

  it('processes multiple repos keeping order and filtering independently', () => {
    const repos = [
      buildRepo({ id: 1, full_name: 'a/one', archived: false, fork: false }),
      buildRepo({ id: 2, full_name: 'b/two', archived: true }),
      buildRepo({ id: 3, full_name: 'c/three', fork: true }),
      buildRepo({ id: 4, full_name: 'd/four', archived: false, fork: false })
    ];

    const result = normalizeGitHubRepos(repos);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.package_slug)).toEqual(['a/one', 'd/four']);
    expect(result.skipped).toHaveLength(2);
  });

  it('produces candidates that feed into CatalogIngestInput', () => {
    const repos = [buildRepo()];
    const result = normalizeGitHubRepos(repos);
    const candidate = result.candidates[0]!;

    // Validate all required CatalogSourceCandidate fields are present
    expect(typeof candidate.source_name).toBe('string');
    expect(typeof candidate.tool_kind).toBe('string');
    expect(candidate.github_repo_id).toBeDefined();
    expect(candidate.github_repo_locator).toBeDefined();
    expect(candidate.fields).toBeDefined();
  });
});
