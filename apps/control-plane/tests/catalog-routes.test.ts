import { describe, expect, it } from 'vitest';
import { createCatalogRouteService } from '../src/catalog-routes.js';

describe('catalog routes search actions', () => {
  it('returns dual actions for browse and install on search results', async () => {
    const service = createCatalogRouteService({
      catalog: {
        async listPackages() {
          return [];
        },
        async getPackage() {
          return null;
        },
        async searchPackages() {
          return [
            {
              package_id: '11111111-1111-4111-8111-111111111111',
              package_slug: 'acme/catalog-addon',
              canonical_repo: 'github.com/acme/catalog-addon',
              updated_at: '2026-03-01T00:00:00Z'
            },
            {
              package_id: '22222222-2222-4222-8222-222222222222',
              package_slug: null,
              canonical_repo: null,
              updated_at: '2026-03-01T00:00:00Z'
            }
          ];
        },
        async persistIngestResult() {
          return {
            merge_run_id: 'merge-run-1',
            package_id: null,
            queued_conflicts: 0
          };
        }
      },
      retrieval: {
        async search() {
          return {
            documents: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                text: 'catalog addon',
                metadata: {
                  package_id: '11111111-1111-4111-8111-111111111111'
                },
                bm25_score: 0.6,
                semantic_score: 0.6,
                fused_score: 0.6
              }
            ],
            semantic_fallback: false
          };
        },
        config: {
          embeddingModel: 'text-embedding-3-large',
          qdrantCollection: 'forge-packages'
        }
      }
    });

    const response = await service.searchPackages({
      query: 'catalog'
    });

    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toMatchObject({
      package_id: '11111111-1111-4111-8111-111111111111',
      package_slug: 'acme/catalog-addon',
      canonical_repo: 'github.com/acme/catalog-addon'
    });
    expect(Object.keys(response.results[0]!.actions).sort()).toEqual([
      'open_in_vscode',
      'view_on_github'
    ]);
    expect(response.results[0]?.actions.view_on_github).toEqual({
      label: 'View on GitHub',
      href: 'https://github.com/acme/catalog-addon'
    });
    expect(response.results[0]?.actions.open_in_vscode).toEqual({
      label: 'Open in VS Code',
      uri: 'vscode://forge.install?package_id=11111111-1111-4111-8111-111111111111&package_slug=acme%2Fcatalog-addon',
      fallback: {
        install_plan_path: '/v1/install/plans',
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/catalog-addon'
      }
    });
    expect(response.results[1]?.actions.view_on_github.href).toBe(null);
    expect(response.results[1]?.actions.open_in_vscode.uri).toBe(
      'vscode://forge.install?package_id=22222222-2222-4222-8222-222222222222'
    );
  });
});
