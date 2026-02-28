import type { RetrievalDocument, SemanticRetriever } from './hybrid-retrieval.js';
import type { EmbeddingProvider } from './embedding-provider.js';

export interface QdrantSemanticRetrieverOptions {
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingProvider: EmbeddingProvider;
  fetchImpl?: typeof fetch;
}

interface QdrantPoint {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeSimilarityScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = value < 0 ? (value + 1) / 2 : value;
  if (normalized <= 0) {
    return 0;
  }
  if (normalized >= 1) {
    return 1;
  }

  return normalized;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toTextFromPayload(payload: Record<string, unknown>, fallbackId: string): string {
  const directText = payload.text;
  if (typeof directText === 'string' && directText.trim().length > 0) {
    return directText;
  }

  const name = payload.name;
  if (typeof name === 'string' && name.trim().length > 0) {
    return name;
  }

  const packageSlug = payload.package_slug;
  if (typeof packageSlug === 'string' && packageSlug.trim().length > 0) {
    return packageSlug;
  }

  return fallbackId;
}

function toPackageIdMetadata(payload: Record<string, unknown>, fallbackId: string): string {
  const packageId = payload.package_id;
  if (typeof packageId === 'string' && packageId.trim().length > 0) {
    return packageId;
  }

  return fallbackId;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function parseQdrantPoints(payload: unknown): QdrantPoint[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('qdrant_semantic_response_invalid: body must be an object');
  }

  const root = payload as Record<string, unknown>;
  const resultRaw = root.result;
  const result =
    Array.isArray(resultRaw)
      ? resultRaw
      : typeof resultRaw === 'object' &&
          resultRaw !== null &&
          !Array.isArray(resultRaw) &&
          Array.isArray((resultRaw as Record<string, unknown>).points)
        ? ((resultRaw as Record<string, unknown>).points as unknown[])
        : null;

  if (!result) {
    throw new Error('qdrant_semantic_response_invalid: result must be an array');
  }

  const points: QdrantPoint[] = [];

  for (const entry of result) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const idRaw = row.id;
    const scoreRaw = row.score;

    const id =
      typeof idRaw === 'string'
        ? idRaw
        : typeof idRaw === 'number' && Number.isFinite(idRaw)
          ? String(idRaw)
          : null;

    if (!id || typeof scoreRaw !== 'number' || !Number.isFinite(scoreRaw)) {
      continue;
    }

    points.push({
      id,
      score: scoreRaw,
      payload: asRecord(row.payload)
    });
  }

  return points;
}

async function queryQdrant(
  fetchImpl: typeof fetch,
  baseUrl: string,
  collection: string,
  apiKey: string,
  vector: number[],
  limit: number
): Promise<QdrantPoint[]> {
  const headers = {
    'content-type': 'application/json',
    'api-key': apiKey
  };

  const requestBody = {
    query: vector,
    limit,
    with_payload: true,
    with_vector: false
  };

  const queryUrl = `${baseUrl}/collections/${encodeURIComponent(collection)}/points/query`;
  const queryResponse = await fetchImpl(queryUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });

  if (queryResponse.ok) {
    return parseQdrantPoints(await queryResponse.json());
  }

  if (queryResponse.status !== 404) {
    throw new Error(`qdrant_semantic_query_failed:status=${queryResponse.status}`);
  }

  const legacyUrl = `${baseUrl}/collections/${encodeURIComponent(collection)}/points/search`;
  const legacyResponse = await fetchImpl(legacyUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true,
      with_vector: false
    })
  });

  if (!legacyResponse.ok) {
    throw new Error(`qdrant_semantic_query_failed:status=${legacyResponse.status}`);
  }

  return parseQdrantPoints(await legacyResponse.json());
}

export function createQdrantSemanticRetriever(
  options: QdrantSemanticRetrieverOptions
): SemanticRetriever {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.qdrantUrl);

  return {
    async search(query: string, limit: number): Promise<Array<RetrievalDocument & { semantic_score: number }>> {
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0) {
        return [];
      }

      const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));

      const embedding = await options.embeddingProvider.embed({
        model: options.embeddingModel,
        text: normalizedQuery,
        dimensions: options.embeddingDimensions
      });

      const points = await queryQdrant(
        fetchImpl,
        baseUrl,
        options.qdrantCollection,
        options.qdrantApiKey,
        embedding,
        safeLimit
      );

      const ranked = points
        .map((point) => {
          const semanticScore = roundScore(normalizeSimilarityScore(point.score));
          const packageId = toPackageIdMetadata(point.payload, point.id);

          return {
            id: point.id,
            text: toTextFromPayload(point.payload, point.id),
            metadata: {
              package_id: packageId,
              qdrant_id: point.id
            },
            semantic_score: semanticScore
          } satisfies RetrievalDocument & { semantic_score: number };
        })
        .sort((left, right) => {
          const delta = right.semantic_score - left.semantic_score;
          if (delta !== 0) {
            return delta;
          }
          return left.id.localeCompare(right.id);
        })
        .slice(0, safeLimit);

      return ranked;
    }
  };
}
