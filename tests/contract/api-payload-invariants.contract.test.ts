import { describe, expect, it } from 'vitest';
import { evaluatePolicyPreflight } from '@forge/policy-engine';
import { evaluateSecurityReportValidation } from '@forge/security-governance';
import { validateTelemetryEventEnvelope } from '@forge/shared-contracts';

describe('contract: API payload invariants', () => {
  it('enforces event envelope required fields', () => {
    const result = validateTelemetryEventEnvelope({
      schema_version: '1.0.0',
      event_name: 'search.query',
      payload: {
        query: 'mcp runtime'
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === 'event_id')).toBe(true);
      expect(result.issues.some((issue) => issue.field === 'request_id')).toBe(true);
    }
  });

  it('enforces blocked preflight response invariants', () => {
    const result = evaluatePolicyPreflight({
      org_id: 'org-1',
      package_id: 'pkg-1',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: false,
        server_allowlist: [],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 1,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: 'pkg-1',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-02-27T00:00:00Z'
      }
    });

    expect(result.outcome).toBe('policy_blocked');
    expect(result.reason_code).not.toBeNull();
    expect(result.install_allowed).toBe(false);
    expect(result.runtime_allowed).toBe(false);
  });

  it('enforces signature and evidence minima for security report intake', () => {
    const result = evaluateSecurityReportValidation({
      reporter_tier: 'B',
      reporter_status: 'active',
      severity: 'high',
      source_kind: 'curated',
      signature_valid: true,
      evidence_minimums_met: false,
      abuse_suspected: false
    });

    expect(result.accepted).toBe(false);
    expect(result.reason_code).toBe('evidence_minimums_missing');
    expect(result.queue).toBe('rejected');
  });
});
