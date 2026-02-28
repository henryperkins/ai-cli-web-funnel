import { describe, expect, it } from 'vitest';
import { createOpenAiEmbeddingProvider } from '../src/embedding-provider.js';

describe('openai embedding provider', () => {
  it('returns embedding vector and enforces expected dimensions', async () => {
    const provider = createOpenAiEmbeddingProvider({
      apiKey: 'openai-key',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://api.openai.com/v1/embeddings');
        expect((init?.headers as Record<string, string>).authorization).toBe(
          'Bearer openai-key'
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                embedding: [0.1, 0.2, 0.3]
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

    const embedding = await provider.embed({
      model: 'text-embedding-3-small',
      text: 'forge package',
      dimensions: 3
    });

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws deterministic error for non-2xx responses', async () => {
    const provider = createOpenAiEmbeddingProvider({
      apiKey: 'openai-key',
      fetchImpl: async () => new Response('unauthorized', { status: 401 })
    });

    await expect(
      provider.embed({
        model: 'text-embedding-3-small',
        text: 'forge package',
        dimensions: 3
      })
    ).rejects.toThrow('embedding_provider_http_error:status=401');
  });

  it('throws deterministic mismatch error when dimensions differ', async () => {
    const provider = createOpenAiEmbeddingProvider({
      apiKey: 'openai-key',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                embedding: [0.1, 0.2]
              }
            ]
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        )
    });

    await expect(
      provider.embed({
        model: 'text-embedding-3-small',
        text: 'forge package',
        dimensions: 3
      })
    ).rejects.toThrow('embedding_dimensions_mismatch');
  });
});
