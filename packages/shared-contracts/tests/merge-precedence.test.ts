import { describe, expect, it } from 'vitest';
import { resolveFieldValue, resolveMergedRecord } from '../src/merge-precedence.js';

describe('merge precedence', () => {
  it('prefers higher-priority sources for display metadata', () => {
    const resolved = resolveFieldValue(
      'name',
      [
        { sourceName: 'github', sourceUpdatedAt: '2026-02-25T00:00:00Z', value: 'GitHub Name' },
        { sourceName: 'smithery', sourceUpdatedAt: '2026-02-20T00:00:00Z', value: 'Smithery Name' }
      ],
      'merge-001'
    );

    expect(resolved?.value).toBe('Smithery Name');
    expect(resolved?.fieldSource).toBe('smithery');
  });

  it('enforces owner identity precedence: github over verified partner claims', () => {
    const resolved = resolveFieldValue(
      'ownerIdentity',
      [
        { sourceName: 'verified_partner_claim', sourceUpdatedAt: '2026-02-24T00:00:00Z', value: 'partner-owner' },
        { sourceName: 'github', sourceUpdatedAt: '2026-02-20T00:00:00Z', value: 'github-owner' }
      ],
      'merge-identity-owner'
    );

    expect(resolved?.value).toBe('github-owner');
    expect(resolved?.fieldSource).toBe('github');
  });

  it('uses newest timestamp inside same precedence level', () => {
    const resolved = resolveFieldValue(
      'ratings',
      [
        { sourceName: 'mcp.so', sourceUpdatedAt: '2026-02-22T00:00:00Z', value: 4.2 },
        { sourceName: 'mcp.so', sourceUpdatedAt: '2026-02-25T00:00:00Z', value: 4.6 }
      ],
      'merge-002'
    );

    expect(resolved?.value).toBe(4.6);
  });

  it('resolves install command based on DR-004 source order', () => {
    const resolved = resolveFieldValue(
      'installCommand',
      [
        { sourceName: 'readme_parse', sourceUpdatedAt: '2026-02-20T00:00:00Z', value: 'cmd-readme' },
        { sourceName: 'registry_derived', sourceUpdatedAt: '2026-02-25T00:00:00Z', value: 'cmd-registry' }
      ],
      'merge-install-command'
    );

    expect(resolved?.value).toBe('cmd-registry');
    expect(resolved?.fieldSource).toBe('registry_derived');
  });

  it('unions tags and applies spam governance filters', () => {
    const resolved = resolveFieldValue(
      'tags',
      [
        { sourceName: 'github', sourceUpdatedAt: '2026-02-20T00:00:00Z', value: ['Security', 'MCP', 'https://spam'] },
        { sourceName: 'smithery', sourceUpdatedAt: '2026-02-21T00:00:00Z', value: ['mcp', 'tools', 'aaaaaa'] }
      ],
      'merge-004'
    );

    expect(resolved?.value).toEqual(['mcp', 'security', 'tools']);
    expect(resolved?.fieldSource).toBe('union');
  });

  it('returns deterministic output with lineage', () => {
    const input = {
      name: [
        { sourceName: 'github', sourceUpdatedAt: '2026-02-20T00:00:00Z', value: 'GitHub Name' },
        { sourceName: 'glama', sourceUpdatedAt: '2026-02-21T00:00:00Z', value: 'Glama Name' }
      ],
      downloads: [
        { sourceName: 'npm', sourceUpdatedAt: '2026-02-20T00:00:00Z', value: 100 },
        { sourceName: 'pypi', sourceUpdatedAt: '2026-02-21T00:00:00Z', value: 80 }
      ]
    };

    const first = resolveMergedRecord(input, 'merge-005');
    const second = resolveMergedRecord(input, 'merge-005');

    expect(first).toEqual(second);
    expect(first.lineage.name?.mergeRunId).toBe('merge-005');
    expect(first.resolved.name).toBe('Glama Name');
  });
});
