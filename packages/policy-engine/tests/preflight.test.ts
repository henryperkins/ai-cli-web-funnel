import { describe, expect, it } from 'vitest';
import { defaultPolicyPreflightFeatureGates, evaluatePolicyPreflight } from '../src/index.js';

function buildInput() {
  return {
    org_id: 'org-1',
    package_id: 'pkg-1',
    requested_permissions: ['read:config'],
    org_policy: {
      mcp_enabled: true,
      server_allowlist: ['pkg-1'],
      block_flagged: false,
      permission_caps: {
        maxPermissions: 3,
        disallowedPermissions: ['admin:root']
      }
    },
    enforcement: {
      package_id: 'pkg-1',
      state: 'none' as const,
      reason_code: null,
      policy_blocked: false,
      source: 'none' as const,
      updated_at: '2026-02-27T00:00:00Z'
    }
  };
}

describe('policy preflight contracts', () => {
  it('blocks when org-level MCP execution is disabled', () => {
    const input = buildInput();
    input.org_policy.mcp_enabled = false;

    const result = evaluatePolicyPreflight(input);

    expect(result.outcome).toBe('policy_blocked');
    expect(result.reason_code).toBe('mcp_disabled_for_org');
    expect(result.blocked_by).toBe('org_policy');
  });

  it('returns flagged (allow with warning) by default for flagged enforcement state', () => {
    const input = buildInput();
    input.enforcement.state = 'flagged';
    input.enforcement.reason_code = 'needs_human_review';
    input.org_policy.block_flagged = true;

    const result = evaluatePolicyPreflight(input, defaultPolicyPreflightFeatureGates);

    expect(result.outcome).toBe('flagged');
    expect(result.install_allowed).toBe(true);
    expect(result.runtime_allowed).toBe(true);
    expect(result.reason_code).toBe('flagged_warning');
  });

  it('blocks flagged state only when strict mode gate is explicitly enabled', () => {
    const input = buildInput();
    input.enforcement.state = 'flagged';
    input.enforcement.reason_code = 'needs_human_review';
    input.org_policy.block_flagged = true;

    const result = evaluatePolicyPreflight(input, {
      allowStrictFlaggedBlocking: true
    });

    expect(result.outcome).toBe('policy_blocked');
    expect(result.reason_code).toBe('policy_blocked_org_policy');
  });

  it('blocks immediately for projected policy_blocked states', () => {
    const input = buildInput();
    input.enforcement.state = 'policy_blocked_temp';
    input.enforcement.reason_code = 'policy_blocked_supply_chain';

    const result = evaluatePolicyPreflight(input);

    expect(result.outcome).toBe('policy_blocked');
    expect(result.reason_code).toBe('policy_blocked_supply_chain');
    expect(result.blocked_by).toBe('security_enforcement');
  });

  it('blocks when permission caps are exceeded', () => {
    const input = buildInput();
    input.requested_permissions = ['read:config', 'admin:root'];

    const result = evaluatePolicyPreflight(input);

    expect(result.outcome).toBe('policy_blocked');
    expect(result.reason_code).toBe('permissions_exceed_cap');
    expect(result.warnings[0]).toContain('permission not allowed');
  });
});
