import { scorePackageV0, type RetrievalSearchResult } from '@forge/ranking';
import type {
  CatalogPackageDetail,
  CatalogPackageListItem,
  CatalogPostgresAdapters
} from '@forge/catalog/postgres-adapters';

export interface CatalogSearchRequest {
  query: string;
  limit?: number;
}

export interface CatalogSearchResultItem {
  package_id: string;
  package_slug: string | null;
  canonical_repo: string | null;
  updated_at: string;
  score: number;
  ranking: ReturnType<typeof scorePackageV0>['lineage'];
  actions: {
    view_on_github: {
      label: 'View on GitHub';
      href: string | null;
    };
    open_in_vscode: {
      label: 'Open in VS Code';
      uri: string;
      fallback: {
        install_plan_path: '/v1/install/plans';
        package_id: string;
        package_slug: string | null;
      };
    };
  };
}

export interface CatalogSearchResponse {
  query: string;
  semantic_fallback: boolean;
  results: CatalogSearchResultItem[];
}

export interface CatalogRouteDependencies {
  catalog: CatalogPostgresAdapters;
  retrieval?: {
    search(query: string, limit: number): Promise<RetrievalSearchResult>;
    config?: {
      embeddingModel?: string;
      qdrantCollection?: string;
    };
  };
}

interface CatalogRetrievalConfig {
  embeddingModel?: string;
  qdrantCollection?: string;
}

function normalizeGithubHref(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }

  if (trimmed.startsWith('github.com/')) {
    return `https://${trimmed}`;
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }

  return `https://${trimmed}`;
}

function buildOpenInVsCodeUri(entry: CatalogPackageListItem): string {
  const params = new URLSearchParams({
    package_id: entry.package_id
  });

  if (entry.package_slug) {
    params.set('package_slug', entry.package_slug);
  }

  return `vscode://forge.install?${params.toString()}`;
}

function computeFreshness(updatedAt: string, nowIso: string): number {
  const updatedMs = Date.parse(updatedAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(updatedMs) || Number.isNaN(nowMs) || updatedMs > nowMs) {
    return 0;
  }

  const ageDays = (nowMs - updatedMs) / (24 * 60 * 60 * 1000);
  if (ageDays <= 1) {
    return 1;
  }

  if (ageDays >= 30) {
    return 0;
  }

  return Number((1 - ageDays / 30).toFixed(6));
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return 20;
  }

  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

function toPackageIdFromRetrieval(doc: RetrievalSearchResult['documents'][number]): string | null {
  const metadataPackageId = doc.metadata?.package_id;
  if (typeof metadataPackageId === 'string' && metadataPackageId.length > 0) {
    return metadataPackageId;
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(doc.id)) {
    return doc.id;
  }

  return null;
}

function buildRankingResults(
  query: string,
  packages: CatalogPackageListItem[],
  retrievalResult: RetrievalSearchResult | null,
  retrievalConfig?: CatalogRetrievalConfig
): CatalogSearchResponse {
  const nowIso = new Date().toISOString();

  const retrievalScores = new Map<string, number>();
  if (retrievalResult) {
    for (const doc of retrievalResult.documents) {
      const packageId = toPackageIdFromRetrieval(doc);
      if (!packageId) {
        continue;
      }
      retrievalScores.set(packageId, doc.fused_score);
    }
  }

  const semanticFallback = retrievalResult ? retrievalResult.semantic_fallback : true;

  const ranked = packages
    .map((entry) => {
      const queryRelevance = retrievalScores.get(entry.package_id) ?? 0.25;
      const ranking = scorePackageV0({
        package_id: entry.package_id,
        query,
        query_relevance: queryRelevance,
        freshness: computeFreshness(entry.updated_at, nowIso),
        popularity: 0.5,
        ctr: 0,
        action_rate: 0,
        cold_start_prior: 0.4,
        impressions_7d: 0,
        embedding_model_version: retrievalConfig?.embeddingModel ?? 'not_configured',
        vector_collection_version: retrievalConfig?.qdrantCollection ?? 'not_configured',
        semantic_fallback: semanticFallback
      });

      return {
        package_id: entry.package_id,
        package_slug: entry.package_slug,
        canonical_repo: entry.canonical_repo,
        updated_at: entry.updated_at,
        score: ranking.score,
        ranking: ranking.lineage,
        actions: {
          view_on_github: {
            label: 'View on GitHub',
            href: normalizeGithubHref(entry.canonical_repo)
          },
          open_in_vscode: {
            label: 'Open in VS Code',
            uri: buildOpenInVsCodeUri(entry),
            fallback: {
              install_plan_path: '/v1/install/plans',
              package_id: entry.package_id,
              package_slug: entry.package_slug
            }
          }
        }
      } satisfies CatalogSearchResultItem;
    })
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.package_id.localeCompare(right.package_id);
    });

  return {
    query,
    semantic_fallback: semanticFallback,
    results: ranked
  };
}

export function createCatalogRouteService(dependencies: CatalogRouteDependencies) {
  return {
    async listPackages(limit = 20, offset = 0): Promise<CatalogPackageListItem[]> {
      return dependencies.catalog.listPackages(normalizeLimit(limit), Math.max(0, offset));
    },

    async getPackage(packageId: string): Promise<CatalogPackageDetail | null> {
      return dependencies.catalog.getPackage(packageId);
    },

    async searchPackages(request: CatalogSearchRequest): Promise<CatalogSearchResponse> {
      const query = request.query.trim();
      const limit = normalizeLimit(request.limit);

      const packages = await dependencies.catalog.searchPackages(query, limit);
      const retrievalResult = dependencies.retrieval
        ? await dependencies.retrieval.search(query, limit)
        : null;

      return buildRankingResults(query, packages, retrievalResult, dependencies.retrieval?.config);
    }
  };
}
