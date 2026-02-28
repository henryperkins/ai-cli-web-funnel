import { createHash, randomUUID } from 'node:crypto';
import { isPolicyBlockedState, type EnforcementState } from '@forge/shared-contracts';

export type ReporterTier = 'A' | 'B' | 'C';
export type ReporterStatus = 'active' | 'probation' | 'suspended' | 'removed';
export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export type SecuritySourceKind = 'raw' | 'curated';

export type ReportValidationReasonCode =
  | 'signature_invalid'
  | 'reporter_not_active'
  | 'evidence_minimums_missing'
  | 'abuse_suspected'
  | 'tier_c_advisory'
  | 'malware_critical_tier_a'
  | 'needs_human_review'
  | 'no_action';

export interface SecurityReportValidationInput {
  reporter_tier: ReporterTier;
  reporter_status: ReporterStatus;
  severity: SecuritySeverity;
  source_kind: SecuritySourceKind;
  signature_valid: boolean;
  evidence_minimums_met: boolean;
  abuse_suspected: boolean;
}

export interface SecurityReportValidationOutcome {
  accepted: boolean;
  reason_code: ReportValidationReasonCode;
  projected_state: EnforcementState | 'none';
  expires_in_hours: number | null;
  queue: 'rejected' | 'queued_review' | 'advisory';
}

export interface SecurityEnforcementAction {
  action_id: string;
  package_id: string;
  state: EnforcementState;
  reason_code: string;
  active?: boolean;
  created_at: string;
  source?: 'security_governance';
  expires_at?: string | null;
  supersedes_action_id?: string | null;
}

export interface SecurityEnforcementProjectionDecision {
  package_id: string;
  state: EnforcementState;
  reason_code: string | null;
  policy_blocked: boolean;
  warning_only: boolean;
  source: 'security_governance';
  updated_at: string;
}

export interface FlaggedBlockedBehaviorContract {
  state: EnforcementState;
  install_allowed_default: boolean;
  runtime_allowed_default: boolean;
  strict_mode_can_block_flagged: boolean;
}

const ENFORCEMENT_PRECEDENCE: Record<EnforcementState, number> = {
  policy_blocked_perm: 0,
  policy_blocked_temp: 1,
  flagged: 2,
  reinstated: 3,
  none: 4
};

const SECURITY_SEVERITY_SET = new Set<SecuritySeverity>(['low', 'medium', 'high', 'critical']);
const SECURITY_SOURCE_KIND_SET = new Set<SecuritySourceKind>(['raw', 'curated']);

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isSecuritySeverity(value: string): value is SecuritySeverity {
  return SECURITY_SEVERITY_SET.has(value as SecuritySeverity);
}

function isSecuritySourceKind(value: string): value is SecuritySourceKind {
  return SECURITY_SOURCE_KIND_SET.has(value as SecuritySourceKind);
}

function normalizeUtf8(value: string): string {
  return value.normalize('NFC');
}

function normalizeHeaders(
  headers: Record<string, string | undefined>
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[key.toLowerCase()] = value;
    }
  }

  return normalized;
}

function normalizeBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>) };
  }

  return null;
}

export function stableCanonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(normalizeUtf8(value));
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item) => stableCanonicalJson(item === undefined ? null : item))
      .join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(normalizeUtf8(key))}:${stableCanonicalJson(entryValue)}`)
      .join(',')}}`;
  }

  return 'null';
}

export function computeBodySha256Hex(value: unknown): string {
  return createHash('sha256').update(stableCanonicalJson(value), 'utf8').digest('hex');
}

export interface SecurityReportPayload {
  package_id: string;
  severity: SecuritySeverity;
  source_kind: SecuritySourceKind;
  summary: string;
  evidence: Array<{
    kind: string;
    value: string;
  }>;
  metadata: Record<string, unknown>;
}

