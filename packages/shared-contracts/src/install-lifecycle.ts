import type { DependencyConflict, DependencyEdge } from './dependency-graph.js';

export const INSTALL_LIFECYCLE_CONTRACT_VERSION = 'v1.0.0';

export const INSTALL_TARGET_CLIENTS = ['vscode_copilot'] as const;
export type InstallTargetClient = (typeof INSTALL_TARGET_CLIENTS)[number];

export const INSTALL_TARGET_MODES = ['local'] as const;
export type InstallTargetMode = (typeof INSTALL_TARGET_MODES)[number];

export const INSTALL_SCOPES = ['workspace', 'user_profile', 'daemon_default'] as const;
export type InstallScope = (typeof INSTALL_SCOPES)[number];

export const INSTALL_TRUST_STATES = [
  'untrusted',
  'trusted',
  'trust_expired',
  'denied',
  'policy_blocked'
] as const;
export type InstallTrustState = (typeof INSTALL_TRUST_STATES)[number];

export const INSTALL_TRUST_RESET_TRIGGERS = [
  'major_version_bump',
  'author_changed',
  'permission_escalation',
  'user_revoked',
  'none'
] as const;
export type InstallTrustResetTrigger = (typeof INSTALL_TRUST_RESET_TRIGGERS)[number];

export const INSTALL_PLAN_STATUSES = [
  'planned',
  'apply_succeeded',
  'apply_failed',
  'verify_succeeded',
  'verify_failed',
  'remove_succeeded',
  'remove_failed',
  'rollback_succeeded',
  'rollback_failed'
] as const;
export type InstallLifecyclePlanStatus = (typeof INSTALL_PLAN_STATUSES)[number];

export const INSTALL_ACTION_TYPES = ['write_entry', 'remove_entry', 'skip_scope'] as const;
export type InstallLifecycleActionType = (typeof INSTALL_ACTION_TYPES)[number];

export const INSTALL_ACTION_STATUSES = ['pending', 'applied', 'failed', 'skipped'] as const;
export type InstallLifecycleActionStatus = (typeof INSTALL_ACTION_STATUSES)[number];

export const INSTALL_LIFECYCLE_HTTP_STATUS = [
  'not_ready',
  'invalid_request',
  'conflict',
  'not_found',
  'dependency_resolution_failed'
] as const;
export type InstallLifecycleHttpStatus = (typeof INSTALL_LIFECYCLE_HTTP_STATUS)[number];

export const INSTALL_LIFECYCLE_HTTP_ERROR_REASON = {
  installLifecycleUnavailable: 'install_lifecycle_unavailable',
  bodyObjectRequired: 'body_object_required',
  missingRequiredFields: 'missing_required_fields',
  dependencyEdgesInvalid: 'dependency_edges_invalid',
  knownPackageIdsInvalid: 'known_package_ids_invalid',
  trustStateInvalid: 'trust_state_invalid',
  trustResetTriggerInvalid: 'trust_reset_trigger_invalid',
  idempotencyKeyPayloadConflict: 'idempotency_key_reused_with_different_payload',
  packageNotFound: 'package_not_found',
  missingPlanId: 'missing_plan_id',
  planNotFound: 'plan_not_found',
  targetVersionInvalid: 'target_version_invalid',
  updateInvalidPlanState: 'update_invalid_plan_state',
  removeInvalidPlanState: 'remove_invalid_plan_state',
  removeDependencyBlocked: 'remove_dependency_blocked',
  rollbackInvalidPlanState: 'rollback_invalid_plan_state',
  rollbackSourceAttemptMissing: 'rollback_source_attempt_missing',
  dependencyResolutionFailed: 'dependency_resolution_failed'
} as const;

export type InstallLifecycleHttpErrorReason =
  (typeof INSTALL_LIFECYCLE_HTTP_ERROR_REASON)[keyof typeof INSTALL_LIFECYCLE_HTTP_ERROR_REASON];

export type InstallLifecycleDependencyResolutionFailureReason =
  `${typeof INSTALL_LIFECYCLE_HTTP_ERROR_REASON.dependencyResolutionFailed}:${string}`;

