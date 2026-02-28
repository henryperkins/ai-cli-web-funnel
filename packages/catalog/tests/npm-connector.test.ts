import { describe, expect, it } from 'vitest';
import { normalizeNpmPackages, type NpmPackageMetadata } from '../src/sources/npm-connector.js';

function buildPackage(overrides?: Partial<NpmPackageMetadata>): NpmPackageMetadata {
  return {
    name: '@acme/forge-mcp',
    description: 'Forge MCP package',
    homepage: 'https://acme.dev/forge-mcp',
    repository: {
      type: 'git',
      url: 'git+https://github.com/acme/forge-mcp.git'
    },
    keywords: ['mcp', 'forge', 'cli'],
    time: {
      modified: '2026-02-28T10:00:00Z'
    },
    'dist-tags': {
      latest: '1.2.3'
    },
    _downloads: 1234,
    ...overrides
  };
}

describe('npm connector normalization', () => {
  it('normalizes npm package metadata into catalog candidates', () => {
    const result = normalizeNpmPackages([buildPackage()]);

    expect(result.skipped).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0]!;
    expect(candidate.source_name).toBe('npm');
    expect(candidate.registry_package_locator).toBe('https://registry.npmjs.org/%40acme%2Fforge-mcp');
    expect(candidate.github_repo_locator).toBe('https://github.com/acme/forge-mcp');
    expect(candidate.canonical_repo).toBe('github.com/acme/forge-mcp');
    expect(candidate.package_slug).toBe('@acme/forge-mcp');
    expect(candidate.source_updated_at).toBe('2026-02-28T10:00:00.000Z');

    expect(candidate.fields).toMatchObject({
      name: '@acme/forge-mcp',
      description: 'Forge MCP package',
      latestVersion: '1.2.3',
      downloads: 1234,
      installCommand: 'npm install @acme/forge-mcp',
      runtimeRequirements: {
        registry: 'npm',
        package_manager: 'npm'
      }
    });
  });

  it('supports git@github.com repository format', () => {
    const result = normalizeNpmPackages([
      buildPackage({
        repository: 'git@github.com:acme/forge-mcp.git'
      })
    ]);

    expect(result.candidates[0]?.github_repo_locator).toBe('https://github.com/acme/forge-mcp');
  });

  it('deduplicates/sorts keywords and omits invalid fields', () => {
    const result = normalizeNpmPackages([
      buildPackage({
        keywords: ['Beta', 'alpha', 'beta', 'ALPHA'],
        _downloads: Number.NaN,
        repository: 'https://gitlab.com/acme/forge-mcp'
      })
    ]);

    expect(result.candidates[0]?.fields?.tags).toEqual(['alpha', 'beta']);
    expect(result.candidates[0]?.fields).not.toHaveProperty('downloads');
    expect(result.candidates[0]).not.toHaveProperty('github_repo_locator');
  });

  it('skips entries missing package names', () => {
    const result = normalizeNpmPackages([
      buildPackage({ name: 'valid-package' }),
      buildPackage({ name: undefined })
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('missing_package_name');
  });

  it('respects custom tool kind', () => {
    const result = normalizeNpmPackages([buildPackage()], { toolKind: 'plugin' });
    expect(result.candidates[0]?.tool_kind).toBe('plugin');
  });
});