function parseSecurityReportPayload(
  body: Record<string, unknown>
): { ok: true; value: SecurityReportPayload } | { ok: false; issues: string[] } {
  const issues: string[] = [];

  const packageIdRaw = body.package_id;
  const packageId = typeof packageIdRaw === 'string' ? packageIdRaw.trim() : '';
  if (packageId.length === 0) {
    issues.push('package_id must be a non-empty string');
  }

  const severityRaw = body.severity;
  const severityValue = typeof severityRaw === 'string' ? severityRaw : '';
  if (!isSecuritySeverity(severityValue)) {
    issues.push('severity must be one of: low, medium, high, critical');
  }

  const sourceKindRaw = body.source_kind;
  const sourceKindValue = typeof sourceKindRaw === 'string' ? sourceKindRaw : '';
  if (!isSecuritySourceKind(sourceKindValue)) {
    issues.push('source_kind must be one of: raw, curated');
  }

  const summaryRaw = body.summary;
  const summary = typeof summaryRaw === 'string' ? summaryRaw.trim() : '';
  if (summary.length === 0) {
    issues.push('summary must be a non-empty string');
  }

  const evidenceRaw = body.evidence;
  const evidence: Array<{ kind: string; value: string }> = [];
  if (!Array.isArray(evidenceRaw)) {
    issues.push('evidence must be an array');
  } else {
    for (const [index, item] of evidenceRaw.entries()) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        issues.push(`evidence[${index}] must be an object`);
        continue;
      }

      const kindRaw = (item as Record<string, unknown>).kind;
      const valueRaw = (item as Record<string, unknown>).value;
      const kind = typeof kindRaw === 'string' ? kindRaw.trim() : '';
      const value = typeof valueRaw === 'string' ? valueRaw.trim() : '';

      if (kind.length === 0 || value.length === 0) {
        issues.push(`evidence[${index}] requires non-empty kind and value`);
        continue;
      }

      evidence.push({ kind, value });
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  const metadataRaw = body.metadata;
  const metadata =
    typeof metadataRaw === 'object' && metadataRaw !== null && !Array.isArray(metadataRaw)
      ? { ...(metadataRaw as Record<string, unknown>) }
      : {};
  const severity = severityValue as SecuritySeverity;
  const sourceKind = sourceKindValue as SecuritySourceKind;

  return {
    ok: true,
    value: {
      package_id: packageId,
      severity,
      source_kind: sourceKind,
      summary,
      evidence,
      metadata
    }
  };
}

export function evaluateSecurityReportValidation(
  input: SecurityReportValidationInput
): SecurityReportValidationOutcome {
  if (!input.signature_valid) {
    return {
      accepted: false,
      reason_code: 'signature_invalid',
      projected_state: 'none',
      expires_in_hours: null,
      queue: 'rejected'
    };
  }

  if (input.reporter_status !== 'active') {
    return {
      accepted: false,
      reason_code: 'reporter_not_active',
      projected_state: 'none',
      expires_in_hours: null,
      queue: 'rejected'
    };
  }

  if (!input.evidence_minimums_met) {
    return {
      accepted: false,
      reason_code: 'evidence_minimums_missing',
      projected_state: 'none',
      expires_in_hours: null,
      queue: 'rejected'
    };
  }

  if (input.abuse_suspected) {
    return {
      accepted: false,
      reason_code: 'abuse_suspected',
      projected_state: 'none',
      expires_in_hours: null,
      queue: 'rejected'
    };
  }

  if (input.reporter_tier === 'A' && input.severity === 'critical' && input.source_kind === 'raw') {
    return {
      accepted: true,
      reason_code: 'malware_critical_tier_a',
      projected_state: 'policy_blocked_temp',
      expires_in_hours: 72,
      queue: 'queued_review'
    };
  }

  if (
    (input.reporter_tier === 'A' || input.reporter_tier === 'B') &&
    (input.severity === 'high' || input.severity === 'critical')
  ) {
    return {
      accepted: true,
      reason_code: 'needs_human_review',
      projected_state: 'flagged',
      expires_in_hours: null,
      queue: 'queued_review'
    };
  }

  return {
    accepted: true,
    reason_code: input.reporter_tier === 'C' ? 'tier_c_advisory' : 'no_action',
    projected_state: 'none',
    expires_in_hours: null,
    queue: input.reporter_tier === 'C' ? 'advisory' : 'queued_review'
  };
}

function getSupersededActionIds(actions: SecurityEnforcementAction[]): Set<string> {
  const superseded = new Set<string>();
  for (const action of actions) {
    if (action.supersedes_action_id) {
      superseded.add(action.supersedes_action_id);
    }
  }
  return superseded;
}

