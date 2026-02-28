import { createHash, randomUUID } from 'node:crypto';
import {
  createCopilotVscodeAdapterContract,
  orderCopilotScopeWrites,
  type CopilotAdapterContract,
  type CopilotScopeDescriptor,
  type CopilotServerEntry
} from '@forge/copilot-vscode-adapter';
import {
  evaluatePolicyPreflight,
  type PolicyPreflightInput,
  type PolicyPreflightResult
} from '@forge/policy-engine';
import type { RuntimePipelineResult, RuntimeStartRequest } from '@forge/runtime-daemon';
import {
  stableCanonicalJson,
  type ReporterSignatureValidationInput,
  type ReporterSignatureVerifier
} from '@forge/security-governance';
import {
  resolveDependencyGraph,
  type DependencyConflict,
  type DependencyEdge
} from '@forge/shared-contracts';

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

export interface PostgresTransactionalQueryExecutor extends PostgresQueryExecutor {
  withTransaction?<T>(callback: (tx: PostgresQueryExecutor) => Promise<T>): Promise<T>;
}

export type InstallPlanStatus =
  | 'planned'
  | 'apply_succeeded'
  | 'apply_failed'
  | 'verify_succeeded'
  | 'verify_failed'
  | 'remove_succeeded'
  | 'remove_failed'
  | 'rollback_succeeded'
  | 'rollback_failed';

export type InstallActionType = 'write_entry' | 'remove_entry' | 'skip_scope';
export type InstallActionStatus = 'pending' | 'applied' | 'failed' | 'skipped';

export type InstallLifecycleOutboxEventType =
  | 'install.plan.created'
  | 'install.apply.succeeded'
  | 'install.apply.failed'
  | 'install.update.succeeded'
  | 'install.update.failed'
  | 'install.remove.succeeded'
  | 'install.remove.failed'
  | 'install.rollback.succeeded'
  | 'install.rollback.failed'
  | 'install.verify.succeeded'
  | 'install.verify.failed';

export interface InstallLifecycleOutboxEnvelope {
  event_type: InstallLifecycleOutboxEventType;
  dedupe_key: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface InstallLifecycleOutboxPublisher {
  publish(envelope: InstallLifecycleOutboxEnvelope): Promise<void>;
}

export interface LifecycleIdempotencyRecord {
  scope: string;
  idempotency_key: string;
  request_hash: string;
  response_code: number;
  response_body: unknown;
  stored_at: string;
}

export interface LifecycleIdempotencyAdapter {
  get(scope: string, idempotencyKey: string): Promise<LifecycleIdempotencyRecord | null>;
  put(record: LifecycleIdempotencyRecord): Promise<void>;
}

export interface InstallLifecycleLogger {
  log(event: {
    event_name:
      | 'install.plan.created'
      | 'install.plan.replayed'
      | 'install.apply.completed'
      | 'install.verify.completed';
    occurred_at: string;
    payload: Record<string, unknown>;
  }): void | Promise<void>;
}

type InstallLifecycleLogEventName =
  | 'install.plan.created'
  | 'install.plan.replayed'
  | 'install.apply.completed'
  | 'install.verify.completed';

export interface InstallPlanAction {
  action_order: number;
  action_type: InstallActionType;
  scope: 'workspace' | 'user_profile' | 'daemon_default';
  scope_path: string;
  status: InstallActionStatus;
  reason_code: string;
  payload: Record<string, unknown>;
  last_error: string | null;
}

export interface InstallPlan {
  internal_id: string;
  plan_id: string;
  package_id: string;
  package_slug: string;
  target_client: 'vscode_copilot';
  target_mode: 'local';
  status: InstallPlanStatus;
  reason_code: string | null;
  policy_outcome: PolicyPreflightResult['outcome'];
  policy_reason_code: string | null;
  security_state: string;
  planner_version: string;
  plan_hash: string;
  policy_input: PolicyPreflightInput;
  runtime_context: InstallRuntimeContext;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
  actions: InstallPlanAction[];
}

export interface InstallPlanCreateRequest {
  package_id: string;
  package_slug?: string;
  correlation_id?: string;
  org_id: string;
  requested_permissions: string[];
  org_policy: PolicyPreflightInput['org_policy'];
  trust_state?: RuntimeStartRequest['trust_state'];
  trust_reset_trigger?: RuntimeStartRequest['trust_reset_trigger'];
  dependency_edges?: DependencyEdge[];
  known_package_ids?: string[];
}

export interface InstallRuntimeContext {
  trust_state: RuntimeStartRequest['trust_state'];
  trust_reset_trigger: RuntimeStartRequest['trust_reset_trigger'];
  mode: RuntimeStartRequest['mode'];
  transport: RuntimeStartRequest['transport'];
}

export interface DependencyResolutionSummary {
  resolved_order: string[];
  resolved_count: number;
  conflicts: DependencyConflict[];
}

export interface InstallPlanCreateResponse {
  status: 'planned';
  replayed: boolean;
  plan_id: string;
  package_id: string;
  package_slug: string;
  policy_outcome: PolicyPreflightResult['outcome'];
  policy_reason_code: string | null;
  security_state: string;
  action_count: number;
  dependency_resolution?: DependencyResolutionSummary;
}

export interface InstallApplyResponse {
  status: 'apply_succeeded' | 'apply_failed';
  replayed: boolean;
  plan_id: string;
  attempt_number: number;
  reason_code: string | null;
}

export interface InstallUpdateResponse {
  status: 'update_succeeded' | 'update_failed';
  replayed: boolean;
  plan_id: string;
  attempt_number: number;
  reason_code: string | null;
  target_version: string | null;
}

export interface InstallRemoveResponse {
  status: 'remove_succeeded' | 'remove_failed';
  replayed: boolean;
  plan_id: string;
  attempt_number: number;
  reason_code: string | null;
}

export interface InstallRollbackResponse {
  status: 'rollback_succeeded' | 'rollback_failed';
  replayed: boolean;
  plan_id: string;
  attempt_number: number;
  reason_code: string | null;
  rollback_mode: 'cleanup_partial_install' | 'restore_removed_entries';
  source_operation: 'apply' | 'update' | 'remove' | 'rollback';
}

export interface InstallVerifyResponse {
  status: 'verify_succeeded' | 'verify_failed';
  replayed: boolean;
  plan_id: string;
  attempt_number: number;
  readiness: boolean;
  reason_code: string | null;
  stages: RuntimePipelineResult['stages'];
}

export interface InstallRuntimeVerifier {
  run(request: RuntimeStartRequest): Promise<RuntimePipelineResult>;
  writeScopeSidecarGuarded?(request: {
    scope_hash: string;
    scope_daemon_owned: boolean;
    record: {
      package_id: string;
      package_slug: string;
      plan_id: string;
      applied_at: string;
      scope: string;
      scope_path: string;
    };
    options?: {
      baseDir?: string;
      owner?: string;
      allowMerge?: boolean;
    };
  }): Promise<{ ok: boolean; reason_code: string | null }>;
}

export interface InstallLifecycleServiceDependencies {
  db: PostgresTransactionalQueryExecutor;
  copilotAdapter: CopilotAdapterContract;
  runtimeVerifier: InstallRuntimeVerifier;
  idempotency: LifecycleIdempotencyAdapter;
  policyPreflight?: {
    preflight(input: PolicyPreflightInput): Promise<PolicyPreflightResult>;
  };
  outboxPublisher?: InstallLifecycleOutboxPublisher;
  logger?: InstallLifecycleLogger;
  now?: () => Date;
  idFactory?: () => string;
}

interface ScopeMapping {
  [scope: string]: CopilotScopeDescriptor;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(record)) {
    if (/secret|token|authorization|credential|password/i.test(key)) {
      redacted[key] = '[REDACTED]';
      continue;
    }

    redacted[key] = redactSensitive(nestedValue);
  }

