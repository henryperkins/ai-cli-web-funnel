import { describe, expect, it } from 'vitest';
import {
  createQdrantHttpCollectionInspector,
  startRetrievalSearchService
} from '../src/retrieval-service.js';

const baseEnv = {
  QDRANT_URL: 'https://qdrant.example.test',
  QDRANT_API_KEY: 'qdrant-key',
  QDRANT_COLLECTION: 'forge-packages',
  EMBEDDING_MODEL: 'text-embedding-3-large',
  EMBEDDING_DIMENSIONS: '3072'
};

describe('retrieval search service bootstrap', () => {
  it('fails closed on startup when embedding dimensions mismatch and logs structured failure', async () => {
    const logs: Array<{ event_name: string; payload: Record<string, unknown> }> = [];

    await expect(
      startRetrievalSearchService({
        env: {
          ...baseEnv,
          EMBEDDING_DIMENSIONS: '1536'
        },
        inspector: {
          async getVectorSize() {
            return 3072;
          }
        },
        bm25: {
          async search() {
            return [];
          }
        },
        semantic: {
          async search() {
            return [];
          }
        },
        logger: {
          log(event) {
            logs.push(event);
          }
        }
      })
    ).rejects.toThrow('does not match qdrant collection vector size');

    expect(logs[0]?.event_name).toBe('retrieval.startup.validation_failed');
    const serializedPayload = JSON.stringify(logs[0]?.payload ?? {});
    expect(serializedPayload).toContain('forge-packages');
    expect(serializedPayload).not.toContain('qdrant-key');
  });

  it('starts successfully and exposes stable search entrypoint with semantic_fallback marker', async () => {
    const service = await startRetrievalSearchService({
      env: baseEnv,
      inspector: {
        async getVectorSize() {
          return 3072;
        }
      },
      bm25: {
        async search() {
          return [
            { id: 'a', text: 'A', bm25_score: 0.8 },
            { id: 'b', text: 'B', bm25_score: 0.5 }
          ];
        }
      },
      semantic: {
        async search() {
          return [{ id: 'a', text: 'A', semantic_score: 0.9 }];
        }
      }
    });

    const result = await service.search('security package', 2);
    expect(service.config.embeddingDimensions).toBe(3072);
    expect(result.semantic_fallback).toBe(false);
    expect(result.documents[0]?.id).toBe('a');
  });

  it('inspects qdrant collection vector size using HTTP inspector', async () => {
    const inspector = createQdrantHttpCollectionInspector({
      qdrantUrl: 'https://qdrant.example.test/',
      qdrantApiKey: 'api-key',
      fetchImpl: async (input, init) => {
        expect(input).toBe('https://qdrant.example.test/collections/forge-packages');
        expect((init?.headers as Record<string, string>)['api-key']).toBe('api-key');
        return new Response(
          JSON.stringify({
            result: {
              config: {
                params: {
                  vectors: {
                    size: 1024
                  }
                }
              }
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }
    });

    await expect(inspector.getVectorSize('forge-packages')).resolves.toBe(1024);
  });
});
