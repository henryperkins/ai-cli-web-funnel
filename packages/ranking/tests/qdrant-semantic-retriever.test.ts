import { describe, expect, it } from 'vitest';
import { createQdrantSemanticRetriever } from '../src/qdrant-semantic-retriever.js';

describe('qdrant semantic retriever', () => {
  it('queries qdrant and returns deterministic semantic ranking', async () => {
    const requests: string[] = [];

    const retriever = createQdrantSemanticRetriever({
      qdrantUrl: 'https://qdrant.example.test/',
      qdrantApiKey: 'qdrant-key',
      qdrantCollection: 'forge-packages',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 3,
      embeddingProvider: {
        async embed(input) {
          expect(input).toEqual({
            model: 'text-embedding-3-large',
            text: 'forge package',
            dimensions: 3
          });
          return [0.1, 0.2, 0.3];
        }
      },
      fetchImpl: async (input, init) => {
        requests.push(String(input));
        expect((init?.headers as Record<string, string>)['api-key']).toBe('qdrant-key');

        return new Response(
          JSON.stringify({
            result: [
              {
                id: 'pkg-b',
                score: 0.7,
                payload: {
                  package_id: '22222222-2222-4222-8222-222222222222',
                  text: 'package b text'
                }
              },
              {
                id: 'pkg-a',
                score: 0.9,
                payload: {
                  package_id: '11111111-1111-4111-8111-111111111111',
                  text: 'package a text'
                }
              }
            ]
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

    const result = await retriever.search('forge package', 10);

    expect(requests).toEqual([
      'https://qdrant.example.test/collections/forge-packages/points/query'
    ]);

    expect(result).toEqual([
      {
        id: 'pkg-a',
        text: 'package a text',
        metadata: {
          package_id: '11111111-1111-4111-8111-111111111111',
          qdrant_id: 'pkg-a'
        },
        semantic_score: 0.9
      },
      {
        id: 'pkg-b',
        text: 'package b text',
        metadata: {
          package_id: '22222222-2222-4222-8222-222222222222',
          qdrant_id: 'pkg-b'
        },
        semantic_score: 0.7
      }
    ]);
  });

  it('falls back to legacy /points/search endpoint when /points/query returns 404', async () => {
    const retriever = createQdrantSemanticRetriever({
      qdrantUrl: 'https://qdrant.example.test',
      qdrantApiKey: 'qdrant-key',
      qdrantCollection: 'forge-packages',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 2,
      embeddingProvider: {
        async embed() {
          return [0.1, 0.2];
        }
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/points/query')) {
          return new Response('not found', { status: 404 });
        }

        return new Response(
          JSON.stringify({
            result: [
              {
                id: 'pkg-c',
                score: 0.8,
                payload: {
                  package_slug: 'acme/pkg-c'
                }
              }
            ]
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

    const result = await retriever.search('pkg c', 2);

    expect(result).toEqual([
      {
        id: 'pkg-c',
        text: 'acme/pkg-c',
        metadata: {
          package_id: 'pkg-c',
          qdrant_id: 'pkg-c'
        },
        semantic_score: 0.8
      }
    ]);
  });

  it('raises deterministic error when qdrant fails', async () => {
    const retriever = createQdrantSemanticRetriever({
      qdrantUrl: 'https://qdrant.example.test',
      qdrantApiKey: 'qdrant-key',
      qdrantCollection: 'forge-packages',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 2,
      embeddingProvider: {
        async embed() {
          return [0.1, 0.2];
        }
      },
      fetchImpl: async () => new Response('bad gateway', { status: 502 })
    });

    await expect(retriever.search('pkg', 5)).rejects.toThrow(
      'qdrant_semantic_query_failed:status=502'
    );
  });
});