export const INSTALL_LIFECYCLE_EXECUTION_REASON_CODE = {
  scopeNotFound: 'scope_not_found',
  adapterWriteFailed: 'adapter_write_failed',
  adapterRemoveFailed: 'adapter_remove_failed',
  policyPreflightBlocked: 'policy_preflight_blocked',
  trustGateBlocked: 'trust_gate_blocked',
  preflightChecksFailed: 'preflight_checks_failed',
  startOrConnectFailed: 'start_or_connect_failed',
  remoteSseHookMissing: 'remote_sse_hook_missing',
  remoteStreamableHttpHookMissing: 'remote_streamable_http_hook_missing',
  remoteSseProbeFailed: 'remote_sse_probe_failed',
  remoteStreamableHttpProbeFailed: 'remote_streamable_http_probe_failed',
  healthValidateFailed: 'health_validate_failed',
  superviseFailed: 'supervise_failed'
} as const;

export type InstallLifecycleExecutionReasonCode =
  | (typeof INSTALL_LIFECYCLE_EXECUTION_REASON_CODE)[keyof typeof INSTALL_LIFECYCLE_EXECUTION_REASON_CODE]
  | `adapter_${string}`;

export type InstallLifecycleReasonCode =
  | InstallLifecycleHttpErrorReason
  | InstallLifecycleDependencyResolutionFailureReason
  | InstallLifecycleExecutionReasonCode;

export const INSTALL_PLAN_CONFLICT_CODES = [
  'dependency_cycle',
  'dependency_missing',
  'dependency_duplicate',
  'version_incompatible',
  'capability_incompatible',
  'runtime_incompatible',
  'policy_blocked'
] as const;

export type InstallPlanConflictCode = (typeof INSTALL_PLAN_CONFLICT_CODES)[number];

export interface InstallPlanConflict {
  code: InstallPlanConflictCode;
  reason_code: string;
  package_ids: string[];
  severity: 'error' | 'warning';
  message: string;
}

export interface InstallPlanExplainabilityRisk {
  code: string;
  level: 'low' | 'medium' | 'high';
  message: string;
}

export interface InstallPlanExplainability {
  why: string[];
  risk: InstallPlanExplainabilityRisk[];
  required_actions: string[];
  conflicts: InstallPlanConflict[];
}

export interface InstallLifecyclePolicyDecision {
  outcome: 'allowed' | 'flagged' | 'policy_blocked';
  reason_code: string | null;
  blocked: boolean;
  source: 'policy_preflight' | 'runtime_preflight';
}

export const INSTALL_LIFECYCLE_ENDPOINTS = {
  createPlan: '/v1/install/plans',
  getPlan: '/v1/install/plans/:plan_id',
  applyPlan: '/v1/install/plans/:plan_id/apply',
  installPlanAlias: '/v1/install/plans/:plan_id/install',
  updatePlan: '/v1/install/plans/:plan_id/update',
  removePlan: '/v1/install/plans/:plan_id/remove',
  uninstallPlanAlias: '/v1/install/plans/:plan_id/uninstall',
  rollbackPlan: '/v1/install/plans/:plan_id/rollback',
  verifyPlan: '/v1/install/plans/:plan_id/verify'
} as const;

export type InstallLifecyclePlanOperation =
  | 'apply'
  | 'install'
  | 'update'
  | 'remove'
  | 'uninstall'
  | 'rollback'
  | 'verify';

export function buildInstallLifecyclePlanPath(
  planId: string,
  operation?: InstallLifecyclePlanOperation
): string {
  const encodedPlanId = encodeURIComponent(planId);
  const basePath = `/v1/install/plans/${encodedPlanId}`;

  if (!operation) {
    return basePath;
  }

  return `${basePath}/${operation}`;
}

export function isInstallTrustState(value: string): value is InstallTrustState {
  return (INSTALL_TRUST_STATES as readonly string[]).includes(value);
}

export function isInstallTrustResetTrigger(value: string): value is InstallTrustResetTrigger {
  return (INSTALL_TRUST_RESET_TRIGGERS as readonly string[]).includes(value);
}

