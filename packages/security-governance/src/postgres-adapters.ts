import type {
  ReporterDirectory,
  ReporterDirectoryRecord,
  ReporterNonceRecord,
  ReporterNonceStore,
  SecurityEnforcementAction,
  SecurityEnforcementProjectionDecision,
  SecurityEnforcementProjectionStore,
  SecurityReportOutboxEnvelope,
  SecurityReportOutboxPublisher,
  SecurityReportPersistenceAdapter,
  SecurityReportRecord
} from './index.js';

export interface PostgresQueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface PostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresReporterDirectoryOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresReporterNonceStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresSecurityReportStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresSecurityEnforcementStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresOutboxPublisherOptions {
  db: PostgresQueryExecutor;
  sourceService?: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toUuidOrThrow(fieldName: string, value: string): string {
  if (!isUuid(value)) {
    throw new Error(`${fieldName} must be a UUID for Postgres adapter usage`);
  }

  return value;
}

export function createPostgresReporterDirectory(
  options: PostgresReporterDirectoryOptions
): ReporterDirectory {
  return {
    async getReporter(reporterId) {
      const result = await options.db.query<{
        reporter_id: string;
        reporter_tier: 'A' | 'B' | 'C';
        reporter_status: 'active' | 'probation' | 'suspended' | 'removed';
      }>(
        `
          SELECT
            reporter_id,
            tier::text AS reporter_tier,
            status::text AS reporter_status
          FROM security_reporters
          WHERE reporter_id = $1
          LIMIT 1
        `,
        [reporterId]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        reporter_id: row.reporter_id,
        reporter_tier: row.reporter_tier,
        reporter_status: row.reporter_status
      } satisfies ReporterDirectoryRecord;
    }
  };
}

export function createPostgresReporterNonceStore(
  options: PostgresReporterNonceStoreOptions
): ReporterNonceStore {
  return {
    async get(reporterId, nonce) {
      const result = await options.db.query<{
        reporter_id: string;
        nonce: string;
        created_at: string;
        expires_at: string;
      }>(
        `
          SELECT
            reporter_id,
            nonce,
            created_at::text AS created_at,
            expires_at::text AS expires_at
          FROM security_report_nonces
          WHERE reporter_id = $1 AND nonce = $2
          LIMIT 1
        `,
        [reporterId, nonce]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        reporter_id: row.reporter_id,
        nonce: row.nonce,
        created_at: row.created_at,
        expires_at: row.expires_at
      } satisfies ReporterNonceRecord;
    },

    async put(record) {
      await options.db.query(
        `
          INSERT INTO security_report_nonces (
            reporter_id,
            nonce,
            created_at,
            expires_at
          )
          VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
          ON CONFLICT (reporter_id, nonce) DO UPDATE
          SET
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at
        `,
        [record.reporter_id, record.nonce, record.created_at, record.expires_at]
      );
    },

    async purgeExpired(nowIso) {
      const result = await options.db.query(
        `
          DELETE FROM security_report_nonces
          WHERE expires_at <= $1::timestamptz
        `,
        [nowIso]
      );

      return result.rowCount ?? 0;
    },

    async countActiveForReporter(reporterId, nowIso) {
      const result = await options.db.query<{ active_count: string }>(
        `
          SELECT COUNT(*)::text AS active_count
          FROM security_report_nonces
          WHERE reporter_id = $1 AND expires_at > $2::timestamptz
        `,
        [reporterId, nowIso]
      );

      return Number.parseInt(result.rows[0]?.active_count ?? '0', 10);
    }
  };
}

export function createPostgresSecurityReportStore(
  options: PostgresSecurityReportStoreOptions
): SecurityReportPersistenceAdapter {
  return {
    async appendReport(record) {
      await options.db.query(
        `
          INSERT INTO security_reports (
            report_id,
            reporter_id,
            reporter_key_id,
            package_id,
            severity,
            source_kind,
            signature_valid,
            evidence_minimums_met,
            abuse_suspected,
            reason_code,
            queue,
            projected_state,
            body_sha256,
            request_timestamp,
            request_nonce,
            summary,
            evidence_count,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4::uuid,
            $5::security_severity,
            $6::security_source_kind,
            $7,
            $8,
            $9,
            $10,
            $11::security_report_queue,
            $12::security_enforcement_state,
            $13,
            $14::timestamptz,
            $15,
            $16,
            $17,
            $18::jsonb,
            $19::timestamptz
          )
          ON CONFLICT (report_id) DO NOTHING
        `,
        [
          record.report_id,
          record.reporter_id,
          record.reporter_key_id,
          toUuidOrThrow('package_id', record.package_id),
          record.severity,
          record.source_kind,
          record.signature_valid,
          record.evidence_minimums_met,
          record.abuse_suspected,
          record.reason_code,
          record.queue,
          record.projected_state,
          record.body_sha256,
          record.request_timestamp,
          record.request_nonce,
          record.summary,
          record.evidence_count,
          JSON.stringify(record.metadata),
          record.received_at
        ]
      );
    }
  };
}

async function resolveActionInternalId(
  db: PostgresQueryExecutor,
  actionId: string
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM security_enforcement_actions
      WHERE action_id = $1
      LIMIT 1
    `,
    [actionId]
  );

  return result.rows[0]?.id ?? null;
}

export function createPostgresSecurityEnforcementStore(
  options: PostgresSecurityEnforcementStoreOptions
): SecurityEnforcementProjectionStore {
  return {
    async appendAction(action) {
      const supersededInternalId =
        action.supersedes_action_id
          ? await resolveActionInternalId(options.db, action.supersedes_action_id)
          : null;

      await options.db.query(
        `
          INSERT INTO security_enforcement_actions (
            action_id,
            package_id,
            state,
            reason_code,
            source,
            active,
            supersedes_action_id,
            expires_at,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2::uuid,
            $3::security_enforcement_state,
            $4,
            $5::security_enforcement_source,
            $6,
            $7::uuid,
            $8::timestamptz,
            $9::jsonb,
            $10::timestamptz
          )
          ON CONFLICT (action_id) DO UPDATE
          SET
            state = EXCLUDED.state,
            reason_code = EXCLUDED.reason_code,
            source = EXCLUDED.source,
            active = EXCLUDED.active,
            supersedes_action_id = EXCLUDED.supersedes_action_id,
            expires_at = EXCLUDED.expires_at,
            metadata = EXCLUDED.metadata,
            created_at = EXCLUDED.created_at
        `,
        [
          action.action_id,
          toUuidOrThrow('package_id', action.package_id),
          action.state,
          action.reason_code,
          action.source ?? 'security_governance',
          action.active ?? true,
          supersededInternalId,
          action.expires_at ?? null,
          JSON.stringify({}),
          action.created_at
        ]
      );
    },

    async listActions(packageId) {
      const result = await options.db.query<{
        action_id: string;
        package_id: string;
        state: SecurityEnforcementAction['state'];
        reason_code: string;
        source: string;
        active: boolean;
        expires_at: string | null;
        created_at: string;
        supersedes_action_id: string | null;
      }>(
        `
          SELECT
            action.action_id,
            action.package_id::text AS package_id,
            action.state::text AS state,
            action.reason_code,
            action.source::text AS source,
            action.active,
            action.expires_at::text AS expires_at,
            action.created_at::text AS created_at,
            superseded.action_id AS supersedes_action_id
          FROM security_enforcement_actions action
          LEFT JOIN security_enforcement_actions superseded
            ON superseded.id = action.supersedes_action_id
          WHERE action.package_id = $1::uuid
          ORDER BY action.created_at ASC, action.action_id ASC
        `,
        [toUuidOrThrow('package_id', packageId)]
      );

        return result.rows.map((row) => ({
          action_id: row.action_id,
          package_id: row.package_id,
          state: row.state,
          reason_code: row.reason_code,
          source: 'security_governance',
          active: row.active,
          expires_at: row.expires_at,
          created_at: row.created_at,
          supersedes_action_id: row.supersedes_action_id
        }));
    },

    async upsertProjection(projection) {
      await options.db.query(
        `
          INSERT INTO security_enforcement_projections (
            package_id,
            state,
            reason_code,
            policy_blocked,
            warning_only,
            source,
            updated_at
          )
          VALUES (
            $1::uuid,
            $2::security_enforcement_state,
            $3,
            $4,
            $5,
            $6::security_enforcement_source,
            $7::timestamptz
          )
          ON CONFLICT (package_id) DO UPDATE
          SET
            state = EXCLUDED.state,
            reason_code = EXCLUDED.reason_code,
            policy_blocked = EXCLUDED.policy_blocked,
            warning_only = EXCLUDED.warning_only,
            source = EXCLUDED.source,
            updated_at = EXCLUDED.updated_at
        `,
        [
          toUuidOrThrow('package_id', projection.package_id),
          projection.state,
          projection.reason_code,
          projection.policy_blocked,
          projection.warning_only,
          projection.source,
          projection.updated_at
        ]
      );
    },

    async getProjection(packageId) {
      const result = await options.db.query<{
        package_id: string;
        state: SecurityEnforcementProjectionDecision['state'];
        reason_code: string | null;
        policy_blocked: boolean;
        warning_only: boolean;
        source: SecurityEnforcementProjectionDecision['source'];
        updated_at: string;
      }>(
        `
          SELECT
            package_id::text AS package_id,
            state::text AS state,
            reason_code,
            policy_blocked,
            warning_only,
            source::text AS source,
            updated_at::text AS updated_at
          FROM security_enforcement_projections
          WHERE package_id = $1::uuid
          LIMIT 1
        `,
        [toUuidOrThrow('package_id', packageId)]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        package_id: row.package_id,
        state: row.state,
        reason_code: row.reason_code,
        policy_blocked: row.policy_blocked,
        warning_only: row.warning_only,
        source: row.source,
        updated_at: row.updated_at
      } satisfies SecurityEnforcementProjectionDecision;
    }
  };
}

export function createPostgresSecurityOutboxPublisher(
  options: PostgresOutboxPublisherOptions
): SecurityReportOutboxPublisher {
  const sourceService = options.sourceService ?? 'security-governance';

  return {
    async publish(envelope: SecurityReportOutboxEnvelope) {
      await options.db.query(
        `
          INSERT INTO ingestion_outbox (
            event_type,
            dedupe_key,
            payload,
            source_service,
            occurred_at
          )
          VALUES (
            $1,
            $2,
            $3::jsonb,
            $4,
            $5::timestamptz
          )
          ON CONFLICT (dedupe_key) DO NOTHING
        `,
        [
          envelope.event_type,
          envelope.dedupe_key,
          JSON.stringify(envelope.payload),
          sourceService,
          envelope.occurred_at
        ]
      );
    }
  };
}
