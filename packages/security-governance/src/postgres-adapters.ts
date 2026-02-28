import type {
  PermanentBlockPromotionRecord,
  PermanentBlockPromotionStore,
  PermanentBlockValidationResult,
  ReporterDirectory,
  ReporterDirectoryRecord,
  ReporterNonceRecord,
  ReporterNonceStore,
  SecurityAppealsMetricsSnapshot,
  SecurityAppealsMetricsStore,
  SecurityEnforcementAction,
  SecurityEnforcementProjectionDecision,
  SecurityEnforcementProjectionStore,
  SecurityPromotionDecisionRecord,
  SecurityPromotionDecisionStore,
  SecurityReportOutboxEnvelope,
  SecurityReportOutboxPublisher,
  SecurityReportPersistenceAdapter,
  SecurityReportRecord,
  SecurityRolloutMode,
  SecurityRolloutState,
  SecurityRolloutStateStore,
  SecurityTrustGateMetricsStore,
  SecurityTrustGateSnapshot
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

export interface PostgresSecurityAppealsMetricsStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresPermanentBlockPromotionStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresSecurityRolloutStateStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresSecurityPromotionDecisionStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresSecurityTrustGateMetricsStoreOptions {
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

function parseCount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function clampRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  const ratio = numerator / denominator;
  if (!Number.isFinite(ratio)) {
    return null;
  }
  return Number(ratio.toFixed(6));
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

export function createPostgresSecurityAppealsMetricsStore(
  options: PostgresSecurityAppealsMetricsStoreOptions
): SecurityAppealsMetricsStore {
  return {
    async getSnapshot(input) {
      const result = await options.db.query<{
        total_opened: string | number;
        critical_opened: string | number;
        assigned_count: string | number;
        critical_assignment_sla_met_count: string | number;
        first_response_recorded_count: string | number;
        first_response_sla_met_count: string | number;
        escalation_count_total: string | number;
        assignment_latency_seconds_p50: string | number | null;
        assignment_latency_seconds_p95: string | number | null;
        first_response_latency_seconds_p50: string | number | null;
        first_response_latency_seconds_p95: string | number | null;
      }>(
        `
          WITH scoped AS (
            SELECT
              priority::text AS priority,
              opened_at,
              assigned_at,
              first_response_at,
              escalation_count
            FROM security_appeals
            WHERE opened_at >= $1::timestamptz
              AND opened_at < $2::timestamptz
          )
          SELECT
            COUNT(*)::text AS total_opened,
            COUNT(*) FILTER (WHERE priority = 'critical')::text AS critical_opened,
            COUNT(*) FILTER (WHERE assigned_at IS NOT NULL)::text AS assigned_count,
            COUNT(*) FILTER (
              WHERE priority = 'critical'
                AND assigned_at IS NOT NULL
                AND assigned_at <= opened_at + interval '1 hour'
            )::text AS critical_assignment_sla_met_count,
            COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::text AS first_response_recorded_count,
            COUNT(*) FILTER (
              WHERE first_response_at IS NOT NULL
                AND (
                  (priority = 'critical' AND first_response_at <= opened_at + interval '8 hours')
                  OR
                  (priority <> 'critical' AND first_response_at <= opened_at + interval '24 hours')
                )
            )::text AS first_response_sla_met_count,
            COALESCE(SUM(escalation_count), 0)::text AS escalation_count_total,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (assigned_at - opened_at))
            ) FILTER (WHERE assigned_at IS NOT NULL) AS assignment_latency_seconds_p50,
            percentile_cont(0.95) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (assigned_at - opened_at))
            ) FILTER (WHERE assigned_at IS NOT NULL) AS assignment_latency_seconds_p95,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (first_response_at - opened_at))
            ) FILTER (WHERE first_response_at IS NOT NULL) AS first_response_latency_seconds_p50,
            percentile_cont(0.95) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (first_response_at - opened_at))
            ) FILTER (WHERE first_response_at IS NOT NULL) AS first_response_latency_seconds_p95
          FROM scoped
        `,
        [input.window_from, input.window_to]
      );

      const row = result.rows[0];
      const totalOpened = parseCount(row?.total_opened ?? 0);
      const criticalOpened = parseCount(row?.critical_opened ?? 0);
      const criticalAssignmentSlaMetCount = parseCount(
        row?.critical_assignment_sla_met_count ?? 0
      );
      const firstResponseSlaMetCount = parseCount(row?.first_response_sla_met_count ?? 0);

      return {
        window_from: input.window_from,
        window_to: input.window_to,
        total_opened: totalOpened,
        critical_opened: criticalOpened,
        assigned_count: parseCount(row?.assigned_count ?? 0),
        critical_assignment_sla_met_count: criticalAssignmentSlaMetCount,
        first_response_recorded_count: parseCount(row?.first_response_recorded_count ?? 0),
        first_response_sla_met_count: firstResponseSlaMetCount,
        escalation_count_total: parseCount(row?.escalation_count_total ?? 0),
        assignment_latency_seconds_p50: parseNullableNumber(
          row?.assignment_latency_seconds_p50 ?? null
        ),
        assignment_latency_seconds_p95: parseNullableNumber(
          row?.assignment_latency_seconds_p95 ?? null
        ),
        first_response_latency_seconds_p50: parseNullableNumber(
          row?.first_response_latency_seconds_p50 ?? null
        ),
        first_response_latency_seconds_p95: parseNullableNumber(
          row?.first_response_latency_seconds_p95 ?? null
        ),
        critical_assignment_sla_rate: clampRatio(
          criticalAssignmentSlaMetCount,
          criticalOpened
        ),
        first_response_sla_rate: clampRatio(firstResponseSlaMetCount, totalOpened)
      };
    }
  };
}

export function createPostgresPermanentBlockPromotionStore(
  options: PostgresPermanentBlockPromotionStoreOptions
): PermanentBlockPromotionStore {
  return {
    async validate(input) {
      const result = await options.db.query<{
        eligible: boolean;
        trusted_reporter_count: string | number;
        distinct_active_key_count: string | number;
        corroborating_report_count: string | number;
        reviewer_confirmed: boolean;
        evidence: unknown;
      }>(
        `
          SELECT
            eligible,
            trusted_reporter_count,
            distinct_active_key_count,
            corroborating_report_count,
            reviewer_confirmed,
            evidence
          FROM security_validate_perm_block_requirements(
            $1::uuid,
            $2,
            $3::timestamptz,
            $4::interval
          )
        `,
        [
          toUuidOrThrow('package_id', input.package_id),
          input.reviewer_id,
          input.reviewer_confirmed_at,
          input.window_interval ?? '30 days'
        ]
      );

      const row = result.rows[0];
      return {
        eligible: Boolean(row?.eligible),
        trusted_reporter_count: parseCount(row?.trusted_reporter_count ?? 0),
        distinct_active_key_count: parseCount(row?.distinct_active_key_count ?? 0),
        corroborating_report_count: parseCount(row?.corroborating_report_count ?? 0),
        reviewer_confirmed: Boolean(row?.reviewer_confirmed),
        evidence: parseJsonObject(row?.evidence ?? {})
      } satisfies PermanentBlockValidationResult;
    },

    async promote(input) {
      const result = await options.db.query<{
        action_id: string;
        evidence: unknown;
      }>(
        `
          SELECT
            action_id,
            evidence
          FROM security_promote_policy_block_perm(
            $1::uuid,
            $2,
            $3,
            $4::timestamptz,
            $5::timestamptz
          )
        `,
        [
          toUuidOrThrow('package_id', input.package_id),
          input.reason_code,
          input.reviewer_id,
          input.reviewer_confirmed_at,
          input.created_at
        ]
      );

      const row = result.rows[0];
      if (!row?.action_id) {
        throw new Error('perm_block_promotion_failed');
      }

      return {
        action_id: row.action_id,
        evidence: parseJsonObject(row.evidence)
      } satisfies PermanentBlockPromotionRecord;
    }
  };
}

export function createPostgresSecurityRolloutStateStore(
  options: PostgresSecurityRolloutStateStoreOptions
): SecurityRolloutStateStore {
  const upsertState = async (input: {
    current_mode: SecurityRolloutMode;
    freeze_active: boolean;
    freeze_reason: string | null;
    decision_run_id: string | null;
    decision_evidence: Record<string, unknown>;
    updated_at: string;
  }): Promise<SecurityRolloutState> => {
    const result = await options.db.query<{
      current_mode: SecurityRolloutMode;
      freeze_active: boolean;
      freeze_reason: string | null;
      decision_run_id: string | null;
      decision_evidence: unknown;
      updated_at: string;
    }>(
      `
        INSERT INTO security_enforcement_rollout_state (
          singleton_key,
          current_mode,
          freeze_active,
          freeze_reason,
          decision_run_id,
          decision_evidence,
          updated_at
        )
        VALUES (
          TRUE,
          $1::security_rollout_mode,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::timestamptz
        )
        ON CONFLICT (singleton_key) DO UPDATE
        SET
          current_mode = EXCLUDED.current_mode,
          freeze_active = EXCLUDED.freeze_active,
          freeze_reason = EXCLUDED.freeze_reason,
          decision_run_id = EXCLUDED.decision_run_id,
          decision_evidence = EXCLUDED.decision_evidence,
          updated_at = EXCLUDED.updated_at
        RETURNING
          current_mode::text AS current_mode,
          freeze_active,
          freeze_reason,
          decision_run_id,
          decision_evidence,
          updated_at::text AS updated_at
      `,
      [
        input.current_mode,
        input.freeze_active,
        input.freeze_reason,
        input.decision_run_id,
        JSON.stringify(input.decision_evidence),
        input.updated_at
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('rollout_state_upsert_failed');
    }

    return {
      current_mode: row.current_mode,
      freeze_active: row.freeze_active,
      freeze_reason: row.freeze_reason,
      decision_run_id: row.decision_run_id,
      decision_evidence: parseJsonObject(row.decision_evidence),
      updated_at: row.updated_at
    } satisfies SecurityRolloutState;
  };

  return {
    async getState() {
      const result = await options.db.query<{
        current_mode: SecurityRolloutMode;
        freeze_active: boolean;
        freeze_reason: string | null;
        decision_run_id: string | null;
        decision_evidence: unknown;
        updated_at: string;
      }>(
        `
          SELECT
            current_mode::text AS current_mode,
            freeze_active,
            freeze_reason,
            decision_run_id,
            decision_evidence,
            updated_at::text AS updated_at
          FROM security_enforcement_rollout_state
          WHERE singleton_key = TRUE
          LIMIT 1
        `
      );

      const row = result.rows[0];
      if (!row) {
        return upsertState({
          current_mode: 'raw-only',
          freeze_active: true,
          freeze_reason: 'rollout_state_row_missing',
          decision_run_id: 'bootstrap',
          decision_evidence: {
            fallback_bootstrap: true
          },
          updated_at: new Date().toISOString()
        });
      }

      return {
        current_mode: row.current_mode,
        freeze_active: row.freeze_active,
        freeze_reason: row.freeze_reason,
        decision_run_id: row.decision_run_id,
        decision_evidence: parseJsonObject(row.decision_evidence),
        updated_at: row.updated_at
      } satisfies SecurityRolloutState;
    },

    async updateState(input) {
      return upsertState(input);
    }
  };
}

export function createPostgresSecurityPromotionDecisionStore(
  options: PostgresSecurityPromotionDecisionStoreOptions
): SecurityPromotionDecisionStore {
  return {
    async listRecent(limit) {
      const result = await options.db.query<{
        run_id: string;
        decision_type: SecurityPromotionDecisionRecord['decision_type'];
        previous_mode: SecurityRolloutMode;
        decided_mode: SecurityRolloutMode;
        freeze_active: boolean;
        gate_false_positive_pass: boolean;
        gate_appeals_sla_pass: boolean;
        gate_backlog_pass: boolean;
        window_from: string;
        window_to: string;
        trigger: string;
        evidence: unknown;
        created_at: string;
      }>(
        `
          SELECT
            run_id,
            decision_type,
            previous_mode::text AS previous_mode,
            decided_mode::text AS decided_mode,
            freeze_active,
            gate_false_positive_pass,
            gate_appeals_sla_pass,
            gate_backlog_pass,
            window_from::text AS window_from,
            window_to::text AS window_to,
            trigger,
            evidence,
            created_at::text AS created_at
          FROM security_enforcement_promotion_decisions
          ORDER BY window_to DESC, created_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return result.rows.map((row) => ({
        run_id: row.run_id,
        decision_type: row.decision_type,
        previous_mode: row.previous_mode,
        decided_mode: row.decided_mode,
        freeze_active: row.freeze_active,
        gate_false_positive_pass: row.gate_false_positive_pass,
        gate_appeals_sla_pass: row.gate_appeals_sla_pass,
        gate_backlog_pass: row.gate_backlog_pass,
        window_from: row.window_from,
        window_to: row.window_to,
        trigger: row.trigger,
        evidence: parseJsonObject(row.evidence),
        created_at: row.created_at
      }));
    },

    async append(decision) {
      await options.db.query(
        `
          INSERT INTO security_enforcement_promotion_decisions (
            run_id,
            decision_type,
            previous_mode,
            decided_mode,
            freeze_active,
            gate_false_positive_pass,
            gate_appeals_sla_pass,
            gate_backlog_pass,
            window_from,
            window_to,
            trigger,
            evidence,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3::security_rollout_mode,
            $4::security_rollout_mode,
            $5,
            $6,
            $7,
            $8,
            $9::timestamptz,
            $10::timestamptz,
            $11,
            $12::jsonb,
            $13::timestamptz
          )
          ON CONFLICT (run_id) DO UPDATE
          SET
            decision_type = EXCLUDED.decision_type,
            previous_mode = EXCLUDED.previous_mode,
            decided_mode = EXCLUDED.decided_mode,
            freeze_active = EXCLUDED.freeze_active,
            gate_false_positive_pass = EXCLUDED.gate_false_positive_pass,
            gate_appeals_sla_pass = EXCLUDED.gate_appeals_sla_pass,
            gate_backlog_pass = EXCLUDED.gate_backlog_pass,
            window_from = EXCLUDED.window_from,
            window_to = EXCLUDED.window_to,
            trigger = EXCLUDED.trigger,
            evidence = EXCLUDED.evidence,
            created_at = EXCLUDED.created_at
        `,
        [
          decision.run_id,
          decision.decision_type,
          decision.previous_mode,
          decision.decided_mode,
          decision.freeze_active,
          decision.gate_false_positive_pass,
          decision.gate_appeals_sla_pass,
          decision.gate_backlog_pass,
          decision.window_from,
          decision.window_to,
          decision.trigger,
          JSON.stringify(decision.evidence),
          decision.created_at
        ]
      );
    }
  };
}

export function createPostgresSecurityTrustGateMetricsStore(
  options: PostgresSecurityTrustGateMetricsStoreOptions
): SecurityTrustGateMetricsStore {
  return {
    async getSnapshot(input) {
      const result = await options.db.query<{
        false_positive_numerator: string | number;
        false_positive_denominator: string | number;
        appeals_sla_numerator: string | number;
        appeals_sla_denominator: string | number;
        unresolved_critical_backlog_breach_count: string | number;
      }>(
        `
          WITH scoped AS (
            SELECT
              priority::text AS priority,
              status::text AS status,
              opened_at,
              first_response_at,
              resolution::text AS resolution
            FROM security_appeals
            WHERE opened_at >= $1::timestamptz
              AND opened_at < $2::timestamptz
          ),
          false_positive AS (
            SELECT
              COUNT(*) FILTER (
                WHERE resolution = 'reversed_false_positive'
              )::text AS numerator,
              COUNT(*) FILTER (
                WHERE resolution IN ('upheld', 'reversed_false_positive')
              )::text AS denominator
            FROM scoped
            WHERE resolution IS NOT NULL
          ),
          appeals_sla AS (
            SELECT
              COUNT(*) FILTER (
                WHERE first_response_at IS NOT NULL
                  AND (
                    (priority = 'critical' AND first_response_at <= opened_at + interval '8 hours')
                    OR
                    (priority <> 'critical' AND first_response_at <= opened_at + interval '24 hours')
                  )
              )::text AS numerator,
              COUNT(*)::text AS denominator
            FROM scoped
          ),
          backlog AS (
            SELECT
              COUNT(*)::text AS breach_count
            FROM security_appeals
            WHERE priority = 'critical'
              AND status IN ('open', 'triaged', 'in_review')
              AND opened_at <= $3::timestamptz - interval '8 hours'
          )
          SELECT
            false_positive.numerator AS false_positive_numerator,
            false_positive.denominator AS false_positive_denominator,
            appeals_sla.numerator AS appeals_sla_numerator,
            appeals_sla.denominator AS appeals_sla_denominator,
            backlog.breach_count AS unresolved_critical_backlog_breach_count
          FROM false_positive
          CROSS JOIN appeals_sla
          CROSS JOIN backlog
        `,
        [input.window_from, input.window_to, input.now_iso]
      );

      const row = result.rows[0];
      const falsePositiveNumerator = parseCount(row?.false_positive_numerator ?? 0);
      const falsePositiveDenominator = parseCount(row?.false_positive_denominator ?? 0);
      const appealsSlaNumerator = parseCount(row?.appeals_sla_numerator ?? 0);
      const appealsSlaDenominator = parseCount(row?.appeals_sla_denominator ?? 0);

      return {
        false_positive_numerator: falsePositiveNumerator,
        false_positive_denominator: falsePositiveDenominator,
        false_positive_rate: clampRatio(
          falsePositiveNumerator,
          falsePositiveDenominator
        ),
        appeals_sla_numerator: appealsSlaNumerator,
        appeals_sla_denominator: appealsSlaDenominator,
        appeals_sla_rate: clampRatio(appealsSlaNumerator, appealsSlaDenominator),
        unresolved_critical_backlog_breach_count: parseCount(
          row?.unresolved_critical_backlog_breach_count ?? 0
        ),
        metrics_generated_at: input.now_iso
      } satisfies SecurityTrustGateSnapshot;
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
