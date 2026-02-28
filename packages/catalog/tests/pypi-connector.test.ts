import { describe, expect, it } from 'vitest';
import { normalizePyPiProjects, type PyPiProjectMetadata } from '../src/sources/pypi-connector.js';

function buildProject(overrides?: Partial<PyPiProjectMetadata>): PyPiProjectMetadata {
  return {
    info: {
      name: 'forge-mcp',
      summary: 'Forge MCP Python package',
      home_page: 'https://github.com/acme/forge-mcp-py',
      project_urls: {
        Source: 'https://github.com/acme/forge-mcp-py',
        Docs: 'https://acme.dev/forge-mcp-py'
      },
      keywords: 'mcp, forge, python',
      version: '0.9.1',
      requires_python: '>=3.10',
      downloads: {
        last_month: 4567
      }
    },
    releases: {
      '0.9.1': [
        {
          upload_time_iso_8601: '2026-02-27T15:00:00Z'
        }
      ],
      '0.9.0': [
        {
          upload_time_iso_8601: '2026-02-20T10:00:00Z'
        }
      ]
    },
    ...overrides
  };
}

describe('pypi connector normalization', () => {
  it('normalizes project metadata into catalog candidates', () => {
    const result = normalizePyPiProjects([buildProject()]);

    expect(result.skipped).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0]!;
    expect(candidate.source_name).toBe('pypi');
    expect(candidate.registry_package_locator).toBe('https://pypi.org/project/forge-mcp');
    expect(candidate.github_repo_locator).toBe('https://github.com/acme/forge-mcp-py');
    expect(candidate.canonical_repo).toBe('github.com/acme/forge-mcp-py');
    expect(candidate.source_updated_at).toBe('2026-02-27T15:00:00.000Z');

    expect(candidate.fields).toMatchObject({
      name: 'forge-mcp',
      description: 'Forge MCP Python package',
      latestVersion: '0.9.1',
      downloads: 4567,
      installCommand: 'pip install forge-mcp',
      runtimeRequirements: {
        registry: 'pypi',
        package_manager: 'pip',
        requires_python: '>=3.10'
      }
    });
  });

  it('falls back to home_page when project_urls are missing', () => {
    const result = normalizePyPiProjects([
      buildProject({
        info: {
          ...buildProject().info,
          project_urls: null,
          home_page: 'https://github.com/acme/forge-mcp-py-home'
        }
      })
    ]);

    expect(result.candidates[0]?.github_repo_locator).toBe('https://github.com/acme/forge-mcp-py-home');
  });

  it('skips entries missing project names', () => {
    const result = normalizePyPiProjects([
      buildProject({ info: { ...buildProject().info, name: undefined } })
    ]);

    expect(result.candidates).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('missing_project_name');
  });

  it('respects custom tool kind', () => {
    const result = normalizePyPiProjects([buildProject()], { toolKind: 'plugin' });
    expect(result.candidates[0]?.tool_kind).toBe('plugin');
  });
});