export function projectSecurityEnforcementCurrent(
  packageId: string,
  actions: SecurityEnforcementAction[],
  nowIso = new Date().toISOString()
): SecurityEnforcementProjectionDecision {
  const nowMs = parseTimestamp(nowIso);
  const supersededActionIds = getSupersededActionIds(actions);

  const activeActions = actions.filter((action) => {
    if (action.active === false) {
      return false;
    }

    if (supersededActionIds.has(action.action_id)) {
      return false;
    }

    if (action.expires_at) {
      const expiresAtMs = parseTimestamp(action.expires_at);
      if (expiresAtMs !== 0 && expiresAtMs <= nowMs) {
        return false;
      }
    }

    return true;
  });

  if (activeActions.length === 0) {
    return {
      package_id: packageId,
      state: 'none',
      reason_code: null,
      policy_blocked: false,
      warning_only: false,
      source: 'security_governance',
      updated_at: nowIso
    };
  }

  const winner = [...activeActions].sort((left, right) => {
    const precedenceDelta = ENFORCEMENT_PRECEDENCE[left.state] - ENFORCEMENT_PRECEDENCE[right.state];
    if (precedenceDelta !== 0) {
      return precedenceDelta;
    }

    const timestampDelta = parseTimestamp(right.created_at) - parseTimestamp(left.created_at);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return right.action_id.localeCompare(left.action_id);
  })[0];

  if (!winner) {
    return {
      package_id: packageId,
      state: 'none',
      reason_code: null,
      policy_blocked: false,
      warning_only: false,
      source: 'security_governance',
      updated_at: nowIso
    };
  }

  return {
    package_id: packageId,
    state: winner.state,
    reason_code: winner.reason_code,
    policy_blocked: isPolicyBlockedState(winner.state),
    warning_only: winner.state === 'flagged',
    source: 'security_governance',
    updated_at: nowIso
  };
}

export function getFlaggedBlockedBehaviorContract(
  state: EnforcementState
): FlaggedBlockedBehaviorContract {
  if (isPolicyBlockedState(state)) {
    return {
      state,
      install_allowed_default: false,
      runtime_allowed_default: false,
      strict_mode_can_block_flagged: true
    };
  }

  if (state === 'flagged') {
    return {
      state,
      install_allowed_default: true,
      runtime_allowed_default: true,
      strict_mode_can_block_flagged: true
    };
  }

  return {
    state,
    install_allowed_default: true,
    runtime_allowed_default: true,
    strict_mode_can_block_flagged: true
  };
}

export interface ReporterNonceRecord {
  reporter_id: string;
  nonce: string;
  created_at: string;
  expires_at: string;
}

export interface ReporterNonceStore {
  get(reporterId: string, nonce: string): Promise<ReporterNonceRecord | null>;
  put(record: ReporterNonceRecord): Promise<void>;
  purgeExpired(nowIso: string): Promise<number>;
  countActiveForReporter(reporterId: string, nowIso: string): Promise<number>;
}

export class InMemoryReporterNonceStore implements ReporterNonceStore {
  private readonly records = new Map<string, ReporterNonceRecord>();

  private buildKey(reporterId: string, nonce: string): string {
    return `${reporterId}:${nonce}`;
  }

  async get(reporterId: string, nonce: string): Promise<ReporterNonceRecord | null> {
    return this.records.get(this.buildKey(reporterId, nonce)) ?? null;
  }

  async put(record: ReporterNonceRecord): Promise<void> {
    this.records.set(this.buildKey(record.reporter_id, record.nonce), { ...record });
  }

  async purgeExpired(nowIso: string): Promise<number> {
    const nowMs = parseTimestamp(nowIso);
    let purged = 0;

    for (const [key, record] of this.records.entries()) {
      const expiresAtMs = parseTimestamp(record.expires_at);
      if (expiresAtMs !== 0 && expiresAtMs <= nowMs) {
        this.records.delete(key);
        purged += 1;
      }
    }

    return purged;
  }

  async countActiveForReporter(reporterId: string, nowIso: string): Promise<number> {
    const nowMs = parseTimestamp(nowIso);
    let count = 0;

    for (const record of this.records.values()) {
      if (record.reporter_id !== reporterId) {
        continue;
      }

      const expiresAtMs = parseTimestamp(record.expires_at);
      if (expiresAtMs === 0 || expiresAtMs > nowMs) {
        count += 1;
      }
    }

    return count;
  }
}

export interface ReporterDirectoryRecord {
  reporter_id: string;
  reporter_tier: ReporterTier;
  reporter_status: ReporterStatus;
}

export interface ReporterDirectory {
  getReporter(reporterId: string): Promise<ReporterDirectoryRecord | null>;
}