export function isInstallLifecycleHttpErrorReason(
  value: string
): value is InstallLifecycleHttpErrorReason {
  return (Object.values(INSTALL_LIFECYCLE_HTTP_ERROR_REASON) as readonly string[]).includes(value);
}

export function isInstallLifecycleDependencyResolutionFailureReason(
  value: string
): value is InstallLifecycleDependencyResolutionFailureReason {
  return value.startsWith(`${INSTALL_LIFECYCLE_HTTP_ERROR_REASON.dependencyResolutionFailed}:`);
}

export function isInstallLifecycleExecutionReasonCode(
  value: string
): value is InstallLifecycleExecutionReasonCode {
  return (
    (Object.values(INSTALL_LIFECYCLE_EXECUTION_REASON_CODE) as readonly string[]).includes(value) ||
    value.startsWith('adapter_')
  );
}

export function isInstallLifecycleReasonCode(value: string): value is InstallLifecycleReasonCode {
  return (
    isInstallLifecycleHttpErrorReason(value) ||
    isInstallLifecycleDependencyResolutionFailureReason(value) ||
    isInstallLifecycleExecutionReasonCode(value)
  );
}

export interface InstallLifecyclePermissionCaps {
  maxPermissions: number;
  disallowedPermissions: string[];
}

export interface InstallLifecycleOrgPolicy {
  mcp_enabled: boolean;
  server_allowlist: string[];
  block_flagged: boolean;
  permission_caps: InstallLifecyclePermissionCaps;
}

export interface InstallLifecycleCreatePlanRequest {
  package_id: string;
  package_slug?: string;
  correlation_id?: string;
  org_id: string;
  requested_permissions: string[];
  org_policy: InstallLifecycleOrgPolicy;
  trust_state?: InstallTrustState;
  trust_reset_trigger?: InstallTrustResetTrigger;
  dependency_edges?: DependencyEdge[];
  known_package_ids?: string[];
}

export interface InstallLifecycleDependencyResolutionSummary {
  resolved_order: string[];
  resolved_count: number;
  conflicts: DependencyConflict[];
}

export interface InstallLifecycleCreatePlanResponse {
  status: 'planned';
  replayed: boolean;
  plan_id: string;
  package_id: string;
  package_slug: string;
  policy_outcome: 'allowed' | 'flagged' | 'policy_blocked';
  policy_reason_code: string | null;
  security_state: string;
  action_count: number;
  dependency_resolution?: InstallLifecycleDependencyResolutionSummary;
  explainability?: InstallPlanExplainability;
  policy_decision?: InstallLifecyclePolicyDecision;
}

export interface InstallLifecycleOperationResponse {
  replayed: boolean;
  plan_id: string;
  attempt_number: number;
  reason_code: InstallLifecycleReasonCode | null;
  policy_decision?: InstallLifecyclePolicyDecision;
}

export interface InstallLifecycleApplyResponse extends InstallLifecycleOperationResponse {
  status: 'apply_succeeded' | 'apply_failed';
}

export interface InstallLifecycleUpdateResponse extends InstallLifecycleOperationResponse {
  status: 'update_succeeded' | 'update_failed';
  target_version: string | null;
}

export interface InstallLifecycleRemoveResponse extends InstallLifecycleOperationResponse {
  status: 'remove_succeeded' | 'remove_failed';
}

export interface InstallLifecycleRollbackResponse extends InstallLifecycleOperationResponse {
  status: 'rollback_succeeded' | 'rollback_failed';
  rollback_mode: 'cleanup_partial_install' | 'restore_removed_entries';
  source_operation: 'apply' | 'update' | 'remove' | 'rollback';
}

export interface InstallLifecycleVerifyStage {
  stage:
    | 'policy_preflight'
    | 'trust_gate'
    | 'preflight_checks'
    | 'start_or_connect'
    | 'remote_connect'
    | 'health_validate'
    | 'supervise';
  ok: boolean;
  details: string[];
}

export interface InstallLifecycleVerifyResponse extends InstallLifecycleOperationResponse {
  status: 'verify_succeeded' | 'verify_failed';
  readiness: boolean;
  stages: InstallLifecycleVerifyStage[];
}
