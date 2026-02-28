import { describe, expect, it } from 'vitest';
import { createCatalogIngestService, type CatalogIngestInput } from '../src/index.js';
import { normalizeNpmPackages } from '../src/sources/npm-connector.js';
import { normalizePyPiProjects } from '../src/sources/pypi-connector.js';

describe('npm/pypi connectors -> catalog ingest pipeline', () => {
  it('ingests deterministic multi-source candidates with lineage and identity', () => {
    const npmNormalized = normalizeNpmPackages([
      {
        name: '@acme/forge-addon',
        description: 'Forge addon from npm',
        repository: 'git+https://github.com/acme/forge-addon.git',
        keywords: ['forge', 'addon', 'mcp'],
        time: {
          modified: '2026-03-02T10:00:00Z'
        },
        'dist-tags': {
          latest: '2.1.0'
        },
        _downloads: 1200
      }
    ]);

    const pypiNormalized = normalizePyPiProjects([
      {
        info: {
          name: 'forge-addon',
          summary: 'Forge addon from pypi',
          project_urls: {
            Source: 'https://github.com/acme/forge-addon'
          },
          keywords: 'forge addon python',
          version: '2.1.0',
          requires_python: '>=3.10',
          downloads: {
            last_month: 900
          }
        },
        releases: {
          '2.1.0': [
            {
              upload_time_iso_8601: '2026-03-02T11:00:00Z'
            }
          ]
        }
      }
    ]);

    const service = createCatalogIngestService();
    const input: CatalogIngestInput = {
      merge_run_id: 'registry-baseline-001',
      occurred_at: '2026-03-02T12:00:00Z',
      source_snapshot: {
        source: 'registry-baseline',
        sources: ['npm', 'pypi']
      },
      detected_by: 'registry-connectors',
      candidates: [...npmNormalized.candidates, ...pypiNormalized.candidates]
    };

    const result = service.ingest(input);

    expect(result.requires_manual_review).toBe(false);
    expect(result.resolution_path).toBe('github_locator');
    expect(result.package_candidate).not.toBeNull();
    expect(result.package_candidate?.package_slug).toBe('@acme/forge-addon');
    expect(result.package_candidate?.canonical_repo).toBe('github.com/acme/forge-addon');

    const downloadsLineage = result.field_lineage.find((entry) => entry.field_name === 'downloads');
    expect(downloadsLineage?.field_source).toBe('npm');

    const runtimeLineage = result.field_lineage.find(
      (entry) => entry.field_name === 'runtimeRequirements'
    );
    expect(runtimeLineage).toBeDefined();
    expect(['npm', 'pypi']).toContain(runtimeLineage?.field_source);
  });
});