export class InMemoryReporterDirectory implements ReporterDirectory {
  constructor(
    private readonly reporters: Record<string, ReporterDirectoryRecord>
  ) {}

  async getReporter(reporterId: string): Promise<ReporterDirectoryRecord | null> {
    return this.reporters[reporterId] ?? null;
  }
}

export interface ReporterSignatureValidationInput {
  reporter_id: string;
  key_id: string;
  canonical_string: string;
  signature: string;
}

export interface ReporterSignatureVerifier {
  verify(input: ReporterSignatureValidationInput): Promise<boolean>;
}

export interface SecurityReportAbuseEvaluation {
  abuse_suspected: boolean;
  details: string[];
}

export interface SecurityReportAbuseEvaluator {
  evaluate(input: {
    reporter: ReporterDirectoryRecord;
    payload: SecurityReportPayload;
    request: SignedReporterIngestionRequest;
  }): Promise<SecurityReportAbuseEvaluation>;
}

export interface SecurityReportRecord {
  report_id: string;
  reporter_id: string;
  reporter_key_id: string;
  package_id: string;
  severity: SecuritySeverity;
  source_kind: SecuritySourceKind;
  signature_valid: boolean;
  evidence_minimums_met: boolean;
  abuse_suspected: boolean;
  reason_code: ReportValidationReasonCode;
  queue: SecurityReportValidationOutcome['queue'];
  projected_state: EnforcementState | 'none';
  body_sha256: string;
  request_timestamp: string;
  request_nonce: string;
  received_at: string;
  summary: string;
  evidence_count: number;
  metadata: Record<string, unknown>;
}

export interface SecurityReportPersistenceAdapter {
  appendReport(record: SecurityReportRecord): Promise<void>;
}

export class InMemorySecurityReportStore implements SecurityReportPersistenceAdapter {
  private readonly reports: SecurityReportRecord[] = [];

  async appendReport(record: SecurityReportRecord): Promise<void> {
    this.reports.push({
      ...record,
      metadata: { ...record.metadata }
    });
  }

  async listReports(): Promise<SecurityReportRecord[]> {
    return this.reports.map((record) => ({
      ...record,
      metadata: { ...record.metadata }
    }));
  }
}

export interface SecurityEnforcementProjectionStore {
  appendAction(action: SecurityEnforcementAction): Promise<void>;
  listActions(packageId: string): Promise<SecurityEnforcementAction[]>;
  upsertProjection(projection: SecurityEnforcementProjectionDecision): Promise<void>;
  getProjection(packageId: string): Promise<SecurityEnforcementProjectionDecision | null>;
}

export class InMemorySecurityEnforcementStore implements SecurityEnforcementProjectionStore {
  private readonly actionsByPackage = new Map<string, SecurityEnforcementAction[]>();
  private readonly projections = new Map<string, SecurityEnforcementProjectionDecision>();

  async appendAction(action: SecurityEnforcementAction): Promise<void> {
    const existing = this.actionsByPackage.get(action.package_id) ?? [];
    this.actionsByPackage.set(action.package_id, [...existing, { ...action }]);
  }

  async listActions(packageId: string): Promise<SecurityEnforcementAction[]> {
    return [...(this.actionsByPackage.get(packageId) ?? [])].map((action) => ({ ...action }));
  }

  async upsertProjection(projection: SecurityEnforcementProjectionDecision): Promise<void> {
    this.projections.set(projection.package_id, { ...projection });
  }

  async getProjection(packageId: string): Promise<SecurityEnforcementProjectionDecision | null> {
    const projection = this.projections.get(packageId);
    return projection ? { ...projection } : null;
  }

  async listActionHistory(packageId: string): Promise<SecurityEnforcementAction[]> {
    return this.listActions(packageId);
  }
}

export async function recomputeSecurityEnforcementProjection(
  store: SecurityEnforcementProjectionStore,
  packageId: string,
  nowIso = new Date().toISOString()
): Promise<SecurityEnforcementProjectionDecision> {
  const history = await store.listActions(packageId);
  const projection = projectSecurityEnforcementCurrent(packageId, history, nowIso);
  await store.upsertProjection(projection);
  return projection;
}

