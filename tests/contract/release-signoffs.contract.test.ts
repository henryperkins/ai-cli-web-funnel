import { describe, expect, it } from 'vitest';
import { applyReleaseSignoffs } from '../../scripts/apply-release-signoffs.mjs';

const draftEvidence = `# Release Evidence

Release: \`v0.2.0-rc.1\`
Date: \`2026-03-08\`
Commit: \`<pending-final-rc-commit>\`

STATUS: DRAFT

## Sign-Off

- Release Manager: <pending>
- Security Reviewer: <pending>
- QA Owner: <pending>
- Platform Owner: <pending>
`;

describe('contract: release sign-off application', () => {
  it('fills sign-off names and promotes the evidence to approved', () => {
    const next = applyReleaseSignoffs(draftEvidence, {
      signoffs: {
        'Release Manager': 'Alice',
        'Security Reviewer': 'Bob',
        'QA Owner': 'Carol',
        'Platform Owner': 'Dana'
      },
      approve: true,
      commit: 'abc1234'
    });

    expect(next).toContain('STATUS: APPROVED');
    expect(next).toContain('- Release Manager: Alice');
    expect(next).toContain('- Platform Owner: Dana');
    expect(next).toContain('Commit: `abc1234`');
  });
});
