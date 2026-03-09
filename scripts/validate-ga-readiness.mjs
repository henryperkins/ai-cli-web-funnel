#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { validateReleaseEvidence } from './validate-release-evidence.mjs';
import { verifyDocStatusConsistency } from './verify-doc-status-consistency.mjs';

function getArg(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return argv[index + 1] ?? null;
}

function hasFlag(flag, argv = process.argv) {
  return argv.includes(flag);
}

function checkReleaseEvidenceExists(evidencePath) {
  if (!existsSync(evidencePath)) {
    return { name: 'release_evidence_exists', status: 'fail', detail: `${evidencePath} not found.` };
  }

  return { name: 'release_evidence_exists', status: 'pass', detail: 'Release evidence file exists.' };
}

function checkReleaseEvidenceStructure(evidencePath) {
  if (!existsSync(evidencePath)) {
    return { name: 'release_evidence_structure', status: 'fail', detail: 'Cannot validate structure: file missing.' };
  }

  const content = readFileSync(evidencePath, 'utf8');
  const result = validateReleaseEvidence(content);

  if (!result.ok) {
    return {
      name: 'release_evidence_structure',
      status: 'fail',
      detail: result.errors.join('; ')
    };
  }

  return { name: 'release_evidence_structure', status: 'pass', detail: 'Release evidence structure is valid.' };
}

function checkReleaseEvidenceApproved(evidencePath) {
  if (!existsSync(evidencePath)) {
    return { name: 'release_evidence_approved', status: 'fail', detail: 'Cannot check approval: file missing.' };
  }

  const content = readFileSync(evidencePath, 'utf8');
  const result = validateReleaseEvidence(content, {
    requireApprovedStatus: true,
    requireCompletedSignoffs: true
  });

  if (!result.ok) {
    return {
      name: 'release_evidence_approved',
      status: 'blocked',
      detail: result.errors.join('; ')
    };
  }

  return { name: 'release_evidence_approved', status: 'pass', detail: 'Release evidence is approved with completed sign-offs.' };
}

function checkDocStatusConsistency(repoRoot) {
  try {
    const result = verifyDocStatusConsistency(repoRoot);

    if (!result.ok) {
      return {
        name: 'doc_status_consistency',
        status: 'fail',
        detail: result.errors.join('; ')
      };
    }

    return { name: 'doc_status_consistency', status: 'pass', detail: 'Document statuses are consistent.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'doc status consistency check failed';
    const isFileMissing = error instanceof Error && 'code' in error && error.code === 'ENOENT';

    return {
      name: 'doc_status_consistency',
      status: isFileMissing ? 'blocked' : 'fail',
      detail: message
    };
  }
}

function checkBetaReadinessReport(betaReportPath) {
  if (!existsSync(betaReportPath)) {
    return { name: 'beta_readiness_report', status: 'blocked', detail: `${betaReportPath} not found.` };
  }

  try {
    const content = readFileSync(betaReportPath, 'utf8');
    const report = JSON.parse(content);
    const goNoGo = report.go_no_go;

    if (goNoGo === 'go') {
      return { name: 'beta_readiness_report', status: 'pass', detail: 'Beta readiness go_no_go is "go".' };
    }

    if (goNoGo === 'no-go') {
      return { name: 'beta_readiness_report', status: 'fail', detail: 'Beta readiness go_no_go is "no-go".' };
    }

    return {
      name: 'beta_readiness_report',
      status: 'blocked',
      detail: `Beta readiness go_no_go is "${goNoGo}".`
    };
  } catch (error) {
    return {
      name: 'beta_readiness_report',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'Failed to parse beta readiness report.'
    };
  }
}

function checkGaReadinessReview(repoRoot) {
  try {
    const docsDir = join(repoRoot, 'docs');
    const entries = readdirSync(docsDir);
    const gaReviewFiles = entries.filter(
      (entry) => /^ga-readiness-review-.*\.md$/.test(entry) && entry !== 'ga-readiness-review-template.md'
    );

    if (gaReviewFiles.length === 0) {
      return {
        name: 'ga_readiness_review',
        status: 'blocked',
        detail: 'No ga-readiness-review-*.md file found in docs/.'
      };
    }

    return {
      name: 'ga_readiness_review',
      status: 'pass',
      detail: `Found GA readiness review: ${gaReviewFiles.join(', ')}.`
    };
  } catch (error) {
    return {
      name: 'ga_readiness_review',
      status: 'blocked',
      detail: error instanceof Error ? error.message : 'Failed to scan for GA readiness review.'
    };
  }
}

export function validateGaReadiness({
  repoRoot = process.cwd(),
  evidencePath = 'docs/release-evidence.md',
  betaReportPath = 'artifacts/beta-readiness-report.json'
} = {}) {
  const resolvedEvidencePath = join(repoRoot, evidencePath);
  const resolvedBetaReportPath = join(repoRoot, betaReportPath);

  const checks = [
    checkReleaseEvidenceExists(resolvedEvidencePath),
    checkReleaseEvidenceStructure(resolvedEvidencePath),
    checkReleaseEvidenceApproved(resolvedEvidencePath),
    checkDocStatusConsistency(repoRoot),
    checkBetaReadinessReport(resolvedBetaReportPath),
    checkGaReadinessReview(repoRoot)
  ];

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const blockedCount = checks.filter((c) => c.status === 'blocked').length;

  const automatedPass = failCount === 0;
  const humanBlocked = blockedCount > 0;
  const ready = passCount === checks.length;

  return {
    event_name: 'ga_readiness.validation_completed',
    occurred_at: new Date().toISOString(),
    payload: {
      automated_pass: automatedPass,
      human_blocked: humanBlocked,
      ready,
      summary: {
        total: checks.length,
        pass: passCount,
        fail: failCount,
        blocked: blockedCount
      },
      checks
    }
  };
}

export function runCli(argv = process.argv) {
  try {
    const repoRoot = getArg('--repo-root', argv) ?? process.cwd();
    const evidencePath = getArg('--evidence', argv) ?? 'docs/release-evidence.md';
    const betaReportPath = getArg('--beta-report', argv) ?? 'artifacts/beta-readiness-report.json';
    const requireAllPass = hasFlag('--require-all-pass', argv);

    const result = validateGaReadiness({ repoRoot, evidencePath, betaReportPath });

    console.log(JSON.stringify(result));

    if (!result.payload.automated_pass) {
      return 1;
    }

    if (requireAllPass && !result.payload.ready) {
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'GA readiness validation failed');
    return 1;
  }
}

function isExecutedAsScript() {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isExecutedAsScript()) {
  process.exitCode = runCli();
}
