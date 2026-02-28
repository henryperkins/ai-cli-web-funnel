import { describe, expect, it } from 'vitest';
import {
  createPostgresReporterDirectory,
  createPostgresReporterNonceStore,
  createPostgresSecurityEnforcementStore,
  createPostgresSecurityOutboxPublisher,
  createPostgresSecurityReportStore,
  type PostgresQueryExecutor
} from '../src/postgres-adapters.js';

type ReporterStatus = 'active' | 'probation' | 'suspended' | 'removed';
type ReporterTier = 'A' | 'B' | 'C';

interface ReporterRow {
  reporter_id: string;
  reporter_tier: ReporterTier;
  reporter_status: ReporterStatus;
}

class FakeDb implements PostgresQueryExecutor {
  readonly reporters = new Map<string, ReporterRow>();
  readonly reports: Array<Record<string, unknown>> = [];
  readonly outbox: Array<Record<string, unknown>> = [];
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  private readonly nonces = new Map<
    string,
    {
      reporter_id: string;
      nonce: string;
      created_at: string;
      expires_at: string;
    }
  >();
  private readonly actions = new Map<
    string,
    {
      id: string;
      action_id: string;
      package_id: string;
      state: string;
      reason_code: string;
      source: string;
      active: boolean;
      supersedes_action_id: string | null;
      expires_at: string | null;
      created_at: string;
    }
  >();
  private readonly projections = new Map<
    string,
    {
      package_id: string;
      state: string;
      reason_code: string | null;
      policy_blocked: boolean;
      warning_only: boolean;
      source: string;
      updated_at: string;
    }
  >();
  private actionCounter = 0;