export function createSecurityEnforcementProjectionUpdater(
  store: SecurityEnforcementProjectionStore
) {
  return {
    async appendActionAndRecompute(
      action: SecurityEnforcementAction,
      nowIso = new Date().toISOString()
    ): Promise<SecurityEnforcementProjectionDecision> {
      await store.appendAction(action);
      return recomputeSecurityEnforcementProjection(store, action.package_id, nowIso);
    },

    async recompute(
      packageId: string,
      nowIso = new Date().toISOString()
    ): Promise<SecurityEnforcementProjectionDecision> {
      return recomputeSecurityEnforcementProjection(store, packageId, nowIso);
    }
  };
}

export interface SignedReporterIngestionRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  received_at?: string;
}

export type SignedReporterIngestionRejectionReasonCode =
  | 'invalid_request'
  | 'missing_required_headers'
  | 'invalid_timestamp'
  | 'timestamp_skew_exceeded'
  | 'body_hash_mismatch'
  | 'nonce_replayed'
  | 'nonce_rate_limited'
  | 'reporter_not_found'
  | ReportValidationReasonCode;

export interface SignedReporterIngestionAcceptedResult {
  status: 'accepted';
  report_id: string;
  reason_code: ReportValidationReasonCode;
  queue: SecurityReportValidationOutcome['queue'];
  projected_state: EnforcementState | 'none';
  projection: SecurityEnforcementProjectionDecision | null;
}

export interface SignedReporterIngestionRejectedResult {
  status: 'rejected';
  reason_code: SignedReporterIngestionRejectionReasonCode;
  issues: string[];
  report_id?: string;
}

export type SignedReporterIngestionResult =
  | SignedReporterIngestionAcceptedResult
  | SignedReporterIngestionRejectedResult;

export interface SignedReporterIngestionDependencies {
  reporters: ReporterDirectory;
  nonceStore: ReporterNonceStore;
  signatureVerifier: ReporterSignatureVerifier;
  persistence: SecurityReportPersistenceAdapter;
  projectionStore?: SecurityEnforcementProjectionStore;
  abuseEvaluator?: SecurityReportAbuseEvaluator;
  idFactory?: () => string;
  outboxPublisher?: SecurityReportOutboxPublisher;
}

export interface SecurityReportOutboxEnvelope {
  event_type:
    | 'security.enforcement.recompute.requested'
    | 'security.report.accepted';
  dedupe_key: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface SecurityReportOutboxPublisher {
  publish(envelope: SecurityReportOutboxEnvelope): Promise<void>;
}

export interface SignedReporterIngestionOptions {
  maxTimestampSkewMs?: number;
  nonceTtlMs?: number;
  maxActiveNoncesPerReporter?: number;
  now?: () => Date;
}

export interface ReporterSignatureCanonicalInput {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body_sha256: string;
}

export function buildReporterSignatureCanonicalString(
  input: ReporterSignatureCanonicalInput
): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.body_sha256.toLowerCase()
  ].join('\n');
}

const DEFAULT_MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_NONCE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ACTIVE_NONCES_PER_REPORTER = 10_000;
const SECURITY_REPORT_PATH = '/v1/security/reports';

