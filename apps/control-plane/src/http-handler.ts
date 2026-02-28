import {
  createEventIngestionEntrypoint,
  type IngestionDependencies,
  type IngestionRequest,
  type IngestionResult
} from './index.js';

export interface IngestionHttpRequest extends IngestionRequest {}

export interface IngestionHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: IngestionResult;
}

function resolveStatusCode(result: IngestionResult): number {
  if (result.status === 'accepted') {
    return 202;
  }

  if (result.status === 'replayed') {
    return result.previous_response_code;
  }

  if (result.status === 'conflict') {
    return 409;
  }

  return result.reason === 'invalid_event' ? 422 : 400;
}

export function createEventIngestionHttpHandler(
  dependencies: IngestionDependencies
) {
  const service = createEventIngestionEntrypoint(dependencies);

  return {
    async handle(request: IngestionHttpRequest): Promise<IngestionHttpResponse> {
      const result = await service.ingest(request);
      const isReplay = result.status === 'replayed';

      return {
        statusCode: resolveStatusCode(result),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-idempotent-replay': isReplay ? 'true' : 'false'
        },
        body: isReplay ? result.previous_response_body : result
      };
    }
  };
}
