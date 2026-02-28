import {
  createHybridRetriever,
  validateHybridRetrievalConfig,
  type Bm25Retriever,
  type HybridRetrievalConfig,
  type HybridRetrievalConfigEnv,
  type QdrantCollectionInspector,
  type RetrievalSearchResult,
  type SemanticRetriever
} from './hybrid-retrieval.js';

export interface RetrievalStartupLogEvent {
  event_name:
    | 'retrieval.startup.validation_failed'
    | 'retrieval.startup.ready';
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface RetrievalStartupLogger {
  log(event: RetrievalStartupLogEvent): void | Promise<void>;
}

export interface RetrievalServiceBootstrapDependencies {
  env: HybridRetrievalConfigEnv;
  inspector: QdrantCollectionInspector;
  bm25: Bm25Retriever;
  semantic: SemanticRetriever;
  logger?: RetrievalStartupLogger;
}

export interface RetrievalSearchService {
  config: HybridRetrievalConfig;
  search(query: string, limit?: number): Promise<RetrievalSearchResult>;
}

export interface QdrantHttpCollectionInspectorOptions {
  qdrantUrl: string;
  qdrantApiKey: string;
  fetchImpl?: typeof fetch;
}

function resolveVectorSize(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('qdrant_inspection_invalid_response: response must be an object');
  }

  const root = payload as Record<string, unknown>;
  const result =
    typeof root.result === 'object' && root.result !== null && !Array.isArray(root.result)
      ? (root.result as Record<string, unknown>)
      : null;
  const config =
    result &&
    typeof result.config === 'object' &&
    result.config !== null &&
    !Array.isArray(result.config)
      ? (result.config as Record<string, unknown>)
      : null;
  const params =
    config &&
    typeof config.params === 'object' &&
    config.params !== null &&
    !Array.isArray(config.params)
      ? (config.params as Record<string, unknown>)
      : null;
  const vectors = params?.vectors;

  if (typeof vectors === 'object' && vectors !== null && !Array.isArray(vectors)) {
    const vectorsRecord = vectors as Record<string, unknown>;
    if (typeof vectorsRecord.size === 'number' && Number.isFinite(vectorsRecord.size)) {
      return vectorsRecord.size;
    }

    const firstVector = Object.values(vectorsRecord).find(
      (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    ) as Record<string, unknown> | undefined;

    if (
      firstVector &&
      typeof firstVector.size === 'number' &&
      Number.isFinite(firstVector.size)
    ) {
      return firstVector.size;
    }
  }

  throw new Error('qdrant_inspection_invalid_response: missing vectors size');
}

export function createQdrantHttpCollectionInspector(
  options: QdrantHttpCollectionInspectorOptions
): QdrantCollectionInspector {
  const baseUrl = options.qdrantUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async getVectorSize(collectionName: string): Promise<number> {
      const response = await fetchImpl(
        `${baseUrl}/collections/${encodeURIComponent(collectionName)}`,
        {
          method: 'GET',
          headers: {
            'api-key': options.qdrantApiKey
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          `qdrant_inspection_failed: status=${response.status} collection=${collectionName}`
        );
      }

      const body = await response.json();
      return resolveVectorSize(body);
    }
  };
}

export async function startRetrievalSearchService(
  dependencies: RetrievalServiceBootstrapDependencies
): Promise<RetrievalSearchService> {
  let config: HybridRetrievalConfig;
  try {
    config = await validateHybridRetrievalConfig(dependencies.env, dependencies.inspector);
  } catch (error) {
    if (dependencies.logger) {
      await dependencies.logger.log({
        event_name: 'retrieval.startup.validation_failed',
        occurred_at: new Date().toISOString(),
        payload: {
          qdrant_collection: dependencies.env.QDRANT_COLLECTION ?? null,
          embedding_model: dependencies.env.EMBEDDING_MODEL ?? null,
          reason: error instanceof Error ? error.message : 'unknown_error'
        }
      });
    }
    throw error;
  }

  const retriever = createHybridRetriever({
    bm25: dependencies.bm25,
    semantic: dependencies.semantic
  });

  if (dependencies.logger) {
    await dependencies.logger.log({
      event_name: 'retrieval.startup.ready',
      occurred_at: new Date().toISOString(),
      payload: {
        qdrant_collection: config.qdrantCollection,
        embedding_model: config.embeddingModel,
        embedding_dimensions: config.embeddingDimensions
      }
    });
  }

  return {
    config,
    async search(query: string, limit = 10): Promise<RetrievalSearchResult> {
      return retriever.search(query, limit);
    }
  };
}
