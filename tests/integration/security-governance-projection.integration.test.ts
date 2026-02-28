import { describe, expect, it } from 'vitest';
import {
  computeBodySha256Hex,
  createSecurityEnforcementProjectionUpdater,
  createSignedReporterIngestionEntrypoint,
  InMemoryReporterDirectory,
  InMemoryReporterNonceStore,
  InMemorySecurityEnforcementStore,
  InMemorySecurityReportStore,
  type SecurityReportPayload
} from '@forge/security-governance';

function buildPayload(overrides: Partial<SecurityReportPayload> = {}): SecurityReportPayload {
  return {
    package_id: 'pkg-integration-1',
    severity: 'critical',
    source_kind: 'raw',
    summary: 'critical malware evidence',
    evidence: [
      {
        kind: 'sha256',
        value: 'payload-signature'
      }
    ],
    metadata: {
      scenario: 'projection-ordering'
    },
    ...overrides
  };
}

function buildSignedRequest(options: {
  reporterId: string;
  keyId: string;
  nonce: string;
  timestamp: string;
  receivedAt: string;
  payload: SecurityReportPayload;
}) {
  return {
    method: 'POST',
    path: '/v1/security/reports',
    received_at: options.receivedAt,
    headers: {
      'x-reporter-id': options.reporterId,
      'x-key-id': options.keyId,
      'x-timestamp': options.timestamp,
      'x-nonce': options.nonce,
      'x-body-sha256': computeBodySha256Hex(options.payload),
      'x-signature': 'sig-valid'
    },
    body: options.payload
  };
}

describe('integration: signed reports -> enforcement projection ordering and expiry', () => {
  it('keeps projection replay-safe across ordering changes and expiry windows', async () => {
    const reporterDirectory = new InMemoryReporterDirectory({
      'reporter-a': {
        reporter_id: 'reporter-a',
        reporter_tier: 'A',
        reporter_status: 'active'
      },
      'reporter-b': {
        reporter_id: 'reporter-b',
        reporter_tier: 'B',
        reporter_status: 'active'
      }
    });

    const nonceStore = new InMemoryReporterNonceStore();
    const reportStore = new InMemorySecurityReportStore();
    const projectionStore = new InMemorySecurityEnforcementStore();

    let idCounter = 0;
    const entrypoint = createSignedReporterIngestionEntrypoint(
      {
        reporters: reporterDirectory,
        nonceStore,
        persistence: reportStore,
        projectionStore,
        signatureVerifier: {
          async verify() {
            return true;
          }
        },
        abuseEvaluator: {
          async evaluate() {
            return {
              abuse_suspected: false,
              details: []
            };
          }
        },
        idFactory: () => {
          idCounter += 1;
          return `report-${idCounter}`;
        }
      },
      {
        now: () => new Date('2026-02-27T12:00:00Z')
      }
    );

    const firstResult = await entrypoint.submit(
      buildSignedRequest({
        reporterId: 'reporter-a',
        keyId: 'key-a',
        nonce: 'nonce-1',
        timestamp: '2026-02-27T12:00:00Z',
        receivedAt: '2026-02-27T12:00:00Z',
        payload: buildPayload({
          severity: 'critical',
          source_kind: 'raw'
        })
      })
    );

    const secondResult = await entrypoint.submit(
      buildSignedRequest({
        reporterId: 'reporter-b',
        keyId: 'key-b',
        nonce: 'nonce-2',
        timestamp: '2026-02-27T12:10:00Z',
        receivedAt: '2026-02-27T12:10:00Z',
        payload: buildPayload({
          severity: 'high',
          source_kind: 'curated'
        })
      })
    );

    expect(firstResult.status).toBe('accepted');
    expect(secondResult.status).toBe('accepted');

    const updater = createSecurityEnforcementProjectionUpdater(projectionStore);

    const beforeExpiry = await updater.recompute('pkg-integration-1', '2026-03-01T11:59:59Z');
    const afterExpiry = await updater.recompute('pkg-integration-1', '2026-03-03T12:10:00Z');
    const replay = await updater.recompute('pkg-integration-1', '2026-03-03T12:10:00Z');

    expect(beforeExpiry.state).toBe('policy_blocked_temp');
    expect(afterExpiry.state).toBe('flagged');
    expect(replay).toEqual(afterExpiry);

    const history = await projectionStore.listActionHistory('pkg-integration-1');
    expect(history).toHaveLength(2);
  });
});
