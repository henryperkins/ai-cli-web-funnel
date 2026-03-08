import type { PolicyPreflightInput, PolicyPreflightResult } from '@forge/policy-engine';

export type RuntimeMode = 'local' | 'remote';
export type RuntimeTransport = 'stdio' | 'sse' | 'streamable-http';
export type RuntimeScope = 'workspace' | 'user_profile' | 'daemon_default';

export type TrustState = 'untrusted' | 'trusted' | 'trust_expired' | 'denied' | 'policy_blocked';

export type TrustResetTrigger =
  | 'major_version_bump'
  | 'author_changed'
  | 'permission_escalation'
  | 'user_revoked'
  | 'none';

export interface RuntimeScopeCandidate {
  scope: RuntimeScope;
  scope_path: string;
  writable: boolean;
  approved: boolean;
  daemon_owned: boolean;
}

export interface RuntimeScopeResolution {
  ordered_writable_scopes: RuntimeScopeCandidate[];
  blocked_scopes: RuntimeScopeCandidate[];
}

export interface ProcessCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface RuntimeStartRequest {
  package_id: string;
  package_slug: string;
  correlation_id?: string;
  mode: RuntimeMode;
  transport: RuntimeTransport;
  trust_state: TrustState;
  trust_reset_trigger: TrustResetTrigger;
  scope_candidates: RuntimeScopeCandidate[];
  policy_input: PolicyPreflightInput;
  process_command?: ProcessCommand;
}

export interface RuntimePolicyClient {
  preflight(input: PolicyPreflightInput): Promise<PolicyPreflightResult>;
}

export interface RuntimeLifecycleHooks {
  preflight_checks(request: RuntimeStartRequest): Promise<{ ok: boolean; details: string[] }>;
  start_or_connect(request: RuntimeStartRequest): Promise<{ ok: boolean; details: string[] }>;
  health_validate(request: RuntimeStartRequest): Promise<{ ok: boolean; details: string[] }>;
  supervise(request: RuntimeStartRequest): Promise<{ ok: boolean; details: string[] }>;
}

export interface RemoteModeHooks {
  connect_sse?(request: RuntimeStartRequest): Promise<{
    ok: boolean;
    details: string[];
    reason_code?: string;
  }>;
  connect_streamable_http?(request: RuntimeStartRequest): Promise<{
    ok: boolean;
    details: string[];
    reason_code?: string;
  }>;
}

export interface RuntimePipelineResult {
  ready: boolean;
  failure_reason_code:
    | 'policy_preflight_blocked'
    | 'trust_gate_blocked'
    | 'preflight_checks_failed'
    | 'start_or_connect_failed'
    | 'remote_sse_hook_missing'
    | 'remote_streamable_http_hook_missing'
    | 'remote_sse_probe_failed'
    | 'remote_streamable_http_probe_failed'
    | 'health_validate_failed'
    | 'supervise_failed'
    | null;
  final_trust_state: TrustState;
  policy: PolicyPreflightResult;
  scope_resolution: RuntimeScopeResolution;
  stages: Array<{
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
  }>;
}

const SCOPE_ORDER: RuntimeScope[] = ['workspace', 'user_profile', 'daemon_default'];

export function resolveRuntimeScopeWriteOrder(
  candidates: RuntimeScopeCandidate[]
): RuntimeScopeResolution {
  const ordered = [...candidates].sort(
    (left, right) => SCOPE_ORDER.indexOf(left.scope) - SCOPE_ORDER.indexOf(right.scope)
  );

  const ordered_writable_scopes = ordered.filter((candidate) => candidate.writable && candidate.approved);
  const blocked_scopes = ordered.filter((candidate) => !candidate.writable || !candidate.approved);

  return {
    ordered_writable_scopes,
    blocked_scopes
  };
}

export function evaluateTrustTransition(
  current: TrustState,
  trigger: TrustResetTrigger,
  policy: PolicyPreflightResult
): TrustState {
  if (policy.outcome === 'policy_blocked') {
    return 'policy_blocked';
  }

  if (current === 'denied') {
    return 'denied';
  }

  if (trigger !== 'none') {
    return 'trust_expired';
  }

  if (current === 'untrusted' || current === 'trust_expired') {
    return 'trusted';
  }

  return current;
}

