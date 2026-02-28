export interface RetrievalDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievalScoredDocument extends RetrievalDocument {
  bm25_score: number;
  semantic_score: number;
  fused_score: number;
}

export interface RetrievalSearchResult {
  documents: RetrievalScoredDocument[];
  semantic_fallback: boolean;
}

export interface HybridRetrievalConfig {
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface HybridRetrievalConfigEnv {
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  QDRANT_COLLECTION?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: string;
}

export interface QdrantCollectionInspector {
  getVectorSize(collectionName: string): Promise<number>;
}

export interface Bm25Retriever {
  search(
    query: string,
    limit: number
  ): Promise<Array<RetrievalDocument & { bm25_score: number }>>;
}

export interface SemanticRetriever {
  search(
    query: string,
    limit: number
  ): Promise<Array<RetrievalDocument & { semantic_score: number }>>;
}

export interface HybridRetrieverDependencies {
  bm25: Bm25Retriever;
  semantic: SemanticRetriever;
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export async function validateHybridRetrievalConfig(
  env: HybridRetrievalConfigEnv,
  inspector: QdrantCollectionInspector
): Promise<HybridRetrievalConfig> {
  const qdrantUrl = env.QDRANT_URL?.trim();
  const qdrantApiKey = env.QDRANT_API_KEY?.trim();
  const qdrantCollection = env.QDRANT_COLLECTION?.trim();
  const embeddingModel = env.EMBEDDING_MODEL?.trim();
  const embeddingDimensionsRaw = env.EMBEDDING_DIMENSIONS?.trim();

  if (!qdrantUrl || !qdrantApiKey || !qdrantCollection || !embeddingModel || !embeddingDimensionsRaw) {
    throw new Error(
      'retrieval_config_invalid: required env vars QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS'
    );
  }

  const embeddingDimensions = Number.parseInt(embeddingDimensionsRaw, 10);
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) {
    throw new Error('retrieval_config_invalid: EMBEDDING_DIMENSIONS must be a positive integer');
  }

  const vectorSize = await inspector.getVectorSize(qdrantCollection);
  if (vectorSize !== embeddingDimensions) {
    throw new Error(
      `retrieval_config_invalid: embedding dimension ${embeddingDimensions} does not match qdrant collection vector size ${vectorSize}`
    );
  }

  return {
    qdrantUrl,
    qdrantApiKey,
    qdrantCollection,
    embeddingModel,
    embeddingDimensions
  };
}

export function createHybridRetriever(
  dependencies: HybridRetrieverDependencies
) {
  return {
    async search(query: string, limit = 10): Promise<RetrievalSearchResult> {
      const [bm25Result, semanticResult] = await Promise.allSettled([
        dependencies.bm25.search(query, limit),
        dependencies.semantic.search(query, limit)
      ]);

      const bm25Docs = bm25Result.status === 'fulfilled' ? bm25Result.value : [];
      const semanticDocs = semanticResult.status === 'fulfilled' ? semanticResult.value : [];
      const semanticFallback = semanticResult.status === 'rejected';

      const semanticScores = new Map<string, number>();
      for (const doc of semanticDocs) {
        semanticScores.set(doc.id, normalizeScore(doc.semantic_score));
      }

      const merged = new Map<string, RetrievalScoredDocument>();
      for (const doc of bm25Docs) {
        const bm25Score = normalizeScore(doc.bm25_score);
        const semanticScore = semanticFallback
          ? 0
          : normalizeScore(semanticScores.get(doc.id) ?? 0);
        const metadata =
          doc.metadata === undefined ? {} : { metadata: doc.metadata };

        merged.set(doc.id, {
          ...metadata,
          id: doc.id,
          text: doc.text,
          bm25_score: round(bm25Score),
          semantic_score: round(semanticScore),
          fused_score: round(0.6 * bm25Score + 0.4 * semanticScore)
        });
      }

      if (!semanticFallback) {
        for (const doc of semanticDocs) {
          if (merged.has(doc.id)) {
            continue;
          }

          const semanticScore = normalizeScore(doc.semantic_score);
          const metadata =
            doc.metadata === undefined ? {} : { metadata: doc.metadata };
          merged.set(doc.id, {
            ...metadata,
            id: doc.id,
            text: doc.text,
            bm25_score: 0,
            semantic_score: round(semanticScore),
            fused_score: round(0.4 * semanticScore)
          });
        }
      }

      const ranked = [...merged.values()]
        .sort((left, right) => {
          const scoreDelta = right.fused_score - left.fused_score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          return left.id.localeCompare(right.id);
        })
        .slice(0, limit);

      return {
        documents: ranked,
        semantic_fallback: semanticFallback
      };
    }
  };
}
