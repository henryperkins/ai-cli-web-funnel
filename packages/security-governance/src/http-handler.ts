import {
  createSignedReporterIngestionEntrypoint,
  type SignedReporterIngestionDependencies,
  type SignedReporterIngestionOptions,
  type SignedReporterIngestionRequest,
  type SignedReporterIngestionResult
} from './index.js';

export interface SecurityReportHttpRequest extends SignedReporterIngestionRequest {}

export interface SecurityReportHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: SignedReporterIngestionResult;
}

function resolveStatusCode(result: SignedReporterIngestionResult): number {
  if (result.status === 'accepted') {
    return 202;
  }

  switch (result.reason_code) {
    case 'signature_invalid':
      return 401;
    case 'reporter_not_found':
      return 404;
    case 'reporter_not_active':
    case 'evidence_minimums_missing':
    case 'abuse_suspected':
      return 422;
    case 'nonce_replayed':
      return 409;
    default:
      return 400;
  }
}

export function createSignedReporterIngestionHttpHandler(
  dependencies: SignedReporterIngestionDependencies,
  options: SignedReporterIngestionOptions = {}
) {
  const service = createSignedReporterIngestionEntrypoint(dependencies, options);

  return {
    async handle(request: SecurityReportHttpRequest): Promise<SecurityReportHttpResponse> {
      const result = await service.submit(request);

      return {
        statusCode: resolveStatusCode(result),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-security-report-status': result.status
        },
        body: result
      };
    }
  };
}
