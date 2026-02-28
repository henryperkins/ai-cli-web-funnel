import { describe, expect, it, vi } from 'vitest';
import {
  DocsSourceInaccessibleError,
  DocsSourceInvalidError,
  DocsSourceTimeoutError,
  fetchDocsSources,
  normalizeDocsSources,
  runDocsConnector,
  type DocsSourceInput
} from '../src/sources/docs-connector.js';

function buildDoc(overrides: Partial<DocsSourceInput> = {}): DocsSourceInput {
  return {
    url: 'https://docs.example.com/addons/acme-addon',
    title: 'Acme Addon',
    summary: 'Deterministic docs ingestion for Acme',
    content: '# Acme Addon\nInstall details.',
    updated_at: '2026-02-27T10:00:00Z',
    tags: ['CLI', 'MCP', 'cli'],
    package_slug: 'acme-addon',
    source_name: 'docs',
    tool_kind: 'mcp',
    install_command: 'forge install acme-addon',
    aliases: ['https://acme.example.com/docs/addon'],
    ...overrides
  };
}

describe('docs connector normalization', () => {
  it('normalizes docs inputs into deterministic source candidates', () => {
    const normalized = normalizeDocsSources([
      buildDoc(),
      buildDoc({
        url: 'https://docs.example.com/addons/zeta-addon',
        title: 'Zeta Addon',
        package_slug: 'zeta-addon',
        tags: ['zeta', 'docs']
      })
    ]);

    expect(normalized.skipped).toEqual([]);
    expect(normalized.candidates).toHaveLength(2);

    expect(normalized.candidates[0]).toMatchObject({
      source_name: 'docs',
      registry_package_locator: 'https://docs.example.com/addons/acme-addon',
      package_slug: 'acme-addon',
      tool_kind: 'mcp'
    });

    expect(normalized.candidates[0]?.fields).toMatchObject({
      name: 'Acme Addon',
      description: 'Deterministic docs ingestion for Acme',
      installCommand: 'forge install acme-addon'
    });

    expect(normalized.candidates[0]?.fields?.tags).toEqual(['cli', 'mcp']);
  });

  it('skips docs that are missing url or content payload', () => {
    const normalized = normalizeDocsSources([
      buildDoc({ url: null }),
      buildDoc({ url: 'https://docs.example.com/no-content', summary: null, content: null })
    ]);

    expect(normalized.candidates).toHaveLength(0);
    expect(normalized.skipped).toEqual([
      { url: '', reason: 'missing_url' },
      {
        url: 'https://docs.example.com/no-content',
        reason: 'missing_content'
      }
    ]);
  });

  it('uses deterministic sorting by URL then title', () => {
    const normalized = normalizeDocsSources([
      buildDoc({ url: 'https://docs.example.com/b', title: 'B' }),
      buildDoc({ url: 'https://docs.example.com/a', title: 'A' })
    ]);

    expect(normalized.candidates.map((entry) => entry.registry_package_locator)).toEqual([
      'https://docs.example.com/a',
      'https://docs.example.com/b'
    ]);
  });
});

describe('docs connector failure taxonomy', () => {
  it('maps HTTP failures to inaccessible errors', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('not found', {
        status: 404,
        headers: {
          'content-type': 'text/plain'
        }
      })
    );

    await expect(
      fetchDocsSources(['https://docs.example.com/missing'], { fetchImpl })
    ).rejects.toBeInstanceOf(DocsSourceInaccessibleError);
  });

  it('maps aborts to timeout errors', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(
      fetchDocsSources(['https://docs.example.com/slow'], { fetchImpl, timeoutMs: 1 })
    ).rejects.toBeInstanceOf(DocsSourceTimeoutError);
  });

  it('returns invalid error when no docs input is provided', async () => {
    await expect(runDocsConnector({ docs: [], urls: [] })).rejects.toBeInstanceOf(
      DocsSourceInvalidError
    );
  });
});
