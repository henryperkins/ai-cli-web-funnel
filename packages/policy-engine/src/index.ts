import { isPolicyBlockedState, type EnforcementState, type PolicyBlockReasonCode } from '@forge/shared-contracts';

export type PolicyPreflightOutcome = 'allowed' | 'flagged' | 'policy_blocked';

export interface EnforcementProjectionDecision {
  package_id: string;
  state: EnforcementState;
  reason_code: string | null;
  policy_blocked: boolean;
  source: 'security_governance' | 'org_policy' | 'none';
  updated_at: string;
}

export interface PolicyPermissionCaps {
  maxPermissions: number;
  disallowedPermissions: string[];
}

export interface PolicyPreflightInput {
  org_id: string;
  package_id: string;
  requested_permissions: string[];
  org_policy: {
    mcp_enabled: boolean;
    server_allowlist: string[];
    block_flagged: boolean;
    permission_caps: PolicyPermissionCaps;
  };
  enforcement: EnforcementProjectionDecision;
}

export interface PolicyPreflightFeatureGates {
  allowStrictFlaggedBlocking: boolean;
}

export const defaultPolicyPreflightFeatureGates: PolicyPreflightFeatureGates = {
  allowStrictFlaggedBlocking: false
};

export interface PolicyPreflightResult {
  outcome: PolicyPreflightOutcome;
  install_allowed: boolean;
  runtime_allowed: boolean;
  reason_code: PolicyBlockReasonCode | 'flagged_warning' | null;
  warnings: string[];
  policy_blocked: boolean;
  blocked_by: 'org_policy' | 'security_enforcement' | 'none';
}

function getPermissionCapViolations(
  requestedPermissions: string[],
  caps: PolicyPermissionCaps
): string[] {
  const overCount = requestedPermissions.length > caps.maxPermissions;
  const disallowed = requestedPermissions.filter((permission) =>
    caps.disallowedPermissions.includes(permission)
  );

  if (!overCount && disallowed.length === 0) {
    return [];
  }

  if (overCount) {
    return [`permissions exceed maxPermissions=${caps.maxPermissions}`];
  }

  return disallowed.map((permission) => `permission not allowed: ${permission}`);
}

export function evaluatePolicyPreflight(
  input: PolicyPreflightInput,
  gates: PolicyPreflightFeatureGates = defaultPolicyPreflightFeatureGates
): PolicyPreflightResult {
  if (!input.org_policy.mcp_enabled) {
    return {
      outcome: 'policy_blocked',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: 'mcp_disabled_for_org',
      warnings: [],
      policy_blocked: true,
      blocked_by: 'org_policy'
    };
  }

  if (
    input.org_policy.server_allowlist.length > 0 &&
    !input.org_policy.server_allowlist.includes(input.package_id)
  ) {
    return {
      outcome: 'policy_blocked',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: 'server_not_in_allowlist',
      warnings: [],
      policy_blocked: true,
      blocked_by: 'org_policy'
    };
  }

  const capViolations = getPermissionCapViolations(
    input.requested_permissions,
    input.org_policy.permission_caps
  );

  if (capViolations.length > 0) {
    return {
      outcome: 'policy_blocked',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: 'permissions_exceed_cap',
      warnings: capViolations,
      policy_blocked: true,
      blocked_by: 'org_policy'
    };
  }

  if (isPolicyBlockedState(input.enforcement.state)) {
    const reasonCode =
      input.enforcement.reason_code === 'policy_blocked_supply_chain'
        ? 'policy_blocked_supply_chain'
        : input.enforcement.reason_code === 'policy_blocked_org_policy'
          ? 'policy_blocked_org_policy'
          : 'policy_blocked_malware';

    return {
      outcome: 'policy_blocked',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: reasonCode,
      warnings: [],
      policy_blocked: true,
      blocked_by: 'security_enforcement'
    };
  }

  if (input.enforcement.state === 'flagged') {
    if (input.org_policy.block_flagged && gates.allowStrictFlaggedBlocking) {
      return {
        outcome: 'policy_blocked',
        install_allowed: false,
        runtime_allowed: false,
        reason_code: 'policy_blocked_org_policy',
        warnings: ['flagged package blocked by strict-mode policy gate'],
        policy_blocked: true,
        blocked_by: 'org_policy'
      };
    }

    return {
      outcome: 'flagged',
      install_allowed: true,
      runtime_allowed: true,
      reason_code: 'flagged_warning',
      warnings: ['package is flagged; runtime/install allowed with warning metadata'],
      policy_blocked: false,
      blocked_by: 'none'
    };
  }

  return {
    outcome: 'allowed',
    install_allowed: true,
    runtime_allowed: true,
    reason_code: null,
    warnings: [],
    policy_blocked: false,
    blocked_by: 'none'
  };
}
