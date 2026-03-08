import { describe, expect, it } from 'vitest';
import {
  parseReleaseEvidence,
  validateReleaseEvidence
} from '../../scripts/validate-release-evidence.mjs';

const baseContent = `# Release Evidence

Release: \`v0.2.0-rc.1\`
Date: \`2026-03-08\`
Commit: \`db5ee59\`

STATUS: APPROVED

## Sign-Off

- Release Manager: Alice
- Security Reviewer: Bob
- QA Owner: Carol
- Platform Owner: Dana
`;

describe('contract: release evidence validation', () => {
  it('accepts approved evidence with matching version and completed sign-offs', () => {
    const result = validateReleaseEvidence(baseContent, {
      requireApprovedStatus: true,
      requireCompletedSignoffs: true,
      expectedVersion: '0.2.0-rc.1',
      expectedCommit: 'db5ee5901234567890abcdef'
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects duplicate status lines', () => {
    const result = validateReleaseEvidence(
      `${baseContent}\nSTATUS: DRAFT\n`,
      {
        requireApprovedStatus: true,
        requireCompletedSignoffs: true,
        expectedVersion: '0.2.0-rc.1'
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Expected exactly one STATUS line, found 2.');
  });

  it('rejects pending sign-offs when release gating requires completion', () => {
    const result = validateReleaseEvidence(
      baseContent.replace('Bob', '<pending>'),
      {
        requireApprovedStatus: true,
        requireCompletedSignoffs: true,
        expectedVersion: '0.2.0-rc.1'
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Sign-off field "Security Reviewer" must be completed before release gating.'
    );
  });

  it('rejects release evidence whose version does not match the resolved version', () => {
    const result = validateReleaseEvidence(baseContent, {
      requireApprovedStatus: true,
      requireCompletedSignoffs: true,
      expectedVersion: '0.1.0'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Release line "v0.2.0-rc.1" does not match expected version "0.1.0".'
    );
  });

  it('rejects release evidence whose commit does not match the expected source revision', () => {
    const result = validateReleaseEvidence(baseContent, {
      requireApprovedStatus: true,
      requireCompletedSignoffs: true,
      expectedVersion: '0.2.0-rc.1',
      expectedCommit: 'abc1234'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Commit line "db5ee59" does not match expected commit "abc1234".'
    );
  });

  it('parses status, release reference, and sign-offs from markdown', () => {
    const parsed = parseReleaseEvidence(baseContent);

    expect(parsed.statuses).toEqual(['APPROVED']);
    expect(parsed.releaseReference).toBe('v0.2.0-rc.1');
    expect(parsed.commitReference).toBe('db5ee59');
    expect(parsed.signoffs['Platform Owner']).toBe('Dana');
  });
});
