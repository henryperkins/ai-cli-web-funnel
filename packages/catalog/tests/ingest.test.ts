import { describe, expect, it } from 'vitest';
import { createCatalogIngestService, type CatalogIngestInput } from '../src/index.js';

function buildBaseInput(): CatalogIngestInput {
  return {
    merge_run_id: 'merge-run-001',
    occurred_at: '2026-03-01T10:00:00Z',
    source_snapshot: {
      run: 'ingest-1'
    },
    candidates: [
      {
        source_name: 'github',
        source_updated_at: '2026-02-28T08:00:00Z',
        github_repo_id: 4242,
        github_repo_locator: 'https://github.com/acme/forge-addon',
        tool_kind: 'mcp',
        package_slug: 'acme/forge-addon',
        fields: {
          name: 'Forge Addon (GitHub)',
          description: 'description from github',
          lastUpdated: '2026-02-28T08:00:00Z'
        }
      },
      {
        source_name: 'smithery',
        source_updated_at: '2026-02-28T09:00:00Z',
        github_repo_locator: 'https://github.com/acme/forge-addon',
        tool_kind: 'mcp',
        package_slug: 'acme/forge-addon-smithery',
        fields: {
          name: 'Forge Addon (Smithery)',
          description: 'description from smithery',
          tags: ['productivity', 'mcp', 'mcp'],
          lastUpdated: '2026-02-28T07:00:00Z'
        },
        aliases: [
          {
            alias_type: 'registry_alias',
            alias_value: '@acme/forge-addon'
          }
        ]
      }
    ]
  };
}

describe('catalog ingest domain', () => {
  it('resolves identity and merge lineage deterministically', () => {
    const service = createCatalogIngestService();
    const input = buildBaseInput();

    const result = service.ingest(input);

    expect(result.requires_manual_review).toBe(false);
    expect(result.resolution_path).toBe('canonical_repo_id');
    expect(result.package_candidate?.package_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(result.package_candidate?.package_slug).toBe('acme/forge-addon-smithery');
    expect(result.package_candidate?.canonical_repo).toBe('github.com/acme/forge-addon');

    const descriptionLineage = result.field_lineage.find(
      (lineage) => lineage.field_name === 'description'
    );
    expect(descriptionLineage?.field_source).toBe('smithery');
    expect(descriptionLineage?.field_value_json).toBe('description from smithery');

    const lastUpdatedLineage = result.field_lineage.find(
      (lineage) => lineage.field_name === 'lastUpdated'
    );
    expect(lastUpdatedLineage?.field_source).toBe('smithery');

    const tagsLineage = result.field_lineage.find((lineage) => lineage.field_name === 'tags');
    expect(tagsLineage?.field_source).toBe('union');
    expect(tagsLineage?.field_value_json).toEqual(['mcp', 'productivity']);
  });

  it('routes unmapped registry identities to manual review conflicts', () => {
    const service = createCatalogIngestService();

    const input: CatalogIngestInput = {
      merge_run_id: 'merge-run-manual',
      occurred_at: '2026-03-01T10:00:00Z',
      candidates: [
        {
          source_name: 'registry',
          source_updated_at: '2026-03-01T09:00:00Z',
          registry_package_locator: 'https://registry.npmjs.org/@acme/unknown-addon',
          tool_kind: 'mcp'
        }
      ]
    };

    const first = service.ingest(input);
    const second = service.ingest(input);

    expect(first.requires_manual_review).toBe(true);
    expect(first.package_candidate).toBeNull();
    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts[0]?.status).toBe('open');
    expect(first.conflicts[0]?.review_due_at).toBe('2026-03-03T10:00:00.000Z');

    expect(first.conflicts[0]?.conflict_fingerprint).toBe(
      second.conflicts[0]?.conflict_fingerprint
    );
  });

  it('is rerun-safe for identical merge run inputs', () => {
    const service = createCatalogIngestService();
    const input = buildBaseInput();

    const first = service.ingest(input);
    const second = service.ingest(input);

    expect(second).toEqual(first);
  });
});
