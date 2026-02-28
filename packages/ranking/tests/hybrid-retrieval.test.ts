import { describe, expect, it } from 'vitest';
import {
  createHybridRetriever,
  validateHybridRetrievalConfig
} from '../src/hybrid-retrieval.js';

describe('hybrid retrieval foundation', () => {
  it('validates config and enforces embedding dimension match', async () => {
    const config = await validateHybridRetrievalConfig(
      {
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'secret',
        QDRANT_COLLECTION: 'forge-packages',
        EMBEDDING_MODEL: 'text-embedding-3-large',
        EMBEDDING_DIMENSIONS: '3072'
      },
      {
        async getVectorSize() {
          return 3072;
        }
      }
    );

    expect(config.embeddingDimensions).toBe(3072);
    expect(config.qdrantCollection).toBe('forge-packages');
  });

  it('fails closed when embedding dimensions mismatch collection vector size', async () => {
    await expect(
      validateHybridRetrievalConfig(
        {
          QDRANT_URL: 'https://qdrant.example.test',
          QDRANT_API_KEY: 'secret',
          QDRANT_COLLECTION: 'forge-packages',
          EMBEDDING_MODEL: 'text-embedding-3-large',
          EMBEDDING_DIMENSIONS: '1536'
        },
        {
          async getVectorSize() {
            return 3072;
          }
        }
      )
    ).rejects.toThrow('does not match qdrant collection vector size');
  });

  it('fuses bm25 and semantic scores deterministically', async () => {
    const retriever = createHybridRetriever({
      bm25: {
        async search() {
          return [
            { id: 'a', text: 'A', bm25_score: 0.9 },
            { id: 'b', text: 'B', bm25_score: 0.5 }
          ];
        }
      },
      semantic: {
        async search() {
          return [
            { id: 'a', text: 'A', semantic_score: 0.4 },
            { id: 'c', text: 'C', semantic_score: 0.8 }
          ];
        }
      }
    });

    const result = await retriever.search('security package', 3);

    expect(result.semantic_fallback).toBe(false);
    expect(result.documents.map((doc) => doc.id)).toEqual(['a', 'c', 'b']);
    expect(result.documents[0]?.fused_score).toBe(0.7);
  });

  it('falls back to bm25-only when semantic retrieval fails', async () => {
    const retriever = createHybridRetriever({
      bm25: {
        async search() {
          return [{ id: 'a', text: 'A', bm25_score: 0.9 }];
        }
      },
      semantic: {
        async search() {
          throw new Error('timeout');
        }
      }
    });

    const result = await retriever.search('security package');

    expect(result.semantic_fallback).toBe(true);
    expect(result.documents).toEqual([
      {
        id: 'a',
        text: 'A',
        bm25_score: 0.9,
        semantic_score: 0,
        fused_score: 0.54
      }
    ]);
  });
});