export function createRuntimeStartPipeline(
  policyClient: RuntimePolicyClient,
  hooks: RuntimeLifecycleHooks,
  remoteHooks: RemoteModeHooks = {}
) {
  return {
    async run(request: RuntimeStartRequest): Promise<RuntimePipelineResult> {
      const stages: RuntimePipelineResult['stages'] = [];

      const policy = await policyClient.preflight(request.policy_input);
      stages.push({
        stage: 'policy_preflight',
        ok: policy.outcome !== 'policy_blocked',
        details:
          policy.outcome === 'policy_blocked'
            ? [`blocked:${policy.reason_code ?? 'unknown'}`]
            : ['allowed']
      });

      const trustState = evaluateTrustTransition(
        request.trust_state,
        request.trust_reset_trigger,
        policy
      );
      stages.push({
        stage: 'trust_gate',
        ok: trustState === 'trusted',
        details: [`trust_state=${trustState}`]
      });

      const scopeResolution = resolveRuntimeScopeWriteOrder(request.scope_candidates);

      if (policy.outcome === 'policy_blocked' || trustState !== 'trusted') {
        return {
          ready: false,
          failure_reason_code:
            policy.outcome === 'policy_blocked'
              ? 'policy_preflight_blocked'
              : 'trust_gate_blocked',
          final_trust_state: trustState,
          policy,
          scope_resolution: scopeResolution,
          stages
        };
      }

      const preflightChecks = await hooks.preflight_checks(request);
      stages.push({
        stage: 'preflight_checks',
        ok: preflightChecks.ok,
        details: preflightChecks.details
      });

      if (!preflightChecks.ok) {
        return {
          ready: false,
          failure_reason_code: 'preflight_checks_failed',
          final_trust_state: trustState,
          policy,
          scope_resolution: scopeResolution,
          stages
        };
      }

      const startResult = await hooks.start_or_connect(request);
      stages.push({
        stage: 'start_or_connect',
        ok: startResult.ok,
        details: startResult.details
      });

      if (!startResult.ok) {
        return {
          ready: false,
          failure_reason_code: 'start_or_connect_failed',
          final_trust_state: trustState,
          policy,
          scope_resolution: scopeResolution,
          stages
        };
      }

      if (request.mode === 'remote') {
        let remoteResult: { ok: boolean; details: string[]; reason_code?: string } | null = null;

        if (request.transport === 'sse') {
          if (!remoteHooks.connect_sse) {
            remoteResult = {
              ok: false,
              reason_code: 'remote_sse_hook_missing',
              details: ['connect_sse hook not configured']
            };
          } else {
            remoteResult = await remoteHooks.connect_sse(request);
          }
        }

        if (request.transport === 'streamable-http') {
          if (!remoteHooks.connect_streamable_http) {
            remoteResult = {
              ok: false,
              reason_code: 'remote_streamable_http_hook_missing',
              details: ['connect_streamable_http hook not configured']
            };
          } else {
            remoteResult = await remoteHooks.connect_streamable_http(request);
          }
        }

        if (remoteResult) {
          stages.push({
            stage: 'remote_connect',
            ok: remoteResult.ok,
            details: remoteResult.details
          });

          if (!remoteResult.ok) {
            const reasonCode =
              remoteResult.reason_code ??
              (request.transport === 'streamable-http'
                ? 'remote_streamable_http_probe_failed'
                : 'remote_sse_probe_failed');

            return {
              ready: false,
              failure_reason_code:
                reasonCode === 'remote_streamable_http_hook_missing'
                  ? 'remote_streamable_http_hook_missing'
                  : reasonCode === 'remote_sse_hook_missing'
                    ? 'remote_sse_hook_missing'
                    : reasonCode === 'remote_streamable_http_probe_failed'
                      ? 'remote_streamable_http_probe_failed'
                      : 'remote_sse_probe_failed',
              final_trust_state: trustState,
              policy,
              scope_resolution: scopeResolution,
              stages
            };
          }
        }
      }

      const healthResult = await hooks.health_validate(request);
      stages.push({
        stage: 'health_validate',
        ok: healthResult.ok,
        details: healthResult.details
      });

      if (!healthResult.ok) {
        return {
          ready: false,
          failure_reason_code: 'health_validate_failed',
          final_trust_state: trustState,
          policy,
          scope_resolution: scopeResolution,
          stages
        };
      }

      const superviseResult = await hooks.supervise(request);
      stages.push({
        stage: 'supervise',
        ok: superviseResult.ok,
        details: superviseResult.details
      });

      return {
        ready: superviseResult.ok,
        failure_reason_code: superviseResult.ok ? null : 'supervise_failed',
        final_trust_state: trustState,
        policy,
        scope_resolution: scopeResolution,
        stages
      };
    }
  };
}