  return redacted;
}

async function runInTransaction<T>(
  db: PostgresTransactionalQueryExecutor,
  callback: (tx: PostgresQueryExecutor) => Promise<T>
): Promise<T> {
  if (db.withTransaction) {
    return db.withTransaction(callback);
  }

  await db.query('BEGIN');
  try {
    const result = await callback(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function parsePolicyInput(value: unknown): PolicyPreflightInput {
  const record = parseJsonObject(value);
  return {
    org_id: String(record.org_id ?? 'org-unknown'),
    package_id: String(record.package_id ?? 'package-unknown'),
    requested_permissions: Array.isArray(record.requested_permissions)
      ? record.requested_permissions.map((entry) => String(entry))
      : [],
    org_policy: {
      mcp_enabled:
        typeof (record.org_policy as Record<string, unknown> | undefined)?.mcp_enabled ===
        'boolean'
          ? Boolean((record.org_policy as Record<string, unknown>).mcp_enabled)
          : false,
      server_allowlist: Array.isArray(
        (record.org_policy as Record<string, unknown> | undefined)?.server_allowlist
      )
        ? ((record.org_policy as Record<string, unknown>).server_allowlist as unknown[]).map(
            (entry) => String(entry)
          )
        : [],
      block_flagged:
        typeof (record.org_policy as Record<string, unknown> | undefined)?.block_flagged ===
        'boolean'
          ? Boolean((record.org_policy as Record<string, unknown>).block_flagged)
          : false,
      permission_caps: {
        maxPermissions:
          typeof (
            (record.org_policy as Record<string, unknown> | undefined)?.permission_caps as
              | Record<string, unknown>
              | undefined
          )?.maxPermissions === 'number'
            ? Number(
                (
                  (record.org_policy as Record<string, unknown>).permission_caps as Record<
                    string,
                    unknown
                  >
                ).maxPermissions
              )
            : 0,
        disallowedPermissions: Array.isArray(
          (
            (record.org_policy as Record<string, unknown> | undefined)?.permission_caps as
              | Record<string, unknown>
              | undefined
          )?.disallowedPermissions
        )
          ? (
              (
                (record.org_policy as Record<string, unknown>).permission_caps as Record<
                  string,
                  unknown
                >
              ).disallowedPermissions as unknown[]
            ).map((entry) => String(entry))
          : []
      }
    },
    enforcement: {
      package_id: String(
        (record.enforcement as Record<string, unknown> | undefined)?.package_id ??
          record.package_id ??
          'package-unknown'
      ),
      state: String((record.enforcement as Record<string, unknown> | undefined)?.state ?? 'none') as
        | 'none'
        | 'flagged'
        | 'policy_blocked_temp'
        | 'policy_blocked_perm'
        | 'reinstated',
      reason_code:
        (record.enforcement as Record<string, unknown> | undefined)?.reason_code === null
          ? null
          : String((record.enforcement as Record<string, unknown> | undefined)?.reason_code ?? null),
      policy_blocked: Boolean(
        (record.enforcement as Record<string, unknown> | undefined)?.policy_blocked
      ),
      source: String(
        (record.enforcement as Record<string, unknown> | undefined)?.source ?? 'none'
      ) as 'security_governance' | 'org_policy' | 'none',
      updated_at: String(
        (record.enforcement as Record<string, unknown> | undefined)?.updated_at ??
          '1970-01-01T00:00:00.000Z'
      )
    }
  };
}

function parseRuntimeContext(value: unknown): InstallRuntimeContext {
  const record = parseJsonObject(value);
  return {
    trust_state: String(record.trust_state ?? 'trusted') as RuntimeStartRequest['trust_state'],
    trust_reset_trigger: String(record.trust_reset_trigger ?? 'none') as RuntimeStartRequest['trust_reset_trigger'],
    mode: String(record.mode ?? 'local') as RuntimeStartRequest['mode'],
    transport: String(record.transport ?? 'stdio') as RuntimeStartRequest['transport']
  };
}

async function resolvePackageRecord(
  db: PostgresQueryExecutor,
  packageId: string
): Promise<{ package_id: string; package_slug: string } | null> {
  const result = await db.query<{ package_id: string; package_slug: string | null }>(
    `
      SELECT
        id::text AS package_id,
        package_slug
      FROM registry.packages
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [packageId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    package_id: row.package_id,
    package_slug: row.package_slug ?? `pkg/${row.package_id}`
  };
}

async function resolveSecurityProjection(
  db: PostgresQueryExecutor,
  packageId: string,
  nowIso: string
): Promise<PolicyPreflightInput['enforcement']> {
  const result = await db.query<{
    package_id: string;
    state: string;
    reason_code: string | null;
    policy_blocked: boolean;
    source: 'security_governance' | 'org_policy' | 'none';
    updated_at: string;
  }>(
    `
      SELECT
        package_id::text AS package_id,
        state::text AS state,
        reason_code,
        policy_blocked,
        source::text AS source,
        updated_at::text AS updated_at
      FROM security_enforcement_projections
      WHERE package_id = $1::uuid
      LIMIT 1
    `,
    [packageId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      package_id: packageId,
      state: 'none',
      reason_code: null,
      policy_blocked: false,
      source: 'none',
      updated_at: nowIso
    };
  }

  return {
    package_id: row.package_id,
    state: row.state as
      | 'none'
      | 'flagged'
      | 'policy_blocked_temp'
      | 'policy_blocked_perm'
      | 'reinstated',
    reason_code: row.reason_code,
    policy_blocked: row.policy_blocked,
    source: row.source,
    updated_at: row.updated_at
  };
}

async function loadPlan(
  db: PostgresQueryExecutor,
  planId: string
): Promise<InstallPlan | null> {
  const planResult = await db.query<{
    internal_id: string;
    plan_id: string;
    package_id: string;
    package_slug: string;
    target_client: 'vscode_copilot';
    target_mode: 'local';
    status: InstallPlanStatus;
    reason_code: string | null;
    policy_outcome: PolicyPreflightResult['outcome'];
    policy_reason_code: string | null;
    security_state: string;
    planner_version: string;
    plan_hash: string;
    policy_input: unknown;
    runtime_context: unknown;
    correlation_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id::text AS internal_id,
        plan_id,
        package_id::text AS package_id,
        package_slug,
        target_client,
        target_mode,
        status,
        reason_code,
        policy_outcome,
        policy_reason_code,
        security_state,
        planner_version,
        plan_hash,
        policy_input,
        runtime_context,
        correlation_id,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM install_plans
      WHERE plan_id = $1
      LIMIT 1
    `,
    [planId]
  );

  const planRow = planResult.rows[0];
  if (!planRow) {
    return null;
  }

  const actionsResult = await db.query<{
    action_order: number;
    action_type: InstallActionType;
    scope: InstallPlanAction['scope'];
    scope_path: string;
    status: InstallActionStatus;
    reason_code: string;
    payload: unknown;
    last_error: string | null;
  }>(
    `
      SELECT
        action_order,
        action_type,
        scope,
        scope_path,
        status,
        reason_code,
        payload,
        last_error
      FROM install_plan_actions
      WHERE plan_internal_id = $1::uuid
      ORDER BY action_order ASC
    `,
    [planRow.internal_id]
  );

  return {
    internal_id: planRow.internal_id,
    plan_id: planRow.plan_id,
    package_id: planRow.package_id,
    package_slug: planRow.package_slug,
    target_client: planRow.target_client,
    target_mode: planRow.target_mode,
    status: planRow.status,
    reason_code: planRow.reason_code,
    policy_outcome: planRow.policy_outcome,
    policy_reason_code: planRow.policy_reason_code,
    security_state: planRow.security_state,
    planner_version: planRow.planner_version,
    plan_hash: planRow.plan_hash,
    policy_input: parsePolicyInput(planRow.policy_input),
    runtime_context: parseRuntimeContext(planRow.runtime_context),
    correlation_id: planRow.correlation_id,
    created_at: planRow.created_at,
    updated_at: planRow.updated_at,
    actions: actionsResult.rows.map((action) => ({
      action_order: action.action_order,
      action_type: action.action_type,
      scope: action.scope,
      scope_path: action.scope_path,
      status: action.status,
      reason_code: action.reason_code,
      payload: parseJsonObject(action.payload),
      last_error: action.last_error
    }))
  };
}

async function appendAuditRow(
  tx: PostgresQueryExecutor,
  planInternalId: string,
  input: {
    stage: 'plan' | 'apply' | 'verify' | 'remove' | 'rollback';
    event_type: string;
    status: string;
    reason_code: string | null;
    correlation_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }
): Promise<void> {
  await tx.query(
    `
      INSERT INTO install_plan_audit (
        plan_internal_id,
        stage,
        event_type,
        status,
        reason_code,
        correlation_id,
        details,
        created_at
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8::timestamptz
      )
    `,
    [
      planInternalId,
      input.stage,
      input.event_type,
      input.status,
      input.reason_code,
      input.correlation_id,
      JSON.stringify(input.details),
      input.created_at
    ]
  );
}

async function resolveAttemptNumber(
  db: PostgresQueryExecutor,
  tableName: 'install_apply_attempts' | 'install_verify_attempts',
  planInternalId: string
): Promise<number> {
  const result = await db.query<{ max_attempt: string }>(
    `
      SELECT COALESCE(MAX(attempt_number), 0)::text AS max_attempt
      FROM ${tableName}
      WHERE plan_internal_id = $1::uuid
    `,
    [planInternalId]
  );

  return Number.parseInt(result.rows[0]?.max_attempt ?? '0', 10) + 1;
}

function createScopeMap(scopes: CopilotScopeDescriptor[]): ScopeMapping {
  const map: ScopeMapping = {};
  for (const scope of scopes) {
    map[scope.scope] = scope;
  }
  return map;
}

async function resolveRequiredProfileReferenceCount(
  db: PostgresQueryExecutor,
  packageId: string
): Promise<number> {
  try {
    const result = await db.query<{ required_count: string }>(
      `
        SELECT COUNT(*)::text AS required_count
        FROM profile_packages
        WHERE package_id = $1::uuid
          AND required = TRUE
      `,
      [packageId]
    );

    return Number.parseInt(result.rows[0]?.required_count ?? '0', 10);
  } catch (error) {
    const postgresCode = (error as { code?: string })?.code;
    if (postgresCode === '42P01') {
      return 0;
    }

    throw error;
  }
}

async function resolveLatestApplyAttempt(
  db: PostgresQueryExecutor,
  planInternalId: string
): Promise<{
  attempt_number: number;
  status: 'succeeded' | 'failed' | 'replayed';
  reason_code: string | null;
  details: Record<string, unknown>;
} | null> {
  const result = await db.query<{
    attempt_number: number;
    status: 'succeeded' | 'failed' | 'replayed';
    reason_code: string | null;
    details: unknown;
  }>(
    `
      SELECT
        attempt_number,
        status,
        reason_code,
        details
      FROM install_apply_attempts
      WHERE plan_internal_id = $1::uuid
      ORDER BY attempt_number DESC
      LIMIT 1
    `,
    [planInternalId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    attempt_number: row.attempt_number,
    status: row.status,
    reason_code: row.reason_code,
    details: parseJsonObject(row.details)
  };
}

function buildLifecycleRequestHash(payload: unknown): string {
  return sha256Hex(stableCanonicalJson(payload));
}

export function createPostgresLifecycleIdempotencyAdapter(options: {
  db: PostgresQueryExecutor;
}): LifecycleIdempotencyAdapter {
  return {
    async get(scope, idempotencyKey) {
      const result = await options.db.query<{
        scope: string;
        idempotency_key: string;
        request_hash: string;
        response_code: number;
        response_body: unknown;
        stored_at: string;
      }>(
        `
          SELECT
            scope,
            idempotency_key,
            request_hash,
            response_code,
            response_body,
            stored_at::text AS stored_at
          FROM ingestion_idempotency_records
          WHERE scope = $1 AND idempotency_key = $2
          LIMIT 1
        `,
        [scope, idempotencyKey]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        scope: row.scope,
        idempotency_key: row.idempotency_key,
        request_hash: row.request_hash,
        response_code: row.response_code,
        response_body: row.response_body,
        stored_at: row.stored_at
      };
    },

    async put(record) {
      const result = await options.db.query<{ request_hash: string }>(
        `
          INSERT INTO ingestion_idempotency_records (
            scope,
            idempotency_key,
            request_hash,
            response_code,
            response_body,
            stored_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5::jsonb,
            $6::timestamptz
          )
          ON CONFLICT (scope, idempotency_key) DO UPDATE
          SET
            request_hash = EXCLUDED.request_hash,
            response_code = EXCLUDED.response_code,
            response_body = EXCLUDED.response_body,
            stored_at = EXCLUDED.stored_at
          WHERE ingestion_idempotency_records.request_hash = EXCLUDED.request_hash
          RETURNING request_hash
        `,
        [
          record.scope,
          record.idempotency_key,
          record.request_hash,
          record.response_code,
          JSON.stringify(record.response_body),
          record.stored_at
        ]
      );

      if ((result.rowCount ?? result.rows.length) === 0) {
        throw new Error('idempotency_conflict: same key reused with different request hash');
      }
    }
  };
}

export function createPostgresInstallOutboxPublisher(options: {
  db: PostgresQueryExecutor;
  sourceService?: string;
}): InstallLifecycleOutboxPublisher {
  const sourceService = options.sourceService ?? 'control-plane';

  return {
    async publish(envelope) {
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

export function createDbBackedReporterSignatureVerifier(options: {
  db: PostgresQueryExecutor;
  verifySignature?: (input: {
    reporter_id: string;
    key_id: string;
    canonical_string: string;
    signature: string;
    key_algorithm: string;
  }) => Promise<boolean>;
}): ReporterSignatureVerifier {
  const verifySignature =
    options.verifySignature ??
    (async (input) => {
      const expected = sha256Hex(
        `${input.reporter_id}:${input.key_id}:${input.canonical_string}:${input.key_algorithm}`
      );
      return input.signature === expected;
    });

  return {
    async verify(input: ReporterSignatureValidationInput): Promise<boolean> {
      const keyResult = await options.db.query<{
        reporter_id: string;
        key_id: string;
        key_algorithm: string;
        active: boolean;
        revoked_at: string | null;
      }>(
        `
          SELECT
            reporter_id,
            key_id,
            key_algorithm,
            active,
            revoked_at::text AS revoked_at
          FROM security_reporter_keys
          WHERE reporter_id = $1 AND key_id = $2
          LIMIT 1
        `,
        [input.reporter_id, input.key_id]
      );

      const key = keyResult.rows[0];
      if (!key || !key.active || key.revoked_at !== null) {
        return false;
      }

      return verifySignature({
        reporter_id: input.reporter_id,
        key_id: input.key_id,
        canonical_string: input.canonical_string,
        signature: input.signature,
        key_algorithm: key.key_algorithm
      });
    }
  };
}

export function createInstallLifecycleService(
  dependencies: InstallLifecycleServiceDependencies
) {
  const now = dependencies.now ?? (() => new Date());
  const idFactory = dependencies.idFactory ?? (() => randomUUID());
  const policyPreflight = dependencies.policyPreflight ?? {
    async preflight(input: PolicyPreflightInput) {
      return evaluatePolicyPreflight(input);
    }
  };

  const safeLog = async (
    eventName: InstallLifecycleLogEventName,
    occurredAt: string,
    payload: Record<string, unknown>
  ) => {
    if (!dependencies.logger) {
      return;
    }

    await dependencies.logger.log({
      event_name: eventName,
      occurred_at: occurredAt,
      payload: redactSensitive(payload) as Record<string, unknown>
    });
  };

  return {
    async createPlan(
      request: InstallPlanCreateRequest,
      idempotencyKey: string | null
    ): Promise<InstallPlanCreateResponse> {
      const nowIso = now().toISOString();
      const idempotencyScope = 'POST:/v1/install/plans';
      const requestHash = buildLifecycleRequestHash(request);

      if (idempotencyKey) {
        const existing = await dependencies.idempotency.get(idempotencyScope, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new Error('idempotency_conflict');
          }

          const replayedResponse = existing.response_body as InstallPlanCreateResponse;
          await safeLog('install.plan.replayed', nowIso, {
            correlation_id: request.correlation_id ?? replayedResponse.plan_id,
            plan_id: replayedResponse.plan_id,
            idempotency_scope: idempotencyScope
          });

          return {
            ...replayedResponse,
            replayed: true
          };
        }
      }

      const packageRecord = await resolvePackageRecord(dependencies.db, request.package_id);
      if (!packageRecord) {
        throw new Error('package_not_found');
      }

      const securityProjection = await resolveSecurityProjection(
        dependencies.db,
        request.package_id,
        nowIso
      );

      const policyInput: PolicyPreflightInput = {
        org_id: request.org_id,
        package_id: request.package_id,
        requested_permissions: request.requested_permissions,
        org_policy: request.org_policy,
        enforcement: securityProjection
      };

      const policy = await policyPreflight.preflight(policyInput);
      const discoveredScopes = await dependencies.copilotAdapter.discover_scopes();
      const orderedScopes = orderCopilotScopeWrites(discoveredScopes);

      const actions: InstallPlanAction[] = [
        ...orderedScopes.ordered_writable.map<InstallPlanAction>((scope, index) => {
          const actionType: InstallActionType =
            policy.outcome === 'policy_blocked' ? 'skip_scope' : 'write_entry';
          return {
            action_order: index,
            action_type: actionType,
            scope: scope.scope,
            scope_path: scope.scope_path,
            status: 'pending',
            reason_code:
              policy.outcome === 'policy_blocked'
                ? 'policy_preflight_blocked'
                : 'scope_writable_approved',
            payload: {
              daemon_owned: scope.daemon_owned,
              approved: scope.approved,
              writable: scope.writable
            },
            last_error: null
          };
        }),
        ...orderedScopes.blocked.map<InstallPlanAction>((scope, offset) => ({
          action_order: orderedScopes.ordered_writable.length + offset,
          action_type: 'skip_scope',
          scope: scope.scope,
          scope_path: scope.scope_path,
          status: 'pending',
          reason_code: scope.approved ? 'scope_not_writable' : 'scope_not_approved',
          payload: {
            daemon_owned: scope.daemon_owned,
            approved: scope.approved,
            writable: scope.writable
          },
          last_error: null
        }))
      ];

      const runtimeContext: InstallRuntimeContext = {
        trust_state: request.trust_state ?? 'trusted',
        trust_reset_trigger: request.trust_reset_trigger ?? 'none',
        mode: 'local',
        transport: 'stdio'
      };

      // Resolve dependency graph if edges are provided
      let dependencyResolution: DependencyResolutionSummary | undefined;
      if (request.dependency_edges && request.dependency_edges.length > 0) {
        const knownIds = request.known_package_ids
          ? new Set([request.package_id, ...request.known_package_ids])
          : new Set([
              request.package_id,
              ...request.dependency_edges.flatMap((edge) => [
                edge.from_package_id,
                edge.to_package_id
              ])
            ]);

        const graphResult = resolveDependencyGraph({
          root_package_ids: [request.package_id],
          edges: request.dependency_edges,
          known_package_ids: knownIds
        });

        if (!graphResult.ok) {
          const conflictDetails = graphResult.conflicts
            .map((c) => `${c.kind}: ${c.message}`)
            .join('; ');
          throw new Error(`dependency_resolution_failed: ${conflictDetails}`);
        }

        dependencyResolution = {
          resolved_order: graphResult.resolved_order,
          resolved_count: graphResult.resolved_order.length,
          conflicts: graphResult.conflicts
        };
      }

      const planId = idFactory();
      const effectiveCorrelationId = request.correlation_id ?? planId;
      const planHash = sha256Hex(
        stableCanonicalJson({
          package_id: request.package_id,
          policy_outcome: policy.outcome,
          policy_reason_code: policy.reason_code,
          security_state: securityProjection.state,
          actions,
          runtime_context: runtimeContext,
          dependency_resolution: dependencyResolution ?? null
        })
      );

      await runInTransaction(dependencies.db, async (tx) => {
        const insertedPlan = await tx.query<{ internal_id: string }>(
          `
            INSERT INTO install_plans (
              plan_id,
              package_id,
              package_slug,
              target_client,
              target_mode,
              status,
              reason_code,
              policy_outcome,
              policy_reason_code,
              security_state,
              planner_version,
              plan_hash,
              policy_input,
              runtime_context,
              correlation_id,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              $2::uuid,
              $3,
              'vscode_copilot',
              'local',
              'planned',
              $4,
              $5,
              $6,
              $7,
              'planner-v1',
              $8,
              $9::jsonb,
              $10::jsonb,
              $11,
              $12::timestamptz,
              $12::timestamptz
            )
            RETURNING id::text AS internal_id
          `,
          [
            planId,
            request.package_id,
            request.package_slug ?? packageRecord.package_slug,
            policy.reason_code,
            policy.outcome,
            policy.reason_code,
            securityProjection.state,
            planHash,
            JSON.stringify(policyInput),
            JSON.stringify(runtimeContext),
            effectiveCorrelationId,
            nowIso
          ]
        );

        const internalId = insertedPlan.rows[0]?.internal_id;
        if (!internalId) {
          throw new Error('plan_insert_failed');
        }

        for (const action of actions) {
          await tx.query(
            `
              INSERT INTO install_plan_actions (
                plan_internal_id,
                action_order,
                action_type,
                scope,
                scope_path,
                status,
                reason_code,
                payload,
                created_at,
                updated_at
              )
              VALUES (
                $1::uuid,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8::jsonb,
                $9::timestamptz,
                $9::timestamptz
              )
            `,
            [
              internalId,
              action.action_order,
              action.action_type,
              action.scope,
              action.scope_path,
              action.status,
              action.reason_code,
              JSON.stringify(action.payload),
              nowIso
            ]
          );
        }

        await appendAuditRow(tx, internalId, {
          stage: 'plan',
          event_type: 'install.plan.created',
          status: 'planned',
          reason_code: policy.reason_code,
          correlation_id: effectiveCorrelationId,
          details: {
            action_count: actions.length,
            policy_outcome: policy.outcome,
            security_state: securityProjection.state
          },
          created_at: nowIso
        });
      });

      if (dependencies.outboxPublisher) {
        await dependencies.outboxPublisher.publish({
          event_type: 'install.plan.created',
          dedupe_key: `${planId}:install.plan.created`,
          payload: {
            plan_id: planId,
            package_id: request.package_id,
            correlation_id: effectiveCorrelationId
          },
          occurred_at: nowIso
        });
      }

      const response: InstallPlanCreateResponse = {
        status: 'planned',
        replayed: false,
        plan_id: planId,
        package_id: request.package_id,
        package_slug: request.package_slug ?? packageRecord.package_slug,
        policy_outcome: policy.outcome,
        policy_reason_code: policy.reason_code,
        security_state: securityProjection.state,
        action_count: actions.length,
        ...(dependencyResolution !== undefined ? { dependency_resolution: dependencyResolution } : {})
      };

      if (idempotencyKey) {
        await dependencies.idempotency.put({
          scope: idempotencyScope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response_code: 200,
          response_body: response,
          stored_at: nowIso
        });
      }

      await safeLog('install.plan.created', nowIso, {
        correlation_id: effectiveCorrelationId,
        plan_id: planId,
        package_id: request.package_id,
        policy_outcome: policy.outcome
      });

      return response;
    },

    async getPlan(planId: string): Promise<InstallPlan | null> {
      return loadPlan(dependencies.db, planId);
    },

    async applyPlan(
      planId: string,
      idempotencyKey: string | null,
      correlationId: string | null
    ): Promise<InstallApplyResponse> {
      const nowIso = now().toISOString();
      const idempotencyScope = `POST:/v1/install/plans/${planId}/apply`;
      const requestHash = buildLifecycleRequestHash({ plan_id: planId });

      if (idempotencyKey) {
        const existing = await dependencies.idempotency.get(idempotencyScope, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new Error('idempotency_conflict');
          }

          return {
            ...(existing.response_body as InstallApplyResponse),
            replayed: true
          };
        }
      }

      const plan = await loadPlan(dependencies.db, planId);
      if (!plan) {
        throw new Error('plan_not_found');
      }

      const attemptNumber = await resolveAttemptNumber(
        dependencies.db,
        'install_apply_attempts',
        plan.internal_id
      );
      const effectiveCorrelationId =
        correlationId ?? plan.correlation_id ?? plan.plan_id;

      const scopeMap = createScopeMap(await dependencies.copilotAdapter.discover_scopes());
      const entry: CopilotServerEntry = {
        package_id: plan.package_id,
        package_slug: plan.package_slug,
        mode: 'local',
        transport: 'stdio',
        trust_state: plan.runtime_context.trust_state
      };

      let failedReason: string | null = null;

      await runInTransaction(dependencies.db, async (tx) => {
        for (const action of plan.actions) {
          if (action.action_type === 'skip_scope') {
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'skipped',
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
            continue;
          }

          const scope = scopeMap[action.scope];
          if (!scope) {
            failedReason = 'scope_not_found';
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $4,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso, failedReason]
            );
            break;
          }

          try {
            await dependencies.copilotAdapter.write_entry(scope, entry);

            if (dependencies.runtimeVerifier.writeScopeSidecarGuarded) {
              await dependencies.runtimeVerifier.writeScopeSidecarGuarded({
                scope_hash: sha256Hex(`${plan.package_id}:${scope.scope}:${scope.scope_path}`),
                scope_daemon_owned: scope.daemon_owned,
                record: {
                  package_id: plan.package_id,
                  package_slug: plan.package_slug,
                  plan_id: plan.plan_id,
                  applied_at: nowIso,
                  scope: scope.scope,
                  scope_path: scope.scope_path
                }
              });
            }

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'applied',
                  reason_code = 'apply_ok',
                  last_error = NULL,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
          } catch (error) {
            failedReason =
              error instanceof Error && error.name === 'CopilotFilesystemAdapterError'
                ? `adapter_${error.message}`
                : 'adapter_write_failed';

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $5,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [
                plan.internal_id,
                action.action_order,
                nowIso,
                failedReason,
                error instanceof Error ? error.message : 'unknown_error'
              ]
            );
            break;
          }
        }

        const finalStatus: InstallApplyResponse['status'] =
          failedReason === null ? 'apply_succeeded' : 'apply_failed';

        await tx.query(
          `
            INSERT INTO install_apply_attempts (
              plan_internal_id,
              attempt_number,
              status,
              reason_code,
              details,
              started_at,
              completed_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4,
              $5::jsonb,
              $6::timestamptz,
              $6::timestamptz
            )
          `,
          [
            plan.internal_id,
            attemptNumber,
            finalStatus === 'apply_succeeded' ? 'succeeded' : 'failed',
            failedReason,
            JSON.stringify({ correlation_id: effectiveCorrelationId }),
            nowIso
          ]
        );

        await tx.query(
          `
            UPDATE install_plans
            SET
              status = $2,
              reason_code = $3,
              updated_at = $4::timestamptz
            WHERE id = $1::uuid
          `,
          [plan.internal_id, finalStatus, failedReason, nowIso]
        );

        await appendAuditRow(tx, plan.internal_id, {
          stage: 'apply',
          event_type:
            finalStatus === 'apply_succeeded'
              ? 'install.apply.succeeded'
              : 'install.apply.failed',
          status: finalStatus,
          reason_code: failedReason,
          correlation_id: effectiveCorrelationId,
          details: {
            attempt_number: attemptNumber
          },
          created_at: nowIso
        });
      });

      const finalStatus: InstallApplyResponse['status'] =
        failedReason === null ? 'apply_succeeded' : 'apply_failed';

      if (dependencies.outboxPublisher) {
        await dependencies.outboxPublisher.publish({
          event_type:
            finalStatus === 'apply_succeeded'
              ? 'install.apply.succeeded'
              : 'install.apply.failed',
          dedupe_key: `${planId}:apply:${attemptNumber}:${finalStatus}`,
          payload: {
            plan_id: planId,
            attempt_number: attemptNumber,
            reason_code: failedReason,
            correlation_id: effectiveCorrelationId
          },
          occurred_at: nowIso
        });
      }

      const response: InstallApplyResponse = {
        status: finalStatus,
        replayed: false,
        plan_id: planId,
        attempt_number: attemptNumber,
        reason_code: failedReason
      };

      if (idempotencyKey) {
        await dependencies.idempotency.put({
          scope: idempotencyScope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response_code: 200,
          response_body: response,
          stored_at: nowIso
        });
      }

      await safeLog('install.apply.completed', nowIso, {
        correlation_id: effectiveCorrelationId,
        plan_id: planId,
        attempt_number: attemptNumber,
        status: finalStatus,
        reason_code: failedReason
      });

      return response;
    },

    async updatePlan(
      planId: string,
      idempotencyKey: string | null,
      correlationId: string | null,
      targetVersion?: string | null
    ): Promise<InstallUpdateResponse> {
      const nowIso = now().toISOString();
      const idempotencyScope = `POST:/v1/install/plans/${planId}/update`;
      const requestHash = buildLifecycleRequestHash({
        plan_id: planId,
        target_version: targetVersion ?? null
      });

      if (idempotencyKey) {
        const existing = await dependencies.idempotency.get(idempotencyScope, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new Error('idempotency_conflict');
          }

          return {
            ...(existing.response_body as InstallUpdateResponse),
            replayed: true
          };
        }
      }

      const plan = await loadPlan(dependencies.db, planId);
      if (!plan) {
        throw new Error('plan_not_found');
      }

      const allowedStatuses: InstallPlanStatus[] = [
        'apply_succeeded',
        'verify_succeeded',
        'verify_failed'
      ];
      if (!allowedStatuses.includes(plan.status)) {
        throw new Error('update_invalid_plan_state');
      }

      const attemptNumber = await resolveAttemptNumber(
        dependencies.db,
        'install_apply_attempts',
        plan.internal_id
      );
      const effectiveCorrelationId =
        correlationId ?? plan.correlation_id ?? plan.plan_id;

      const scopeMap = createScopeMap(await dependencies.copilotAdapter.discover_scopes());
      const entry: CopilotServerEntry = {
        package_id: plan.package_id,
        package_slug: plan.package_slug,
        mode: 'local',
        transport: 'stdio',
        trust_state: plan.runtime_context.trust_state
      };

      let failedReason: string | null = null;

      await runInTransaction(dependencies.db, async (tx) => {
        for (const action of plan.actions) {
          if (action.action_type === 'skip_scope') {
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'skipped',
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
            continue;
          }

          const scope = scopeMap[action.scope];
          if (!scope) {
            failedReason = 'scope_not_found';
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $4,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso, failedReason]
            );
            break;
          }

          try {
            await dependencies.copilotAdapter.write_entry(scope, entry);

            if (dependencies.runtimeVerifier.writeScopeSidecarGuarded) {
              await dependencies.runtimeVerifier.writeScopeSidecarGuarded({
                scope_hash: sha256Hex(`${plan.package_id}:${scope.scope}:${scope.scope_path}`),
                scope_daemon_owned: scope.daemon_owned,
                record: {
                  package_id: plan.package_id,
                  package_slug: plan.package_slug,
                  plan_id: plan.plan_id,
                  applied_at: nowIso,
                  scope: scope.scope,
                  scope_path: scope.scope_path
                }
              });
            }

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'applied',
                  reason_code = 'update_ok',
                  last_error = NULL,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
          } catch (error) {
            failedReason =
              error instanceof Error && error.name === 'CopilotFilesystemAdapterError'
                ? `adapter_${error.message}`
                : 'adapter_write_failed';

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $5,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [
                plan.internal_id,
                action.action_order,
                nowIso,
                failedReason,
                error instanceof Error ? error.message : 'unknown_error'
              ]
            );
            break;
          }
        }

        const finalStatus: InstallUpdateResponse['status'] =
          failedReason === null ? 'update_succeeded' : 'update_failed';

        await tx.query(
          `
            INSERT INTO install_apply_attempts (
              plan_internal_id,
              attempt_number,
              status,
              reason_code,
              details,
              started_at,
              completed_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4,
              $5::jsonb,
              $6::timestamptz,
              $6::timestamptz
            )
          `,
          [
            plan.internal_id,
            attemptNumber,
            finalStatus === 'update_succeeded' ? 'succeeded' : 'failed',
            failedReason,
            JSON.stringify({
              operation: 'update',
              target_version: targetVersion ?? null,
              correlation_id: effectiveCorrelationId
            }),
            nowIso
          ]
        );

        await tx.query(
          `
            UPDATE install_plans
            SET
              status = $2,
              reason_code = $3,
              updated_at = $4::timestamptz
            WHERE id = $1::uuid
          `,
          [
            plan.internal_id,
            finalStatus === 'update_succeeded' ? 'apply_succeeded' : 'apply_failed',
            failedReason,
            nowIso
          ]
        );

        await appendAuditRow(tx, plan.internal_id, {
          stage: 'apply',
          event_type:
            finalStatus === 'update_succeeded'
              ? 'install.update.succeeded'
              : 'install.update.failed',
          status: finalStatus,
          reason_code: failedReason,
          correlation_id: effectiveCorrelationId,
          details: {
            operation: 'update',
            target_version: targetVersion ?? null,
            attempt_number: attemptNumber
          },
          created_at: nowIso
        });
      });

      const finalStatus: InstallUpdateResponse['status'] =
        failedReason === null ? 'update_succeeded' : 'update_failed';

      if (dependencies.outboxPublisher) {
        await dependencies.outboxPublisher.publish({
          event_type:
            finalStatus === 'update_succeeded'
              ? 'install.update.succeeded'
              : 'install.update.failed',
          dedupe_key: `${planId}:update:${attemptNumber}:${finalStatus}`,
          payload: {
            plan_id: planId,
            attempt_number: attemptNumber,
            reason_code: failedReason,
            correlation_id: effectiveCorrelationId,
            target_version: targetVersion ?? null
          },
          occurred_at: nowIso
        });
      }

      const response: InstallUpdateResponse = {
        status: finalStatus,
        replayed: false,
        plan_id: planId,
        attempt_number: attemptNumber,
        reason_code: failedReason,
        target_version: targetVersion ?? null
      };

      if (idempotencyKey) {
        await dependencies.idempotency.put({
          scope: idempotencyScope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response_code: 200,
          response_body: response,
          stored_at: nowIso
        });
      }

      await safeLog('install.apply.completed', nowIso, {
        operation: 'update',
        correlation_id: effectiveCorrelationId,
        plan_id: planId,
        attempt_number: attemptNumber,
        status: finalStatus,
        reason_code: failedReason,
        target_version: targetVersion ?? null
      });

      return response;
    },

    async removePlan(
      planId: string,
      idempotencyKey: string | null,
      correlationId: string | null
    ): Promise<InstallRemoveResponse> {
      const nowIso = now().toISOString();
      const idempotencyScope = `POST:/v1/install/plans/${planId}/remove`;
      const requestHash = buildLifecycleRequestHash({ plan_id: planId });

      if (idempotencyKey) {
        const existing = await dependencies.idempotency.get(idempotencyScope, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new Error('idempotency_conflict');
          }

          return {
            ...(existing.response_body as InstallRemoveResponse),
            replayed: true
          };
        }
      }

      const plan = await loadPlan(dependencies.db, planId);
      if (!plan) {
        throw new Error('plan_not_found');
      }

      const allowedStatuses: InstallPlanStatus[] = [
        'apply_succeeded',
        'verify_succeeded',
        'verify_failed',
        'rollback_succeeded'
      ];
      if (!allowedStatuses.includes(plan.status)) {
        throw new Error('remove_invalid_plan_state');
      }

      const requiredProfileReferences = await resolveRequiredProfileReferenceCount(
        dependencies.db,
        plan.package_id
      );
      if (requiredProfileReferences > 0) {
        throw new Error('remove_dependency_blocked');
      }

      const attemptNumber = await resolveAttemptNumber(
        dependencies.db,
        'install_apply_attempts',
        plan.internal_id
      );
      const effectiveCorrelationId =
        correlationId ?? plan.correlation_id ?? plan.plan_id;

      const scopeMap = createScopeMap(await dependencies.copilotAdapter.discover_scopes());
      let failedReason: string | null = null;

      await runInTransaction(dependencies.db, async (tx) => {
        for (const action of plan.actions) {
          if (action.action_type === 'skip_scope') {
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'skipped',
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
            continue;
          }

          const scope = scopeMap[action.scope];
          if (!scope) {
            failedReason = 'scope_not_found';
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $4,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso, failedReason]
            );
            break;
          }

          try {
            await dependencies.copilotAdapter.remove_entry(scope, plan.package_id);

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'applied',
                  reason_code = 'remove_ok',
                  last_error = NULL,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
          } catch (error) {
            failedReason =
              error instanceof Error && error.name === 'CopilotFilesystemAdapterError'
                ? `adapter_${error.message}`
                : 'adapter_remove_failed';

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $5,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [
                plan.internal_id,
                action.action_order,
                nowIso,
                failedReason,
                error instanceof Error ? error.message : 'unknown_error'
              ]
            );
            break;
          }
        }

        const finalStatus: InstallRemoveResponse['status'] =
          failedReason === null ? 'remove_succeeded' : 'remove_failed';

        await tx.query(
          `
            INSERT INTO install_apply_attempts (
              plan_internal_id,
              attempt_number,
              status,
              reason_code,
              details,
              started_at,
              completed_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4,
              $5::jsonb,
              $6::timestamptz,
              $6::timestamptz
            )
          `,
          [
            plan.internal_id,
            attemptNumber,
            finalStatus === 'remove_succeeded' ? 'succeeded' : 'failed',
            failedReason,
            JSON.stringify({
              operation: 'remove',
              correlation_id: effectiveCorrelationId,
              required_profile_references: requiredProfileReferences
            }),
            nowIso
          ]
        );

        await tx.query(
          `
            UPDATE install_plans
            SET
              status = $2,
              reason_code = $3,
              updated_at = $4::timestamptz
            WHERE id = $1::uuid
          `,
          [plan.internal_id, finalStatus, failedReason, nowIso]
        );

        await appendAuditRow(tx, plan.internal_id, {
          stage: 'remove',
          event_type:
            finalStatus === 'remove_succeeded'
              ? 'install.remove.succeeded'
              : 'install.remove.failed',
          status: finalStatus,
          reason_code: failedReason,
          correlation_id: effectiveCorrelationId,
          details: {
            operation: 'remove',
            attempt_number: attemptNumber,
            required_profile_references: requiredProfileReferences
          },
          created_at: nowIso
        });
      });

      const finalStatus: InstallRemoveResponse['status'] =
        failedReason === null ? 'remove_succeeded' : 'remove_failed';

      if (dependencies.outboxPublisher) {
        await dependencies.outboxPublisher.publish({
          event_type:
            finalStatus === 'remove_succeeded'
              ? 'install.remove.succeeded'
              : 'install.remove.failed',
          dedupe_key: `${planId}:remove:${attemptNumber}:${finalStatus}`,
          payload: {
            plan_id: planId,
            attempt_number: attemptNumber,
            reason_code: failedReason,
            correlation_id: effectiveCorrelationId
          },
          occurred_at: nowIso
        });
      }

      const response: InstallRemoveResponse = {
        status: finalStatus,
        replayed: false,
        plan_id: planId,
        attempt_number: attemptNumber,
        reason_code: failedReason
      };

      if (idempotencyKey) {
        await dependencies.idempotency.put({
          scope: idempotencyScope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response_code: 200,
          response_body: response,
          stored_at: nowIso
        });
      }

      await safeLog('install.apply.completed', nowIso, {
        operation: 'remove',
        correlation_id: effectiveCorrelationId,
        plan_id: planId,
        attempt_number: attemptNumber,
        status: finalStatus,
        reason_code: failedReason
      });

      return response;
    },

    async rollbackPlan(
      planId: string,
      idempotencyKey: string | null,
      correlationId: string | null
    ): Promise<InstallRollbackResponse> {
      const nowIso = now().toISOString();
      const idempotencyScope = `POST:/v1/install/plans/${planId}/rollback`;
      const requestHash = buildLifecycleRequestHash({ plan_id: planId });

      if (idempotencyKey) {
        const existing = await dependencies.idempotency.get(idempotencyScope, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new Error('idempotency_conflict');
          }

          return {
            ...(existing.response_body as InstallRollbackResponse),
            replayed: true
          };
        }
      }

      const plan = await loadPlan(dependencies.db, planId);
      if (!plan) {
        throw new Error('plan_not_found');
      }

      const allowedStatuses: InstallPlanStatus[] = [
        'apply_failed',
        'remove_failed',
        'rollback_failed'
      ];
      if (!allowedStatuses.includes(plan.status)) {
        throw new Error('rollback_invalid_plan_state');
      }

      const sourceAttempt = await resolveLatestApplyAttempt(dependencies.db, plan.internal_id);
      if (!sourceAttempt || sourceAttempt.status !== 'failed') {
        throw new Error('rollback_source_attempt_missing');
      }

      const sourceOperationRaw = sourceAttempt.details.operation;
      const sourceOperation: InstallRollbackResponse['source_operation'] =
        sourceOperationRaw === 'update' ||
        sourceOperationRaw === 'remove' ||
        sourceOperationRaw === 'rollback'
          ? sourceOperationRaw
          : 'apply';

      const rollbackMode: InstallRollbackResponse['rollback_mode'] =
        sourceOperation === 'remove'
          ? 'restore_removed_entries'
          : 'cleanup_partial_install';

      const attemptNumber = await resolveAttemptNumber(
        dependencies.db,
        'install_apply_attempts',
        plan.internal_id
      );
      const effectiveCorrelationId =
        correlationId ?? plan.correlation_id ?? plan.plan_id;

      const scopeMap = createScopeMap(await dependencies.copilotAdapter.discover_scopes());
      const entry: CopilotServerEntry = {
        package_id: plan.package_id,
        package_slug: plan.package_slug,
        mode: 'local',
        transport: 'stdio',
        trust_state: plan.runtime_context.trust_state
      };

      let failedReason: string | null = null;

      await runInTransaction(dependencies.db, async (tx) => {
        for (const action of plan.actions) {
          if (action.action_type === 'skip_scope') {
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'skipped',
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso]
            );
            continue;
          }

          const scope = scopeMap[action.scope];
          if (!scope) {
            failedReason = 'scope_not_found';
            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $4,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [plan.internal_id, action.action_order, nowIso, failedReason]
            );
            break;
          }

          try {
            if (rollbackMode === 'restore_removed_entries') {
              await dependencies.copilotAdapter.write_entry(scope, entry);

              if (dependencies.runtimeVerifier.writeScopeSidecarGuarded) {
                await dependencies.runtimeVerifier.writeScopeSidecarGuarded({
                  scope_hash: sha256Hex(`${plan.package_id}:${scope.scope}:${scope.scope_path}`),
                  scope_daemon_owned: scope.daemon_owned,
                  record: {
                    package_id: plan.package_id,
                    package_slug: plan.package_slug,
                    plan_id: plan.plan_id,
                    applied_at: nowIso,
                    scope: scope.scope,
                    scope_path: scope.scope_path
                  }
                });
              }
            } else {
              await dependencies.copilotAdapter.remove_entry(scope, plan.package_id);
            }

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'applied',
                  reason_code = $4,
                  last_error = NULL,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [
                plan.internal_id,
                action.action_order,
                nowIso,
                rollbackMode === 'restore_removed_entries'
                  ? 'rollback_restore_ok'
                  : 'rollback_cleanup_ok'
              ]
            );
          } catch (error) {
            failedReason =
              error instanceof Error && error.name === 'CopilotFilesystemAdapterError'
                ? `adapter_${error.message}`
                : rollbackMode === 'restore_removed_entries'
                  ? 'adapter_write_failed'
                  : 'adapter_remove_failed';

            await tx.query(
              `
                UPDATE install_plan_actions
                SET
                  status = 'failed',
                  reason_code = $4,
                  last_error = $5,
                  updated_at = $3::timestamptz
                WHERE plan_internal_id = $1::uuid AND action_order = $2
              `,
              [
                plan.internal_id,
                action.action_order,
                nowIso,
                failedReason,
                error instanceof Error ? error.message : 'unknown_error'
              ]
            );
            break;
          }
        }

        const finalStatus: InstallRollbackResponse['status'] =
          failedReason === null ? 'rollback_succeeded' : 'rollback_failed';

        await tx.query(
          `
            INSERT INTO install_apply_attempts (
              plan_internal_id,
              attempt_number,
              status,
              reason_code,
              details,
              started_at,
              completed_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4,
              $5::jsonb,
              $6::timestamptz,
              $6::timestamptz
            )
          `,
          [
            plan.internal_id,
            attemptNumber,
            finalStatus === 'rollback_succeeded' ? 'succeeded' : 'failed',
            failedReason,
            JSON.stringify({
              operation: 'rollback',
              rollback_mode: rollbackMode,
              source_operation: sourceOperation,
              source_attempt_number: sourceAttempt.attempt_number,
              correlation_id: effectiveCorrelationId
            }),
            nowIso
          ]
        );

        await tx.query(
          `
            UPDATE install_plans
            SET
              status = $2,
              reason_code = $3,
              updated_at = $4::timestamptz
            WHERE id = $1::uuid
          `,
          [plan.internal_id, finalStatus, failedReason, nowIso]
        );

        await appendAuditRow(tx, plan.internal_id, {
          stage: 'rollback',
          event_type:
            finalStatus === 'rollback_succeeded'
              ? 'install.rollback.succeeded'
              : 'install.rollback.failed',
          status: finalStatus,
          reason_code: failedReason,
          correlation_id: effectiveCorrelationId,
          details: {
            operation: 'rollback',
            attempt_number: attemptNumber,
            rollback_mode: rollbackMode,
            source_operation: sourceOperation,
            source_attempt_number: sourceAttempt.attempt_number
          },
          created_at: nowIso
        });
      });

      const finalStatus: InstallRollbackResponse['status'] =
        failedReason === null ? 'rollback_succeeded' : 'rollback_failed';

      if (dependencies.outboxPublisher) {
        await dependencies.outboxPublisher.publish({
          event_type:
            finalStatus === 'rollback_succeeded'
              ? 'install.rollback.succeeded'
              : 'install.rollback.failed',
          dedupe_key: `${planId}:rollback:${attemptNumber}:${finalStatus}`,
          payload: {
            plan_id: planId,
            attempt_number: attemptNumber,
            reason_code: failedReason,
            correlation_id: effectiveCorrelationId,
            rollback_mode: rollbackMode,
            source_operation: sourceOperation,
            source_attempt_number: sourceAttempt.attempt_number
          },
          occurred_at: nowIso
        });
      }

      const response: InstallRollbackResponse = {
        status: finalStatus,
        replayed: false,
        plan_id: planId,
        attempt_number: attemptNumber,
        reason_code: failedReason,
        rollback_mode: rollbackMode,
        source_operation: sourceOperation
      };

      if (idempotencyKey) {
        await dependencies.idempotency.put({
          scope: idempotencyScope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response_code: 200,
          response_body: response,
          stored_at: nowIso
        });
      }

      await safeLog('install.apply.completed', nowIso, {
        operation: 'rollback',
        correlation_id: effectiveCorrelationId,
        plan_id: planId,
        attempt_number: attemptNumber,
        status: finalStatus,
        reason_code: failedReason,
        rollback_mode: rollbackMode,
        source_operation: sourceOperation,
        source_attempt_number: sourceAttempt.attempt_number
      });

      return response;
    },

    async verifyPlan(
      planId: string,
      idempotencyKey: string | null,
      correlationId: string | null
    ): Promise<InstallVerifyResponse> {
      const nowIso = now().toISOString();
      const idempotencyScope = `POST:/v1/install/plans/${planId}/verify`;
      const requestHash = buildLifecycleRequestHash({ plan_id: planId });

      if (idempotencyKey) {
        const existing = await dependencies.idempotency.get(idempotencyScope, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new Error('idempotency_conflict');
          }

          return {
            ...(existing.response_body as InstallVerifyResponse),
            replayed: true
          };
        }
      }

      const plan = await loadPlan(dependencies.db, planId);
      if (!plan) {
        throw new Error('plan_not_found');
      }

      const attemptNumber = await resolveAttemptNumber(
        dependencies.db,
        'install_verify_attempts',
        plan.internal_id
      );
      const effectiveCorrelationId =
        correlationId ?? plan.correlation_id ?? plan.plan_id;

      const scopeCandidates = await dependencies.copilotAdapter.discover_scopes();

      const runtimeRequest: RuntimeStartRequest = {
        package_id: plan.package_id,
        package_slug: plan.package_slug,
        mode: plan.runtime_context.mode,
        transport: plan.runtime_context.transport,
        trust_state: plan.runtime_context.trust_state,
        trust_reset_trigger: plan.runtime_context.trust_reset_trigger,
        scope_candidates: scopeCandidates.map((scope) => ({
          scope: scope.scope,
          scope_path: scope.scope_path,
          writable: scope.writable,
          approved: scope.approved,
          daemon_owned: scope.daemon_owned
        })),
        policy_input: plan.policy_input
      };

      runtimeRequest.correlation_id = effectiveCorrelationId;

      const runtimeResult = await dependencies.runtimeVerifier.run(runtimeRequest);

      const finalStatus: InstallVerifyResponse['status'] = runtimeResult.ready
        ? 'verify_succeeded'
        : 'verify_failed';

      const reasonCode = runtimeResult.failure_reason_code;

      await runInTransaction(dependencies.db, async (tx) => {
        await tx.query(
          `
            INSERT INTO install_verify_attempts (
              plan_internal_id,
              attempt_number,
              status,
              reason_code,
              readiness,
              stage_outcomes,
              details,
              started_at,
              completed_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4,
              $5,
              $6::jsonb,
              $7::jsonb,
              $8::timestamptz,
              $8::timestamptz
            )
          `,
          [
            plan.internal_id,
            attemptNumber,
            runtimeResult.ready ? 'succeeded' : 'failed',
            reasonCode,
            runtimeResult.ready,
            JSON.stringify(runtimeResult.stages),
            JSON.stringify({
              final_trust_state: runtimeResult.final_trust_state,
              policy_outcome: runtimeResult.policy.outcome
            }),
            nowIso
          ]
        );

        await tx.query(
          `
            UPDATE install_plans
            SET
              status = $2,
              reason_code = $3,
              updated_at = $4::timestamptz
            WHERE id = $1::uuid
          `,
          [plan.internal_id, finalStatus, reasonCode, nowIso]
        );

        await appendAuditRow(tx, plan.internal_id, {
          stage: 'verify',
          event_type:
            finalStatus === 'verify_succeeded'
              ? 'install.verify.succeeded'
              : 'install.verify.failed',
          status: finalStatus,
          reason_code: reasonCode,
          correlation_id: effectiveCorrelationId,
          details: {
            attempt_number: attemptNumber,
            readiness: runtimeResult.ready,
            stage_count: runtimeResult.stages.length
          },
          created_at: nowIso
        });
      });

      if (dependencies.outboxPublisher) {
        await dependencies.outboxPublisher.publish({
          event_type:
            finalStatus === 'verify_succeeded'
              ? 'install.verify.succeeded'
              : 'install.verify.failed',
          dedupe_key: `${planId}:verify:${attemptNumber}:${finalStatus}`,
          payload: {
            plan_id: planId,
            attempt_number: attemptNumber,
            readiness: runtimeResult.ready,
            reason_code: reasonCode,
            correlation_id: effectiveCorrelationId
          },
          occurred_at: nowIso
        });
      }

      const response: InstallVerifyResponse = {
        status: finalStatus,
        replayed: false,
        plan_id: planId,
        attempt_number: attemptNumber,
        readiness: runtimeResult.ready,
        reason_code: reasonCode,
        stages: runtimeResult.stages
      };

      if (idempotencyKey) {
        await dependencies.idempotency.put({
          scope: idempotencyScope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response_code: 200,
          response_body: response,
          stored_at: nowIso
        });
      }

      await safeLog('install.verify.completed', nowIso, {
        correlation_id: effectiveCorrelationId,
        plan_id: planId,
        attempt_number: attemptNumber,
        readiness: runtimeResult.ready,
        reason_code: reasonCode
      });

      return response;
    }
  };
}

export function createDefaultCopilotAdapterForLifecycle(): CopilotAdapterContract {
  return createCopilotVscodeAdapterContract(
    {
      async preflight(input) {
        return evaluatePolicyPreflight(input);
      }
    },
    {
      async on_before_write() {
        return;
      },
      async on_after_write() {
        return;
      },
      async on_lifecycle() {
        return;
      },
      async on_health_check() {
        return {
          healthy: true,
          details: []
        };
      }
    }
  );
}