  private nextActionId(): string {
    this.actionCounter += 1;
    const suffix = this.actionCounter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });

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
      const key = `${params[0]}:${params[1]}`;
      this.nonces.set(key, {
        reporter_id: params[0] as string,
        nonce: params[1] as string,
        created_at: params[2] as string,
        expires_at: params[3] as string
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('DELETE FROM security_report_nonces')) {
      const now = Date.parse(params[0] as string);
      let deleted = 0;
      for (const [key, record] of this.nonces.entries()) {
        if (Date.parse(record.expires_at) <= now) {
          this.nonces.delete(key);
          deleted += 1;
        }
      }

      return { rows: [], rowCount: deleted };
    }

    if (sql.includes('COUNT(*)::text AS active_count')) {
      const reporterId = params[0] as string;
      const now = Date.parse(params[1] as string);
      const active = [...this.nonces.values()].filter(
        (record) =>
          record.reporter_id === reporterId && Date.parse(record.expires_at) > now
      ).length;

      return {
        rows: ([{ active_count: String(active) }] as Row[]),
        rowCount: 1
      };
    }

    if (sql.includes('INSERT INTO security_reports')) {
      this.reports.push({
        report_id: params[0],
        reporter_id: params[1],
        package_id: params[3],
        queue: params[10],
        projected_state: params[11],
        metadata: params[17]
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes('SELECT id::text AS id') &&
      sql.includes('FROM security_enforcement_actions')
    ) {
      const actionId = params[0] as string;
      const found = [...this.actions.values()].find(
        (action) => action.action_id === actionId
      );
      return {
        rows: found ? ([{ id: found.id }] as Row[]) : [],
        rowCount: found ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO security_enforcement_actions')) {
      const actionId = params[0] as string;
      const existing = this.actions.get(actionId);
      const next = {
        id: existing?.id ?? this.nextActionId(),
        action_id: actionId,
        package_id: params[1] as string,
        state: params[2] as string,
        reason_code: params[3] as string,
        source: params[4] as string,
        active: params[5] as boolean,
        supersedes_action_id: (params[6] as string | null) ?? null,
        expires_at: (params[7] as string | null) ?? null,
        created_at: params[9] as string
      };
      this.actions.set(actionId, next);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('FROM security_enforcement_actions action')) {
      const packageId = params[0] as string;
      const actions = [...this.actions.values()]
        .filter((action) => action.package_id === packageId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map((action) => ({
          action_id: action.action_id,
          package_id: action.package_id,
          state: action.state,
          reason_code: action.reason_code,
          source: action.source,
          active: action.active,
          expires_at: action.expires_at,
          created_at: action.created_at,
          supersedes_action_id:
            action.supersedes_action_id
              ? [...this.actions.values()].find(
                  (candidate) => candidate.id === action.supersedes_action_id
                )?.action_id ?? null
              : null
        }));

      return {
        rows: actions as Row[],
        rowCount: actions.length
      };
    }

    if (sql.includes('INSERT INTO security_enforcement_projections')) {
      this.projections.set(params[0] as string, {
        package_id: params[0] as string,
        state: params[1] as string,
        reason_code: (params[2] as string | null) ?? null,
        policy_blocked: params[3] as boolean,
        warning_only: params[4] as boolean,
        source: params[5] as string,
        updated_at: params[6] as string
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('FROM security_enforcement_projections')) {
      const projection = this.projections.get(params[0] as string);
      return {
        rows: projection ? ([projection] as Row[]) : [],
        rowCount: projection ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO ingestion_outbox')) {
      const dedupeKey = params[1] as string;
      if (!this.outbox.find((entry) => entry.dedupe_key === dedupeKey)) {
        this.outbox.push({
          event_type: params[0],
          dedupe_key: dedupeKey,
          payload: params[2],
          source_service: params[3],
          occurred_at: params[4]
        });
      }

      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in fake db: ${sql}`);
  }
}

describe('security-governance postgres adapters', () => {
  it('supports reporter lookup and nonce lifecycle operations', async () => {
    const db = new FakeDb();
    db.reporters.set('reporter-1', {
      reporter_id: 'reporter-1',
      reporter_tier: 'A',
      reporter_status: 'active'
    });

    const directory = createPostgresReporterDirectory({ db });
    const nonceStore = createPostgresReporterNonceStore({ db });

    const reporter = await directory.getReporter('reporter-1');
    expect(reporter).toEqual({
      reporter_id: 'reporter-1',
      reporter_tier: 'A',
      reporter_status: 'active'
    });

    await nonceStore.put({
      reporter_id: 'reporter-1',
      nonce: 'nonce-1',
      created_at: '2026-02-27T12:00:00Z',
      expires_at: '2026-02-27T13:00:00Z'
    });
    await nonceStore.put({
      reporter_id: 'reporter-1',
      nonce: 'nonce-2',
      created_at: '2026-02-27T10:00:00Z',
      expires_at: '2026-02-27T11:00:00Z'
    });

    expect(await nonceStore.countActiveForReporter('reporter-1', '2026-02-27T12:30:00Z')).toBe(
      1
    );
    expect(await nonceStore.purgeExpired('2026-02-27T12:30:00Z')).toBe(1);
    expect(await nonceStore.get('reporter-1', 'nonce-1')).toMatchObject({
      nonce: 'nonce-1'
    });
  });

  it('appends security reports and enforces UUID package id', async () => {
    const db = new FakeDb();
    const store = createPostgresSecurityReportStore({ db });

    await store.appendReport({
      report_id: 'report-1',
      reporter_id: 'reporter-1',
      reporter_key_id: 'key-1',
      package_id: '5d602d87-33d8-4a09-9d16-5f7486e0e4e7',
      severity: 'critical',
      source_kind: 'raw',
      signature_valid: true,
      evidence_minimums_met: true,
      abuse_suspected: false,
      reason_code: 'malware_critical_tier_a',
      queue: 'queued_review',
      projected_state: 'policy_blocked_temp',
      body_sha256: 'abc123',
      request_timestamp: '2026-02-27T12:00:00Z',
      request_nonce: 'nonce-1',
      received_at: '2026-02-27T12:00:00Z',
      summary: 'malware indicator found',
      evidence_count: 1,
      metadata: {
        source: 'adapter-test'
      }
    });

    expect(db.reports).toHaveLength(1);
    expect(db.reports[0]?.package_id).toBe('5d602d87-33d8-4a09-9d16-5f7486e0e4e7');

    await expect(
      store.appendReport({
        report_id: 'report-2',
        reporter_id: 'reporter-1',
        reporter_key_id: 'key-1',
        package_id: 'pkg-non-uuid',
        severity: 'critical',
        source_kind: 'raw',
        signature_valid: true,
        evidence_minimums_met: true,
        abuse_suspected: false,
        reason_code: 'malware_critical_tier_a',
        queue: 'queued_review',
        projected_state: 'policy_blocked_temp',
        body_sha256: 'abc123',
        request_timestamp: '2026-02-27T12:00:00Z',
        request_nonce: 'nonce-2',
        received_at: '2026-02-27T12:00:00Z',
        summary: 'malware indicator found',
        evidence_count: 1,
        metadata: {}
      })
    ).rejects.toThrow('package_id must be a UUID');
  });

  it('stores action history with supersede links and projection snapshots', async () => {
    const db = new FakeDb();
    const store = createPostgresSecurityEnforcementStore({ db });
    const packageId = '5d602d87-33d8-4a09-9d16-5f7486e0e4e7';

    await store.appendAction({
      action_id: 'action-a',
      package_id: packageId,
      state: 'flagged',
      reason_code: 'needs_human_review',
      active: true,
      created_at: '2026-02-27T12:00:00Z',
      source: 'security_governance',
      expires_at: null,
      supersedes_action_id: null
    });

    await store.appendAction({
      action_id: 'action-b',
      package_id: packageId,
      state: 'policy_blocked_temp',
      reason_code: 'malware_critical_tier_a',
      active: true,
      created_at: '2026-02-27T12:10:00Z',
      source: 'security_governance',
      expires_at: '2026-03-01T12:10:00Z',
      supersedes_action_id: 'action-a'
    });

    const actions = await store.listActions(packageId);
    expect(actions).toHaveLength(2);
    expect(actions[1]?.supersedes_action_id).toBe('action-a');

    await store.upsertProjection({
      package_id: packageId,
      state: 'policy_blocked_temp',
      reason_code: 'malware_critical_tier_a',
      policy_blocked: true,
      warning_only: false,
      source: 'security_governance',
      updated_at: '2026-02-27T12:10:00Z'
    });

    expect(await store.getProjection(packageId)).toEqual({
      package_id: packageId,
      state: 'policy_blocked_temp',
      reason_code: 'malware_critical_tier_a',
      policy_blocked: true,
      warning_only: false,
      source: 'security_governance',
      updated_at: '2026-02-27T12:10:00Z'
    });
  });

  it('publishes security outbox envelopes idempotently', async () => {
    const db = new FakeDb();
    const publisher = createPostgresSecurityOutboxPublisher({
      db
    });

    await publisher.publish({
      event_type: 'security.report.accepted',
      dedupe_key: 'report-1:accepted',
      payload: {
        report_id: 'report-1'
      },
      occurred_at: '2026-02-27T12:00:00Z'
    });
    await publisher.publish({
      event_type: 'security.report.accepted',
      dedupe_key: 'report-1:accepted',
      payload: {
        report_id: 'report-1'
      },
      occurred_at: '2026-02-27T12:00:01Z'
    });

    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({
      event_type: 'security.report.accepted',
      dedupe_key: 'report-1:accepted',
      source_service: 'security-governance'
    });
  });
});
