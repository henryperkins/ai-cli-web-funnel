import { describe, expect, it } from 'vitest';
import { evaluatePolicyPreflight } from '@forge/policy-engine';
import { projectSecurityEnforcementCurrent } from '@forge/security-governance';

describe('integration: fraud projection and preflight behavior', () => {
  it('maps policy_blocked projection to blocked preflight outcome', () => {
    const projection = projectSecurityEnforcementCurrent(
      'pkg-1',
      [
        {
          action_id: 'a-1',
          package_id: 'pkg-1',
          state: 'policy_blocked_temp',
          reason_code: 'policy_blocked_malware',
          active: true,
          created_at: '2026-02-27T12:10:00Z'
        }
      ],
      '2026-02-27T12:10:01Z'
    );

    const preflight = evaluatePolicyPreflight({
      org_id: 'org-1',
      package_id: 'pkg-1',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-1'],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: projection.package_id,
        state: projection.state,
        reason_code: projection.reason_code,
        policy_blocked: projection.policy_blocked,
        source: 'security_governance',
        updated_at: projection.updated_at
      }
    });

    expect(preflight.outcome).toBe('policy_blocked');
    expect(preflight.install_allowed).toBe(false);
    expect(preflight.runtime_allowed).toBe(false);
  });

  it('maps flagged projection to warning-only outcome by default', () => {
    const projection = projectSecurityEnforcementCurrent(
      'pkg-2',
      [
        {
          action_id: 'a-2',
          package_id: 'pkg-2',
          state: 'flagged',
          reason_code: 'needs_human_review',
          active: true,
          created_at: '2026-02-27T12:20:00Z'
        }
      ],
      '2026-02-27T12:20:01Z'
    );

    const preflight = evaluatePolicyPreflight({
      org_id: 'org-1',
      package_id: 'pkg-2',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-2'],
        block_flagged: true,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: projection.package_id,
        state: projection.state,
        reason_code: projection.reason_code,
        policy_blocked: projection.policy_blocked,
        source: 'security_governance',
        updated_at: projection.updated_at
      }
    });

    expect(preflight.outcome).toBe('flagged');
    expect(preflight.policy_blocked).toBe(false);
  });
});
