import { describe, expect, it } from 'vitest';
import {
  evaluateSecurityReportValidation,
  getFlaggedBlockedBehaviorContract,
  projectSecurityEnforcementCurrent
} from '../src/index.js';

describe('security governance contracts', () => {
  it('rejects reports that fail signature verification', () => {
    const result = evaluateSecurityReportValidation({
      reporter_tier: 'A',
      reporter_status: 'active',
      severity: 'critical',
      source_kind: 'raw',
      signature_valid: false,
      evidence_minimums_met: true,
      abuse_suspected: false
    });

    expect(result.accepted).toBe(false);
    expect(result.reason_code).toBe('signature_invalid');
  });

  it('projects temp block for tier A critical raw package reports', () => {
    const result = evaluateSecurityReportValidation({
      reporter_tier: 'A',
      reporter_status: 'active',
      severity: 'critical',
      source_kind: 'raw',
      signature_valid: true,
      evidence_minimums_met: true,
      abuse_suspected: false
    });

    expect(result.accepted).toBe(true);
    expect(result.projected_state).toBe('policy_blocked_temp');
    expect(result.expires_in_hours).toBe(72);
  });

  it('projects current enforcement deterministically with precedence and timestamp tie-break', () => {
    const projection = projectSecurityEnforcementCurrent(
      'pkg-1',
      [
        {
          action_id: 'aaa',
          package_id: 'pkg-1',
          state: 'flagged',
          reason_code: 'needs_human_review',
          active: true,
          created_at: '2026-02-27T00:00:10Z'
        },
        {
          action_id: 'bbb',
          package_id: 'pkg-1',
          state: 'policy_blocked_temp',
          reason_code: 'malware_critical_tier_a',
          active: true,
          created_at: '2026-02-27T00:00:05Z'
        }
      ],
      '2026-02-27T00:00:11Z'
    );

    expect(projection.state).toBe('policy_blocked_temp');
    expect(projection.policy_blocked).toBe(true);
  });

  it('returns default flagged contract as allow-with-warning', () => {
    const contract = getFlaggedBlockedBehaviorContract('flagged');

    expect(contract.install_allowed_default).toBe(true);
    expect(contract.runtime_allowed_default).toBe(true);
    expect(contract.strict_mode_can_block_flagged).toBe(true);
  });
});