export function createSignedReporterIngestionService(
  dependencies: SignedReporterIngestionDependencies,
  options: SignedReporterIngestionOptions = {}
) {
  const maxTimestampSkewMs = options.maxTimestampSkewMs ?? DEFAULT_MAX_TIMESTAMP_SKEW_MS;
  const nonceTtlMs = options.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS;
  const maxActiveNoncesPerReporter =
    options.maxActiveNoncesPerReporter ?? DEFAULT_MAX_ACTIVE_NONCES_PER_REPORTER;
  const now = options.now ?? (() => new Date());

  return {
    async submit(request: SignedReporterIngestionRequest): Promise<SignedReporterIngestionResult> {
      if (request.method !== 'POST' || request.path !== SECURITY_REPORT_PATH) {
        return {
          status: 'rejected',
          reason_code: 'invalid_request',
          issues: ['Only POST /v1/security/reports is supported by this ingestion service.']
        };
      }

      const normalizedHeaders = normalizeHeaders(request.headers);

      const reporterId = normalizedHeaders['x-reporter-id']?.trim();
      const keyId = normalizedHeaders['x-key-id']?.trim();
      const timestamp = normalizedHeaders['x-timestamp']?.trim();
      const nonce = normalizedHeaders['x-nonce']?.trim();
      const bodyShaHeader = normalizedHeaders['x-body-sha256']?.trim().toLowerCase();
      const signature = normalizedHeaders['x-signature']?.trim();

      if (!reporterId || !keyId || !timestamp || !nonce || !bodyShaHeader || !signature) {
        return {
          status: 'rejected',
          reason_code: 'missing_required_headers',
          issues: [
            'Required headers: x-reporter-id, x-key-id, x-timestamp, x-nonce, x-body-sha256, x-signature'
          ]
        };
      }

      const body = normalizeBody(request.body);
      if (!body) {
        return {
          status: 'rejected',
          reason_code: 'invalid_request',
          issues: ['Request body must be a JSON object.']
        };
      }

      const payloadValidation = parseSecurityReportPayload(body);
      if (!payloadValidation.ok) {
        return {
          status: 'rejected',
          reason_code: 'invalid_request',
          issues: payloadValidation.issues
        };
      }

      const payload = payloadValidation.value;
      const computedBodySha = computeBodySha256Hex(payload);
      if (computedBodySha !== bodyShaHeader) {
        return {
          status: 'rejected',
          reason_code: 'body_hash_mismatch',
          issues: ['x-body-sha256 does not match canonical body hash.']
        };
      }

      const timestampMs = Date.parse(timestamp);
      if (Number.isNaN(timestampMs)) {
        return {
          status: 'rejected',
          reason_code: 'invalid_timestamp',
          issues: ['x-timestamp must be an ISO-8601 timestamp.']
        };
      }

      const nowIso = request.received_at ?? now().toISOString();
      const nowMs = parseTimestamp(nowIso);
      if (Math.abs(nowMs - timestampMs) > maxTimestampSkewMs) {
        return {
          status: 'rejected',
          reason_code: 'timestamp_skew_exceeded',
          issues: ['Timestamp skew exceeded max allowed window.']
        };
      }

      await dependencies.nonceStore.purgeExpired(nowIso);

      const existingNonce = await dependencies.nonceStore.get(reporterId, nonce);
      if (existingNonce) {
        return {
          status: 'rejected',
          reason_code: 'nonce_replayed',
          issues: ['Nonce already used for reporter within active TTL window.']
        };
      }

      const activeNonceCount = await dependencies.nonceStore.countActiveForReporter(reporterId, nowIso);
      if (activeNonceCount >= maxActiveNoncesPerReporter) {
        return {
          status: 'rejected',
          reason_code: 'nonce_rate_limited',
          issues: ['Reporter nonce cardinality exceeded active limit.']
        };
      }

      const canonicalString = buildReporterSignatureCanonicalString({
        method: request.method,
        path: request.path,
        timestamp,
        nonce,
        body_sha256: bodyShaHeader
      });

      const signatureValid = await dependencies.signatureVerifier.verify({
        reporter_id: reporterId,
        key_id: keyId,
        canonical_string: canonicalString,
        signature
      });

      if (!signatureValid) {
        return {
          status: 'rejected',
          reason_code: 'signature_invalid',
          issues: ['Signature validation failed for reporter/key.']
        };
      }

      await dependencies.nonceStore.put({
        reporter_id: reporterId,
        nonce,
        created_at: nowIso,
        expires_at: new Date(nowMs + nonceTtlMs).toISOString()
      });

      const reporter = await dependencies.reporters.getReporter(reporterId);
      if (!reporter) {
        return {
          status: 'rejected',
          reason_code: 'reporter_not_found',
          issues: ['Reporter ID is not registered.']
        };
      }

      const evidenceMinimumsMet = payload.evidence.length > 0 && payload.summary.length > 0;
      const abuseEvaluation = dependencies.abuseEvaluator
        ? await dependencies.abuseEvaluator.evaluate({
            reporter,
            payload,
            request
          })
        : {
            abuse_suspected: false,
            details: ['abuse_check_not_configured']
          };

      const validation = evaluateSecurityReportValidation({
        reporter_tier: reporter.reporter_tier,
        reporter_status: reporter.reporter_status,
        severity: payload.severity,
        source_kind: payload.source_kind,
        signature_valid: true,
        evidence_minimums_met: evidenceMinimumsMet,
        abuse_suspected: abuseEvaluation.abuse_suspected
      });

      const reportId = dependencies.idFactory ? dependencies.idFactory() : randomUUID();
      await dependencies.persistence.appendReport({
        report_id: reportId,
        reporter_id: reporterId,
        reporter_key_id: keyId,
        package_id: payload.package_id,
        severity: payload.severity,
        source_kind: payload.source_kind,
        signature_valid: true,
        evidence_minimums_met: evidenceMinimumsMet,
        abuse_suspected: abuseEvaluation.abuse_suspected,
        reason_code: validation.reason_code,
        queue: validation.queue,
        projected_state: validation.projected_state,
        body_sha256: bodyShaHeader,
        request_timestamp: timestamp,
        request_nonce: nonce,
        received_at: nowIso,
        summary: payload.summary,
        evidence_count: payload.evidence.length,
        metadata: payload.metadata
      });

      if (!validation.accepted) {
        return {
          status: 'rejected',
          reason_code: validation.reason_code,
          issues: [
            `validation_rejected:${validation.reason_code}`,
            ...abuseEvaluation.details
          ],
          report_id: reportId
        };
      }

      let projection: SecurityEnforcementProjectionDecision | null = null;
      if (dependencies.projectionStore && validation.projected_state !== 'none') {
        const expiresAt =
          validation.expires_in_hours === null
            ? null
            : new Date(nowMs + validation.expires_in_hours * 60 * 60 * 1000).toISOString();

        await dependencies.projectionStore.appendAction({
          action_id: `report:${reportId}`,
          package_id: payload.package_id,
          state: validation.projected_state,
          reason_code: validation.reason_code,
          active: true,
          created_at: nowIso,
          source: 'security_governance',
          expires_at: expiresAt,
          supersedes_action_id: null
        });

        projection = await recomputeSecurityEnforcementProjection(
          dependencies.projectionStore,
          payload.package_id,
          nowIso
        );
      }

      if (dependencies.outboxPublisher) {
        const dedupeBase = `${reportId}:${payload.package_id}`;
        await dependencies.outboxPublisher.publish({
          event_type: 'security.report.accepted',
          dedupe_key: `${dedupeBase}:accepted`,
          payload: {
            report_id: reportId,
            package_id: payload.package_id,
            reason_code: validation.reason_code
          },
          occurred_at: nowIso
        });

        if (validation.projected_state !== 'none') {
          await dependencies.outboxPublisher.publish({
            event_type: 'security.enforcement.recompute.requested',
            dedupe_key: `${dedupeBase}:projection`,
            payload: {
              report_id: reportId,
              package_id: payload.package_id,
              projected_state: validation.projected_state
            },
            occurred_at: nowIso
          });
        }
      }

      return {
        status: 'accepted',
        report_id: reportId,
        reason_code: validation.reason_code,
        queue: validation.queue,
        projected_state: validation.projected_state,
        projection
      };
    }
  };
}

