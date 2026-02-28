import { describe, expect, it } from 'vitest';
import {
  buildReporterSignatureCanonicalString,
  computeBodySha256Hex,
  createSignedReporterIngestionEntrypoint,
  InMemoryReporterDirectory,
  InMemoryReporterNonceStore,
  InMemorySecurityEnforcementStore,
  InMemorySecurityReportStore,
  type SecurityReportPayload,
  type SignedReporterIngestionRequest
} from '../src/index.js';

function buildPayload(overrides: Partial<SecurityReportPayload> = {}): SecurityReportPayload {
  return {
    package_id: 'pkg-1',
    severity: 'critical',
    source_kind: 'raw',
    summary: 'malware indicator found',
    evidence: [
      {
        kind: 'sha256',
        value: 'abc123'
      }
    ],
    metadata: {
      source: 'integration-test'
    },
    ...overrides
  };
}

function buildRequest(
  payload: SecurityReportPayload,
  overrides: {
    nonce?: string;
    timestamp?: string;
    receivedAt?: string;
    bodySha?: string;
    signature?: string;
    reporterId?: string;
    keyId?: string;
  } = {}
): SignedReporterIngestionRequest {
  const timestamp = overrides.timestamp ?? '2026-02-27T12:00:00Z';
  const bodySha = overrides.bodySha ?? computeBodySha256Hex(payload);

  return {
    method: 'POST',
    path: '/v1/security/reports',
    received_at: overrides.receivedAt ?? '2026-02-27T12:00:00Z',
    headers: {
      'x-reporter-id': overrides.reporterId ?? 'reporter-1',
      'x-key-id': overrides.keyId ?? 'key-1',
      'x-timestamp': timestamp,
      'x-nonce': overrides.nonce ?? 'nonce-1',
      'x-body-sha256': bodySha,
      'x-signature': overrides.signature ?? 'sig-valid'
    },
    body: payload
  };
}

function createHarness(options: {
  signatureValid?: boolean;
  reporterStatus?: 'active' | 'probation' | 'suspended' | 'removed';
  abuseSuspected?: boolean;
} = {}) {
  const nonceStore = new InMemoryReporterNonceStore();
  const reportStore = new InMemorySecurityReportStore();
  const projectionStore = new InMemorySecurityEnforcementStore();
  const reporterDirectory = new InMemoryReporterDirectory({
    'reporter-1': {
      reporter_id: 'reporter-1',
      reporter_tier: 'A',
      reporter_status: options.reporterStatus ?? 'active'
    }
  });
  const publishedEvents: string[] = [];

  let lastCanonicalString = '';

  const entrypoint = createSignedReporterIngestionEntrypoint(
    {
      reporters: reporterDirectory,
      nonceStore,
      persistence: reportStore,
      projectionStore,
      signatureVerifier: {
        async verify(input) {
          lastCanonicalString = input.canonical_string;
          return options.signatureValid ?? true;
        }
      },
      abuseEvaluator: {
        async evaluate() {
          return {
            abuse_suspected: options.abuseSuspected ?? false,
            details: []
          };
        }
      },
      outboxPublisher: {
        async publish(envelope) {
          publishedEvents.push(`${envelope.event_type}:${envelope.dedupe_key}`);
        }
      },
      idFactory: () => 'report-1'
    },
    {
      now: () => new Date('2026-02-27T12:00:00Z')
    }
  );

  return {
    entrypoint,
    reportStore,
    projectionStore,
    getLastCanonicalString() {
      return lastCanonicalString;
    },
    getPublishedEvents() {
      return [...publishedEvents];
    }
  };
}

describe('signed reporter ingestion runtime path', () => {
  it('computes canonical signature string deterministically', () => {
    const canonical = buildReporterSignatureCanonicalString({
      method: 'post',
      path: '/v1/security/reports',
      timestamp: '2026-02-27T12:00:00Z',
      nonce: 'nonce-1',
      body_sha256: 'ABCDEF'
    });

    expect(canonical).toBe('POST\n/v1/security/reports\n2026-02-27T12:00:00Z\nnonce-1\nabcdef');
  });

  it('rejects stale timestamps outside skew window', async () => {
    const harness = createHarness();

    const result = await harness.entrypoint.submit(
      buildRequest(buildPayload(), {
        timestamp: '2026-02-27T11:45:00Z'
      })
    );

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason_code).toBe('timestamp_skew_exceeded');
    }
  });

  it('rejects body hash mismatches', async () => {
    const harness = createHarness();

    const result = await harness.entrypoint.submit(
      buildRequest(buildPayload(), {
        bodySha: 'deadbeef'
      })
    );

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason_code).toBe('body_hash_mismatch');
    }
  });

  it('rejects nonce replays within TTL window', async () => {
    const harness = createHarness();
    const request = buildRequest(buildPayload(), {
      nonce: 'nonce-replay-1'
    });

    const first = await harness.entrypoint.submit(request);
    const second = await harness.entrypoint.submit(request);

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') {
      expect(second.reason_code).toBe('nonce_replayed');
    }
    expect(harness.getPublishedEvents()).toEqual([
      'security.report.accepted:report-1:pkg-1:accepted',
      'security.enforcement.recompute.requested:report-1:pkg-1:projection'
    ]);
  });

  it('rejects invalid signatures', async () => {
    const harness = createHarness({
      signatureValid: false
    });

    const result = await harness.entrypoint.submit(buildRequest(buildPayload()));

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason_code).toBe('signature_invalid');
    }
  });

  it('rejects reports when reporter is not active', async () => {
    const harness = createHarness({
      reporterStatus: 'suspended'
    });

    const result = await harness.entrypoint.submit(buildRequest(buildPayload()));

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason_code).toBe('reporter_not_active');
      expect(result.report_id).toBe('report-1');
    }
  });

  it('rejects reports when evidence minimums are not met', async () => {
    const harness = createHarness();

    const result = await harness.entrypoint.submit(
      buildRequest(
        buildPayload({
          evidence: []
        })
      )
    );

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason_code).toBe('evidence_minimums_missing');
      expect(result.report_id).toBe('report-1');
    }
  });

  it('accepts valid signed reports and projects enforcement state', async () => {
    const harness = createHarness();
    const payload = buildPayload();
    const request = buildRequest(payload);

    const result = await harness.entrypoint.submit(request);

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.reason_code).toBe('malware_critical_tier_a');
      expect(result.projected_state).toBe('policy_blocked_temp');
      expect(result.projection?.state).toBe('policy_blocked_temp');
    }

    const expectedCanonical = buildReporterSignatureCanonicalString({
      method: 'POST',
      path: '/v1/security/reports',
      timestamp: '2026-02-27T12:00:00Z',
      nonce: 'nonce-1',
      body_sha256: computeBodySha256Hex(payload)
    });

    expect(harness.getLastCanonicalString()).toBe(expectedCanonical);

    const reports = await harness.reportStore.listReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.reason_code).toBe('malware_critical_tier_a');
    expect(harness.getPublishedEvents()).toEqual([
      'security.report.accepted:report-1:pkg-1:accepted',
      'security.enforcement.recompute.requested:report-1:pkg-1:projection'
    ]);
  });
});
