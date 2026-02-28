import { describe, expect, it } from 'vitest';
import { computeBodySha256Hex } from '../../packages/security-governance/src/index.js';
import { createSignedReporterIngestionHttpHandler } from '../../packages/security-governance/src/http-handler.js';
import {
  createPostgresReporterDirectory,
  createPostgresReporterNonceStore,
  createPostgresSecurityEnforcementStore,
  createPostgresSecurityOutboxPublisher,
  createPostgresSecurityReportStore,
  type PostgresQueryExecutor
} from '../../packages/security-governance/src/postgres-adapters.js';

function buildPayload() {
  return {
    package_id: '5d602d87-33d8-4a09-9d16-5f7486e0e4e7',
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
      scenario: 'db-adapters'
    }
  };
}

function buildRequest(
  nonce: string,
  timestamp: string,
  receivedAt = timestamp
) {
  const payload = buildPayload();
  return {
    method: 'POST',
    path: '/v1/security/reports',
    received_at: receivedAt,
    headers: {
      'x-reporter-id': 'reporter-a',
      'x-key-id': 'key-a',
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-body-sha256': computeBodySha256Hex(payload),
      'x-signature': 'sig-valid'
    },
    body: payload
  };
}

class FakeDb implements PostgresQueryExecutor {
  readonly reports: Array<Record<string, unknown>> = [];
  readonly actions = new Map<string, Record<string, unknown>>();
  readonly projections = new Map<string, Record<string, unknown>>();
  readonly outbox: Array<Record<string, unknown>> = [];
  private readonly reporters = new Map<
    string,
    {
      reporter_id: string;
      reporter_tier: 'A';
      reporter_status: 'active';
    }
  >([
    [
      'reporter-a',
      {
        reporter_id: 'reporter-a',
        reporter_tier: 'A',
        reporter_status: 'active'
      }
    ]
  ]);
  private readonly nonces = new Map<
    string,
    {
      reporter_id: string;
      nonce: string;
      created_at: string;
      expires_at: string;
    }
  >();
  private actionCounter = 0;

  private nextActionUuid(): string {
    this.actionCounter += 1;
    const suffix = this.actionCounter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('FROM security_reporters')) {
      const reporter = this.reporters.get(params[0] as string);
      return {
        rows: reporter ? ([reporter] as Row[]) : [],
        rowCount: reporter ? 1 : 0
      };
    }

    if (sql.includes('FROM security_report_nonces') && sql.includes('nonce = $2')) {
      const nonce = this.nonces.get(`${params[0]}:${params[1]}`);
      return {
        rows: nonce ? ([nonce] as Row[]) : [],
        rowCount: nonce ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO security_report_nonces')) {
      this.nonces.set(`${params[0]}:${params[1]}`, {
        reporter_id: params[0] as string,
        nonce: params[1] as string,
        created_at: params[2] as string,
        expires_at: params[3] as string
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('DELETE FROM security_report_nonces')) {
      const now = Date.parse(params[0] as string);
      let removed = 0;
      for (const [key, value] of this.nonces.entries()) {
        if (Date.parse(value.expires_at) <= now) {
          this.nonces.delete(key);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }

    if (sql.includes('COUNT(*)::text AS active_count')) {
      const reporterId = params[0] as string;
      const now = Date.parse(params[1] as string);
      const count = [...this.nonces.values()].filter(
        (nonce) =>
          nonce.reporter_id === reporterId && Date.parse(nonce.expires_at) > now
      ).length;
      return {
        rows: ([{ active_count: String(count) }] as Row[]),
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO security_reports')) {
      this.reports.push({
        report_id: params[0],
        package_id: params[3],
        projected_state: params[11]
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes('SELECT id::text AS id') &&
      sql.includes('FROM security_enforcement_actions')
    ) {
      const action = this.actions.get(params[0] as string);
      return {
        rows: action ? ([{ id: action.id }] as Row[]) : [],
        rowCount: action ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO security_enforcement_actions')) {
      const actionId = params[0] as string;
      const existing = this.actions.get(actionId);
      this.actions.set(actionId, {
        id: existing?.id ?? this.nextActionUuid(),
        action_id: actionId,
        package_id: params[1],
        state: params[2],
        reason_code: params[3],
        source: params[4],
        active: params[5],
        supersedes_action_id: params[6],
        expires_at: params[7],
        created_at: params[9]
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('FROM security_enforcement_actions action')) {
      const packageId = params[0] as string;
      const rows = [...this.actions.values()]
        .filter((action) => action.package_id === packageId)
        .map((action) => ({
          action_id: action.action_id as string,
          package_id: action.package_id as string,
          state: action.state as string,
          reason_code: action.reason_code as string,
          source: action.source as string,
          active: action.active as boolean,
          expires_at: (action.expires_at as string | null) ?? null,
          created_at: action.created_at as string,
          supersedes_action_id: null
        }));

      return {
        rows: rows as Row[],
        rowCount: rows.length
      };
    }

    if (sql.includes('INSERT INTO security_enforcement_projections')) {
      this.projections.set(params[0] as string, {
        package_id: params[0],
        state: params[1],
        reason_code: params[2],
        policy_blocked: params[3],
        warning_only: params[4],
        source: params[5],
        updated_at: params[6]
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO ingestion_outbox')) {
      const dedupeKey = params[1] as string;
      if (!this.outbox.find((entry) => entry.dedupe_key === dedupeKey)) {
        this.outbox.push({
          event_type: params[0],
          dedupe_key: dedupeKey
        });
      }
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in fake db: ${sql}`);
  }
}

describe('integration: db-backed signed reporter ingestion adapters', () => {
  it('accepts valid reports, rejects nonce replays, and persists projections/outbox', async () => {
    const db = new FakeDb();
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

    const accepted = await handler.handle(buildRequest('nonce-1', '2026-02-27T12:00:00Z'));
    const replay = await handler.handle(buildRequest('nonce-1', '2026-02-27T12:00:00Z'));
    const stale = await handler.handle(
      buildRequest(
        'nonce-2',
        '2026-02-27T11:45:00Z',
        '2026-02-27T12:00:00Z'
      )
    );

    expect(accepted.statusCode).toBe(202);
    expect(replay.statusCode).toBe(409);
    expect(stale.statusCode).toBe(400);
    expect(db.reports).toHaveLength(1);
    expect(db.actions.size).toBe(1);
    expect(db.projections.size).toBe(1);
    expect(db.outbox).toHaveLength(2);
  });
});
