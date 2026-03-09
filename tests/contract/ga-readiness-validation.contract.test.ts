import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { validateGaReadiness } from '../../scripts/validate-ga-readiness.mjs';

const approvedEvidence = `# Release Evidence

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

const draftEvidence = `# Release Evidence

Release: \`v0.2.0-rc.1\`
Date: \`2026-03-08\`
Commit: \`db5ee59\`

STATUS: DRAFT

## Sign-Off

- Release Manager: <pending>
- Security Reviewer: <pending>
- QA Owner: <pending>
- Platform Owner: <pending>
`;

function makeBetaReport(goNoGo: string): string {
  return JSON.stringify({
    generated_at: '2026-03-08T11:27:10.952Z',
    mode: 'production',
    go_no_go: goNoGo,
    summary: { kpi_total: 8, pass_count: 8, fail_count: 0, insufficient_data_count: 0 }
  });
}

function makeGaReview(): string {
  return `# GA Readiness Review\n\nReview Date: \`2026-03-08\`\n`;
}

function scaffoldRepo(
  tmpDir: string,
  opts: { evidence?: string | null; betaReport?: string | null; gaReview?: boolean } = {}
): void {
  mkdirSync(join(tmpDir, 'docs'), { recursive: true });
  mkdirSync(join(tmpDir, 'artifacts'), { recursive: true });

  if (opts.evidence !== null && opts.evidence !== undefined) {
    writeFileSync(join(tmpDir, 'docs', 'release-evidence.md'), opts.evidence);
  }

  if (opts.betaReport !== null && opts.betaReport !== undefined) {
    writeFileSync(join(tmpDir, 'artifacts', 'beta-readiness-report.json'), opts.betaReport);
  }

  if (opts.gaReview !== false) {
    writeFileSync(join(tmpDir, 'docs', 'ga-readiness-review-2026-03-08.md'), makeGaReview());
  }
}

const tmpDirs: string[] = [];

function createTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ga-readiness-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe('contract: GA readiness validation', () => {
  it('reports pass for all checks when evidence is approved and beta report is go', () => {
    const tmpDir = createTmpDir();
    scaffoldRepo(tmpDir, {
      evidence: approvedEvidence,
      betaReport: makeBetaReport('go'),
      gaReview: true
    });

    const result = validateGaReadiness({ repoRoot: tmpDir });

    expect(result.event_name).toBe('ga_readiness.validation_completed');
    // automated_pass is true because no checks have status 'fail'
    expect(result.payload.automated_pass).toBe(true);

    const evidenceExists = result.payload.checks.find(
      (c: { name: string }) => c.name === 'release_evidence_exists'
    );
    expect(evidenceExists.status).toBe('pass');

    const evidenceStructure = result.payload.checks.find(
      (c: { name: string }) => c.name === 'release_evidence_structure'
    );
    expect(evidenceStructure.status).toBe('pass');

    const evidenceApproved = result.payload.checks.find(
      (c: { name: string }) => c.name === 'release_evidence_approved'
    );
    expect(evidenceApproved.status).toBe('pass');

    // doc_status_consistency is 'blocked' in isolated temp dirs because
    // verifyDocStatusConsistency reads docs that are hard to scaffold.
    // The important contract: it does not report 'fail'.
    const docStatus = result.payload.checks.find(
      (c: { name: string }) => c.name === 'doc_status_consistency'
    );
    expect(docStatus.status).not.toBe('fail');

    const betaReport = result.payload.checks.find(
      (c: { name: string }) => c.name === 'beta_readiness_report'
    );
    expect(betaReport.status).toBe('pass');

    const gaReview = result.payload.checks.find(
      (c: { name: string }) => c.name === 'ga_readiness_review'
    );
    expect(gaReview.status).toBe('pass');
  });

  it('reports blocked when evidence is DRAFT with placeholder sign-offs', () => {
    const tmpDir = createTmpDir();
    scaffoldRepo(tmpDir, {
      evidence: draftEvidence,
      betaReport: makeBetaReport('go'),
      gaReview: true
    });

    const result = validateGaReadiness({ repoRoot: tmpDir });

    const evidenceApproved = result.payload.checks.find(
      (c: { name: string }) => c.name === 'release_evidence_approved'
    );
    expect(evidenceApproved.status).toBe('blocked');
    expect(evidenceApproved.detail).toContain('APPROVED');
    expect(result.payload.human_blocked).toBe(true);
  });

  it('reports blocked when beta readiness report is missing', () => {
    const tmpDir = createTmpDir();
    scaffoldRepo(tmpDir, {
      evidence: approvedEvidence,
      betaReport: null,
      gaReview: true
    });

    const result = validateGaReadiness({ repoRoot: tmpDir });

    const betaReport = result.payload.checks.find(
      (c: { name: string }) => c.name === 'beta_readiness_report'
    );
    expect(betaReport.status).toBe('blocked');
    expect(result.payload.human_blocked).toBe(true);
  });

  it('reports blocked when beta report go_no_go is blocked', () => {
    const tmpDir = createTmpDir();
    scaffoldRepo(tmpDir, {
      evidence: approvedEvidence,
      betaReport: makeBetaReport('blocked'),
      gaReview: true
    });

    const result = validateGaReadiness({ repoRoot: tmpDir });

    const betaReport = result.payload.checks.find(
      (c: { name: string }) => c.name === 'beta_readiness_report'
    );
    expect(betaReport.status).toBe('blocked');
    expect(betaReport.detail).toContain('blocked');
  });

  it('reports fail when beta report go_no_go is no-go', () => {
    const tmpDir = createTmpDir();
    scaffoldRepo(tmpDir, {
      evidence: approvedEvidence,
      betaReport: makeBetaReport('no-go'),
      gaReview: true
    });

    const result = validateGaReadiness({ repoRoot: tmpDir });

    const betaReport = result.payload.checks.find(
      (c: { name: string }) => c.name === 'beta_readiness_report'
    );
    expect(betaReport.status).toBe('fail');
    expect(result.payload.automated_pass).toBe(false);
  });

  it('reports fail when release evidence file is missing', () => {
    const tmpDir = createTmpDir();
    scaffoldRepo(tmpDir, {
      evidence: null,
      betaReport: makeBetaReport('go'),
      gaReview: true
    });

    const result = validateGaReadiness({ repoRoot: tmpDir });

    const evidenceExists = result.payload.checks.find(
      (c: { name: string }) => c.name === 'release_evidence_exists'
    );
    expect(evidenceExists.status).toBe('fail');

    const evidenceStructure = result.payload.checks.find(
      (c: { name: string }) => c.name === 'release_evidence_structure'
    );
    expect(evidenceStructure.status).toBe('fail');

    expect(result.payload.automated_pass).toBe(false);
  });
});
