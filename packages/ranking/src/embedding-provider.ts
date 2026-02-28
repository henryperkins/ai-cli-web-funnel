export interface EmbeddingProvider {
  embed(input: {
    model: string;
    text: string;
    dimensions: number;
  }): Promise<number[]>;
}

export interface OpenAiEmbeddingProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertFiniteEmbeddingVector(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('embedding_response_invalid: embedding must be an array');
  }

  const vector: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error('embedding_response_invalid: embedding values must be finite numbers');
    }
    vector.push(item);
  }

  return vector;
}

export function createOpenAiEmbeddingProvider(
  options: OpenAiEmbeddingProviderOptions
): EmbeddingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1');

  return {
    async embed(input) {
      const response = await fetchImpl(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`
        },
        body: JSON.stringify({
          model: input.model,
          input: input.text,
          dimensions: input.dimensions
        })
      });

      if (!response.ok) {
        throw new Error(`embedding_provider_http_error:status=${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('embedding_response_invalid: body must be json');
      }

      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error('embedding_response_invalid: body must be an object');
      }

      const data = (payload as Record<string, unknown>).data;
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('embedding_response_invalid: data must be a non-empty array');
      }

      const first = data[0];
      if (typeof first !== 'object' || first === null || Array.isArray(first)) {
        throw new Error('embedding_response_invalid: data[0] must be an object');
      }

      const embedding = assertFiniteEmbeddingVector(
        (first as Record<string, unknown>).embedding
      );

      if (embedding.length !== input.dimensions) {
        throw new Error(
          `embedding_dimensions_mismatch: expected=${input.dimensions} actual=${embedding.length}`
        );
      }

      return embedding;
    }
  };
}
