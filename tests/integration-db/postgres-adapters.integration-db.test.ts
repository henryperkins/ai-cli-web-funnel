import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createEventIngestionHttpHandler } from '../../apps/control-plane/src/http-handler.js';
import {
  createPostgresFraudFlagPipeline,
  createPostgresIdempotencyAdapter,
  createPostgresIngestionPersistenceAdapter,
  createPostgresOutboxPublisher
} from '../../apps/control-plane/src/postgres-adapters.js';
import { computeBodySha256Hex } from '../../packages/security-governance/src/index.js';
import { createSignedReporterIngestionHttpHandler } from '../../packages/security-governance/src/http-handler.js';
import {
  createPostgresReporterDirectory,
  createPostgresReporterNonceStore,
  createPostgresSecurityEnforcementStore,
  createPostgresSecurityOutboxPublisher,
  createPostgresSecurityReportStore
} from '../../packages/security-governance/src/postgres-adapters.js';
import {
  createIntegrationDbExecutor,
  resetIntegrationTables,
  seedPackage,
  seedReporter
} from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error(
    'FORGE_INTEGRATION_DB_URL is required for integration-db tests.'
  );
}

const packageId = '0fdf06a7-7e72-4f6b-a7ea-5bc8b8bf40f5';
const reporterPackageId = '5d602d87-33d8-4a09-9d16-5f7486e0e4e7';

function buildEvent() {
  return {
    schema_version: '1.0.0',
    event_id: '91cf6a57-8de1-4d7c-9072-6f102571f8e1',
    event_name: 'package.action',
    event_occurred_at: '2026-02-27T12:00:00Z',
    event_received_at: '2026-02-27T12:00:01Z',
    idempotency_key: 'idem-intg-db-001',
    request_id: '74e9f743-965f-4fb4-a04a-7eb4e2d27d25',
    session_id: '6f797f2b-6d11-4a00-a7a8-cef85cf4df4f',
    actor: {
      actor_id: 'anon:integration',
      actor_type: 'anonymous'
    },
    privacy: {
      consent_state: 'granted',
      region: 'US'
    },
    client: {
      app: 'web',
      app_version: '0.1.0',
      user_agent_family: 'chromium',
      device_class: 'desktop',
      referrer_domain: null
    },
    payload: {
      package_id: packageId,
      action: 'copy_install',
      is_promoted: false,
      command_template_id: 'tmpl-intg'
    }
  } as const;
}

function buildSecurityPayload() {
  return {
    package_id: reporterPackageId,
    severity: 'critical' as const,
    source_kind: 'raw' as const,
    summary: 'critical malware evidence',
    evidence: [
      {
        kind: 'sha256',
        value: 'payload-signature'
      }
    ],
    metadata: {
      scenario: 'integration-db'
    }
  };
}

