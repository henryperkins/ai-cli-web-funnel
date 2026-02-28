import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCatalogIngestService, type CatalogIngestInput } from '../src/index.js';
import { normalizeGitHubRepos, type GitHubRepoMetadata } from '../src/sources/github-connector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(): GitHubRepoMetadata[] {
  const raw = readFileSync(resolve(__dirname, 'fixtures/github-repos.json'), 'utf8');
  return JSON.parse(raw) as GitHubRepoMetadata[];
}

describe('github connector → catalog ingest pipeline', () => {
  it('normalizes fixture repos and ingests deterministically', () => {
    const repos = loadFixture();
    const { candidates, skipped } = normalizeGitHubRepos(repos);

    expect(candidates).toHaveLength(2);
    expect(skipped).toHaveLength(2);

    const service = createCatalogIngestService();
    const input: CatalogIngestInput = {
      merge_run_id: 'github-fixture-001',
      occurred_at: '2026-03-01T12:00:00Z',
      source_snapshot: { source: 'github', fixture: true },
      detected_by: 'github-connector',
      candidates
    };

    const result = service.ingest(input);
    expect(result.merge_run_id).toBe('github-fixture-001');
    expect(result.requires_manual_review).toBe(false);
    expect(result.resolution_path).toBe('canonical_repo_id');
    expect(result.package_candidate).not.toBeNull();
    expect(result.package_candidate!.canonical_repo).toBe(
      'github.com/modelcontextprotocol/servers'
    );
  });

  it('produces stable output across repeated runs', () => {
    const repos = loadFixture();
    const { candidates } = normalizeGitHubRepos(repos);

    const service = createCatalogIngestService();
    const input: CatalogIngestInput = {
      merge_run_id: 'github-replay-001',
      occurred_at: '2026-03-01T12:00:00Z',
      source_snapshot: { source: 'github', fixture: true },
      detected_by: 'github-connector',
      candidates
    };

    const first = service.ingest(input);
    const second = service.ingest(input);

    expect(first.package_candidate!.package_id).toBe(second.package_candidate!.package_id);
    expect(first.package_candidate!.package_slug).toBe(second.package_candidate!.package_slug);
    expect(first.field_lineage.length).toBe(second.field_lineage.length);
    expect(first.resolution_path).toBe(second.resolution_path);
  });

  it('field lineage tracks github as source', () => {
    const repos = loadFixture();
    const { candidates } = normalizeGitHubRepos(repos);

    const service = createCatalogIngestService();
    const result = service.ingest({
      merge_run_id: 'github-lineage-001',
      occurred_at: '2026-03-01T12:00:00Z',
      source_snapshot: {},
      candidates
    });

    const descriptionLineage = result.field_lineage.find((l) => l.field_name === 'description');
    expect(descriptionLineage).toBeDefined();
    expect(descriptionLineage!.field_source).toBe('github');
  });
});
