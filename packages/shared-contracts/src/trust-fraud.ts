export const FRAUD_OUTCOMES = ['clean', 'flagged', 'blocked'] as const;
export type FraudOutcome = (typeof FRAUD_OUTCOMES)[number];

export const ENFORCEMENT_STATES = [
  'none',
  'flagged',
  'policy_blocked_temp',
  'policy_blocked_perm',
  'reinstated'
] as const;
export type EnforcementState = (typeof ENFORCEMENT_STATES)[number];

export const POLICY_BLOCK_REASON_CODES = [
  'mcp_disabled_for_org',
  'server_not_in_allowlist',
  'permissions_exceed_cap',
  'policy_blocked_malware',
  'policy_blocked_supply_chain',
  'policy_blocked_org_policy'
] as const;
export type PolicyBlockReasonCode = (typeof POLICY_BLOCK_REASON_CODES)[number];

export interface FraudOutcomeDisposition {
  accepted: boolean;
  include_in_ranking: boolean;
  include_in_billing: boolean;
}

const FRAUD_OUTCOME_DISPOSITIONS: Record<FraudOutcome, FraudOutcomeDisposition> = {
  clean: {
    accepted: true,
    include_in_ranking: true,
    include_in_billing: true
  },
  flagged: {
    accepted: true,
    include_in_ranking: false,
    include_in_billing: false
  },
  blocked: {
    accepted: false,
    include_in_ranking: false,
    include_in_billing: false
  }
};

export function getFraudOutcomeDisposition(outcome: FraudOutcome): FraudOutcomeDisposition {
  return FRAUD_OUTCOME_DISPOSITIONS[outcome];
}

export function isPolicyBlockedState(state: EnforcementState): boolean {
  return state === 'policy_blocked_temp' || state === 'policy_blocked_perm';
}