describe('integration-db: postgres-backed adapters', () => {
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const db = createIntegrationDbExecutor(pool);

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  beforeEach(async () => {
    await resetIntegrationTables(pool);
    await seedPackage(pool, packageId);
    await seedPackage(pool, reporterPackageId);
    await seedReporter(pool, 'reporter-a');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists event ingestion rows with replay/conflict semantics against real postgres', async () => {
    const handler = createEventIngestionHttpHandler({
      idempotency: createPostgresIdempotencyAdapter({ db }),
      persistence: createPostgresIngestionPersistenceAdapter({ db }),
      fraudPipeline: createPostgresFraudFlagPipeline({
        db,
        evaluator: {
          async evaluate() {
            return [
              {
                outcome: 'flagged',
                rule_code: 'FRT-02',
                reason_code: 'duplicate_copy_install_24h',
                metadata: {
                  kept_first_event: true
                }
              }
            ];
          }
        }
      }),
      outboxPublisher: createPostgresOutboxPublisher({ db })
    });

    const accepted = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });
    const replay = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: buildEvent()
    });
    const conflict = await handler.handle({
      method: 'POST',
      path: '/v1/events',
      headers: {},
      body: {
        ...buildEvent(),
        request_id: '8b663c44-6f9d-428f-82a6-8cce5c9beec1'
      }
    });

    expect(accepted.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(conflict.statusCode).toBe(409);

    const rawEvents = await pool.query('SELECT COUNT(*)::int AS count FROM raw_events');
    const idempotency = await pool.query(
      "SELECT COUNT(*)::int AS count FROM ingestion_idempotency_records WHERE scope = 'POST:/v1/events'"
    );
    const outbox = await pool.query(
      "SELECT COUNT(*)::int AS count FROM ingestion_outbox WHERE source_service = 'control-plane'"
    );

    expect(rawEvents.rows[0]?.count).toBe(1);
    expect(idempotency.rows[0]?.count).toBe(1);
    expect(outbox.rows[0]?.count).toBe(2);
  });

  it('persists signed security reports with nonce replay protection against real postgres', async () => {
    const payload = buildSecurityPayload();
    const handler = createSignedReporterIngestionHttpHandler(
      {
        reporters: createPostgresReporterDirectory({ db }),
        nonceStore: createPostgresReporterNonceStore({ db }),
        persistence: createPostgresSecurityReportStore({ db }),
        projectionStore: createPostgresSecurityEnforcementStore({ db }),
        outboxPublisher: createPostgresSecurityOutboxPublisher({ db }),
        signatureVerifier: {
          async verify() {
            return true;
          }
        },
        idFactory: () => 'report-db-1'
      },
      {
        now: () => new Date('2026-02-27T12:00:00Z')
      }
    );

    const accepted = await handler.handle({
      method: 'POST',
      path: '/v1/security/reports',
      received_at: '2026-02-27T12:00:00Z',
      headers: {
        'x-reporter-id': 'reporter-a',
        'x-key-id': 'key-a',
        'x-timestamp': '2026-02-27T12:00:00Z',
        'x-nonce': 'nonce-1',
        'x-body-sha256': computeBodySha256Hex(payload),
        'x-signature': 'sig-valid'
      },
      body: payload
    });
    const replay = await handler.handle({
      method: 'POST',
      path: '/v1/security/reports',
      received_at: '2026-02-27T12:00:00Z',
      headers: {
        'x-reporter-id': 'reporter-a',
        'x-key-id': 'key-a',
        'x-timestamp': '2026-02-27T12:00:00Z',
        'x-nonce': 'nonce-1',
        'x-body-sha256': computeBodySha256Hex(payload),
        'x-signature': 'sig-valid'
      },
      body: payload
    });

    expect(accepted.statusCode).toBe(202);
    expect(replay.statusCode).toBe(409);

    const reports = await pool.query('SELECT COUNT(*)::int AS count FROM security_reports');
    const actions = await pool.query(
      'SELECT COUNT(*)::int AS count FROM security_enforcement_actions'
    );
    const projections = await pool.query(
      'SELECT COUNT(*)::int AS count FROM security_enforcement_projections'
    );
    const outbox = await pool.query(
      "SELECT COUNT(*)::int AS count FROM ingestion_outbox WHERE source_service = 'security-governance'"
    );

    expect(reports.rows[0]?.count).toBe(1);
    expect(actions.rows[0]?.count).toBe(1);
    expect(projections.rows[0]?.count).toBe(1);
    expect(outbox.rows[0]?.count).toBe(2);
  });

  it('enforces reporter metrics freshness guard for fresh vs stale windows', async () => {
    await pool.query(
      `
        INSERT INTO security_reporter_metrics_refresh_state (
          singleton_key,
          refreshed_at,
          updated_at
        )
        VALUES (TRUE, now(), now())
        ON CONFLICT (singleton_key) DO UPDATE
        SET
          refreshed_at = EXCLUDED.refreshed_at,
          updated_at = EXCLUDED.updated_at
      `
    );

    const fresh = await pool.query<{ ready: boolean }>(
      "SELECT security_reporter_metrics_ready('6 hours'::interval) AS ready"
    );
    expect(fresh.rows[0]?.ready).toBe(true);

    await pool.query(
      `
        UPDATE security_reporter_metrics_refresh_state
        SET refreshed_at = '2026-02-26T00:00:00Z'::timestamptz, updated_at = now()
        WHERE singleton_key = TRUE
      `
    );

    const stale = await pool.query<{ ready: boolean }>(
      "SELECT security_reporter_metrics_ready('15 minutes'::interval) AS ready"
    );
    expect(stale.rows[0]?.ready).toBe(false);

    await expect(
      pool.query("SELECT assert_security_reporter_metrics_ready('15 minutes'::interval)")
    ).rejects.toThrow('security_reporter_metrics_stale');
  });
});
