import { describe, expect, it } from 'vitest';
import {
  InMemoryReporterDirectory,
  InMemoryReporterNonceStore,
  InMemorySecurityEnforcementStore,
  InMemorySecurityReportStore,
  computeBodySha256Hex
} from '../src/index.js';
import { createSignedReporterIngestionHttpHandler } from '../src/http-handler.js';

function buildPayload() {
  return {
    package_id: '5d602d87-33d8-4a09-9d16-5f7486e0e4e7',
    severity: 'critical' as const,
    source_kind: 'raw' as const,
    summary: 'malware sample found',
    evidence: [
      {
        kind: 'sha256',
        value: 'abc123'
      }
    ],
    metadata: {
      source: 'http-handler-test'
    }
  };
}

function buildRequest(signature = 'sig-valid') {
  const payload = buildPayload();
  return {
    method: 'POST',
    path: '/v1/security/reports',
    received_at: '2026-02-27T12:00:00Z',
    headers: {
      'x-reporter-id': 'reporter-1',
      'x-key-id': 'key-1',
      'x-timestamp': '2026-02-27T12:00:00Z',
      'x-nonce': 'nonce-1',
      'x-body-sha256': computeBodySha256Hex(payload),
      'x-signature': signature
    },
    body: payload
  };
}

function createHandler(signatureValid = true) {
  return createSignedReporterIngestionHttpHandler(
    {
      reporters: new InMemoryReporterDirectory({
        'reporter-1': {
          reporter_id: 'reporter-1',
          reporter_tier: 'A',
          reporter_status: 'active'
        }
      }),
      nonceStore: new InMemoryReporterNonceStore(),
      persistence: new InMemorySecurityReportStore(),
      projectionStore: new InMemorySecurityEnforcementStore(),
      signatureVerifier: {
        async verify() {
          return signatureValid;
        }
      }
    },
    {
      now: () => new Date('2026-02-27T12:00:00Z')
    }
  );
}

describe('signed reporter ingestion http handler', () => {
  it('returns 202 for accepted report submission', async () => {
    const handler = createHandler(true);
    const response = await handler.handle(buildRequest());

    expect(response.statusCode).toBe(202);
    expect(response.headers['x-security-report-status']).toBe('accepted');
    expect(response.body.status).toBe('accepted');
  });

  it('returns 401 for invalid signatures', async () => {
    const handler = createHandler(false);
    const response = await handler.handle(buildRequest('sig-invalid'));

    expect(response.statusCode).toBe(401);
    expect(response.headers['x-security-report-status']).toBe('rejected');
    expect(response.body).toMatchObject({
      status: 'rejected',
      reason_code: 'signature_invalid'
    });
  });
});