export function createSignedReporterIngestionEntrypoint(
  dependencies: SignedReporterIngestionDependencies,
  options: SignedReporterIngestionOptions = {}
) {
  const service = createSignedReporterIngestionService(dependencies, options);

  return {
    async submit(request: SignedReporterIngestionRequest): Promise<SignedReporterIngestionResult> {
      return service.submit(request);
    }
  };
}

export interface ReporterScoreMetricsReadinessAdapter {
  assertMetricsReady(): Promise<void>;
}

export interface ReporterScoreComputationAdapter {
  recomputeReporterScores(): Promise<{
    recomputed_count: number;
    computed_at: string;
  }>;
}

export interface ReporterScoreRecomputeDependencies {
  readiness: ReporterScoreMetricsReadinessAdapter;
  scoring: ReporterScoreComputationAdapter;
}

export interface ReporterScoreRecomputeResult {
  status: 'recomputed';
  recomputed_count: number;
  computed_at: string;
}

export const ASSERT_SECURITY_REPORTER_METRICS_READY_SQL =
  'SELECT assert_security_reporter_metrics_ready($1::interval);';

export function createReporterScoreRecomputeService(
  dependencies: ReporterScoreRecomputeDependencies
) {
  return {
    async recompute(): Promise<ReporterScoreRecomputeResult> {
      await dependencies.readiness.assertMetricsReady();
      const result = await dependencies.scoring.recomputeReporterScores();

      return {
        status: 'recomputed',
        recomputed_count: result.recomputed_count,
        computed_at: result.computed_at
      };
    }
  };
}

export * from './jobs.js';
export * from './outbox-dispatcher.js';
export * from './internal-outbox-dispatch-handlers.js';
export * from './postgres-job-store.js';
export * from './postgres-reporter-score-adapters.js';
export * from './dead-letter-requeue.js';
export * from './slo-rollup.js';
