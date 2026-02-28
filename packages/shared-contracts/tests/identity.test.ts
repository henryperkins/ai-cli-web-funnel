import { describe, expect, it } from 'vitest';
import {
  buildCanonicalLocator,
  buildProvisionalLocator,
  buildIdentityConflictRecord,
  createPackageIdentity,
  normalizeGithubRepoLocator,
  promoteProvisionalIdentity,
  resolvePackageIdentity
} from '../src/identity.js';

describe('package identity', () => {
  it('generates deterministic canonical package ids', () => {
    const input = {
      githubRepoId: 123456,
      subpath: 'tools/server',
      toolKind: 'mcp' as const,
      primaryRegistryName: 'smithery'
    };

    const first = createPackageIdentity(input);
    const second = createPackageIdentity(input);

    expect(first.packageId).toBe(second.packageId);
    expect(first.identityState).toBe('canonical');
    expect(first.canonicalLocator).toBe('123456:tools/server:mcp:smithery');
  });

  it('keeps package id stable across repo rename when repo id is unchanged', () => {
    const first = createPackageIdentity({
      githubRepoId: 42,
      githubRepoLocator: 'https://github.com/org/repo-old',
      subpath: 'root',
      toolKind: 'mcp',
      primaryRegistryName: 'none'
    });

    const second = createPackageIdentity({
      githubRepoId: 42,
      githubRepoLocator: 'https://github.com/org/repo-new',
      subpath: 'root',
      toolKind: 'mcp',
      primaryRegistryName: 'none'
    });

    expect(first.packageId).toBe(second.packageId);
  });

  it('generates different ids for forked repositories with different repo ids', () => {
    const first = createPackageIdentity({
      githubRepoId: 500,
      subpath: 'root',
      toolKind: 'mcp',
      primaryRegistryName: 'none'
    });

    const second = createPackageIdentity({
      githubRepoId: 501,
      subpath: 'root',
      toolKind: 'mcp',
      primaryRegistryName: 'none'
    });

    expect(first.packageId).not.toBe(second.packageId);
  });

  it('generates different ids for monorepo subpaths', () => {
    const first = createPackageIdentity({
      githubRepoId: 900,
      subpath: 'packages/server-a',
      toolKind: 'mcp',
      primaryRegistryName: 'none'
    });

    const second = createPackageIdentity({
      githubRepoId: 900,
      subpath: 'packages/server-b',
      toolKind: 'mcp',
      primaryRegistryName: 'none'
    });

    expect(first.packageId).not.toBe(second.packageId);
  });

  it('uses provisional identity when authoritative repo id is unavailable', () => {
    const result = createPackageIdentity({
      githubRepoLocator: 'https://github.com/Acme/My-Repo',
      subpath: '/',
      toolKind: 'skill'
    });

    expect(result.identityState).toBe('provisional');
    expect(result.canonicalLocator).toBe('github.com/acme/my-repo:root:skill:none');
  });

  it('resolves provisional identity through registry mapping fallback', () => {
    const resolved = resolvePackageIdentity(
      {
        registryPackageLocator: 'https://registry.npmjs.org/@acme/forge-tool',
        toolKind: 'mcp',
        subpath: '/'
      },
      {
        registryToGithubMap: {
          'registry.npmjs.org/@acme/forge-tool': 'https://github.com/acme/forge-tool'
        }
      }
    );

    if (resolved.requiresManualReview) {
      throw new Error('Expected resolved identity path from registry mapping.');
    }

    expect(resolved.resolutionPath).toBe('registry_map');
    expect(resolved.identityState).toBe('provisional');
    expect(resolved.locatorInputs.registryPackageLocator).toBe('registry.npmjs.org/@acme/forge-tool');
    expect(resolved.canonicalLocator).toBe('github.com/acme/forge-tool:root:mcp:none');
  });

  it('routes unmapped registry locator to manual review queue payload', () => {
    const resolved = resolvePackageIdentity({
      registryPackageLocator: 'https://registry.npmjs.org/@acme/unknown-tool',
      toolKind: 'mcp',
      subpath: 'root'
    });

    expect(resolved.requiresManualReview).toBe(true);
    if (!resolved.requiresManualReview) {
      throw new Error('Expected manual review response.');
    }

    expect(resolved.reason).toBe('unmapped_registry_locator');
    expect(resolved.conflictFingerprint).toMatch(/^[0-9a-f]{32}$/);

    const conflictRecord = buildIdentityConflictRecord(resolved);
    expect(conflictRecord.status).toBe('open');
    expect(conflictRecord.canonicalLocatorCandidate).toContain('registry.npmjs.org/@acme/unknown-tool');
  });

  it('promotes provisional identity to canonical when github repo id is resolved', () => {
    const provisional = createPackageIdentity({
      githubRepoLocator: 'https://github.com/acme/forge-tool',
      subpath: 'root',
      toolKind: 'mcp'
    });

    const promoted = promoteProvisionalIdentity(provisional, 7777);

    expect(promoted.identityState).toBe('canonical');
    expect(promoted.canonicalLocator).toBe('7777:root:mcp:none');
    expect(promoted.packageId).not.toBe(provisional.packageId);
  });

  it('normalizes canonical and provisional locators', () => {
    expect(
      buildCanonicalLocator({
        githubRepoId: '123',
        subpath: '/TOOLS/API/',
        toolKind: 'plugin',
        primaryRegistryName: 'NPM'
      })
    ).toBe('123:tools/api:plugin:npm');

    expect(
      buildProvisionalLocator({
        githubRepoLocator: 'github.com/Org/Repo',
        subpath: '/x/',
        toolKind: 'prompt'
      })
    ).toBe('github.com/org/repo:x:prompt:none');

    expect(normalizeGithubRepoLocator('https://github.com/Org/Repo.git')).toBe('github.com/org/repo');
  });
});
