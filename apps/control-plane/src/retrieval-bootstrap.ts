import process from 'node:process';
import {
  createQdrantHttpCollectionInspector,
  startRetrievalSearchService,
  type RetrievalSearchService,
  type RetrievalStartupLogger
} from '@forge/ranking/retrieval-service';
import { createPostgresBm25Retriever } from '@forge/ranking/postgres-bm25-retriever';
import { createQdrantSemanticRetriever } from '@forge/ranking/qdrant-semantic-retriever';
import { createOpenAiEmbeddingProvider } from '@forge/ranking/embedding-provider';

export type ControlPlaneRetrievalBootstrapEnv = Readonly<Record<string, string | undefined>>;

export interface RetrievalBootstrapQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface StartControlPlaneRetrievalSearchServiceOptions {
  env?: ControlPlaneRetrievalBootstrapEnv;
  db: RetrievalBootstrapQueryExecutor;
  logger?: RetrievalStartupLogger;
  embeddingFetchImpl?: typeof fetch;
  qdrantFetchImpl?: typeof fetch;
}

function parseEmbeddingDimensions(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function resolveEmbeddingApiKey(env: ControlPlaneRetrievalBootstrapEnv): string {
  const key = env.EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'retrieval_config_invalid: EMBEDDING_API_KEY or OPENAI_API_KEY is required'
    );
  }

  return key;
}

export async function startControlPlaneRetrievalSearchService(
  options: StartControlPlaneRetrievalSearchServiceOptions
): Promise<RetrievalSearchService> {
  const env: ControlPlaneRetrievalBootstrapEnv = options.env ?? process.env;

  const embeddingApiKey = resolveEmbeddingApiKey(env);
  const qdrantUrl = env.QDRANT_URL?.trim() ?? '';
  const qdrantApiKey = env.QDRANT_API_KEY?.trim() ?? '';
  const qdrantCollection = env.QDRANT_COLLECTION?.trim() ?? '';
  const embeddingModel = env.EMBEDDING_MODEL?.trim() ?? '';
  const embeddingDimensions = parseEmbeddingDimensions(env.EMBEDDING_DIMENSIONS);

  const embeddingProvider = createOpenAiEmbeddingProvider({
    apiKey: embeddingApiKey,
    ...(env.EMBEDDING_API_BASE_URL?.trim()
      ? {
          baseUrl: env.EMBEDDING_API_BASE_URL.trim()
        }
      : {}),
    ...(options.embeddingFetchImpl ? { fetchImpl: options.embeddingFetchImpl } : {})
  });

  return startRetrievalSearchService({
    env: {
      ...(qdrantUrl ? { QDRANT_URL: qdrantUrl } : {}),
      ...(qdrantApiKey ? { QDRANT_API_KEY: qdrantApiKey } : {}),
      ...(qdrantCollection ? { QDRANT_COLLECTION: qdrantCollection } : {}),
      ...(embeddingModel ? { EMBEDDING_MODEL: embeddingModel } : {}),
      ...(env.EMBEDDING_DIMENSIONS?.trim()
        ? { EMBEDDING_DIMENSIONS: env.EMBEDDING_DIMENSIONS.trim() }
        : {})
    },
    inspector: createQdrantHttpCollectionInspector({
      qdrantUrl,
      qdrantApiKey,
      ...(options.qdrantFetchImpl ? { fetchImpl: options.qdrantFetchImpl } : {})
    }),
    bm25: createPostgresBm25Retriever({
      db: options.db
    }),
    semantic: createQdrantSemanticRetriever({
      qdrantUrl,
      qdrantApiKey,
      qdrantCollection,
      embeddingModel,
      embeddingDimensions,
      embeddingProvider,
      ...(options.qdrantFetchImpl ? { fetchImpl: options.qdrantFetchImpl } : {})
    }),
    ...(options.logger ? { logger: options.logger } : {})
  });
}
