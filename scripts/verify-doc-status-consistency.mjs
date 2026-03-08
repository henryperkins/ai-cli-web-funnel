#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  parseReleaseEvidence,
  validateReleaseEvidence
} from './validate-release-evidence.mjs';

const FORBIDDEN_EXECUTED_STATUSES = new Set(['done', 'executed', 'approved']);

function normalizeStatus(value) {
  return value.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z]+/g, ' ').trim();
}

function read(relativePath, repoRoot) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function parseBacklogStatus(content, storyId) {
  const row = [...content.split('\n')]
    .reverse()
    .find((line) => line.startsWith(`| ${storyId} |`));

  if (!row) {
    return null;
  }

  const columns = row.split('|').map((entry) => entry.trim()).filter(Boolean);
  return columns[1] ?? null;
}

function parsePlanStatus(content) {
  const match = /^Status:\s*(.+)$/m.exec(content);
  return match ? match[1].trim() : null;
}

function parseGaReview(content) {
  const overallMatch = /- Overall status:\s*`([^`]+)`/.exec(content);
  const countMatches = [...content.matchAll(/\|\s*([a-z_]+)\s*\|\s*(\d+)\s*\|/g)];
  const counts = {};

  for (const [, key, value] of countMatches) {
    counts[key] = Number.parseInt(value, 10);
  }

  return {
    overallStatus: overallMatch ? overallMatch[1].trim().toLowerCase() : null,
    counts
  };
}

export function verifyDocStatusConsistency(repoRoot = process.cwd()) {
  const backlog = read('docs/application-completion-backlog.md', repoRoot);
  const e9Plan = read(
    'docs/immediate-execution-plans/phase-3/e9-s4-distribution-upgrade-policy-plan.md',
    repoRoot
  );
  const e10Plan = read(
    'docs/immediate-execution-plans/phase-3/e10-s1-beta-pilot-execution-plan.md',
    repoRoot
  );
  const gaReview = read('docs/ga-readiness-review-2026-03-08.md', repoRoot);
  const releaseEvidence = read('docs/release-evidence.md', repoRoot);

  const backlogE9 = parseBacklogStatus(backlog, 'E9-S4');
  const backlogE10 = parseBacklogStatus(backlog, 'E10-S1');
  const e9PlanStatus = parsePlanStatus(e9Plan);
  const e10PlanStatus = parsePlanStatus(e10Plan);
  const gaReviewStatus = parseGaReview(gaReview);
  const releaseEvidenceStatus = parseReleaseEvidence(releaseEvidence);
  const releaseEvidenceValidation = validateReleaseEvidence(releaseEvidence);
  const errors = [];

  if (!releaseEvidenceValidation.ok) {
    for (const error of releaseEvidenceValidation.errors) {
      errors.push(`docs/release-evidence.md: ${error}`);
    }
  }

  if (!backlogE9 || !e9PlanStatus) {
    errors.push('Unable to resolve E9-S4 status from backlog and phase-3 plan docs.');
  } else if (normalizeStatus(backlogE9) !== normalizeStatus(e9PlanStatus)) {
    errors.push(
      `E9-S4 status mismatch: backlog="${backlogE9}" vs phase-3 plan="${e9PlanStatus}".`
    );
  }

  if (!backlogE10 || !e10PlanStatus) {
    errors.push('Unable to resolve E10-S1 status from backlog and phase-3 plan docs.');
  } else if (normalizeStatus(backlogE10) !== normalizeStatus(e10PlanStatus)) {
    errors.push(
      `E10-S1 status mismatch: backlog="${backlogE10}" vs phase-3 plan="${e10PlanStatus}".`
    );
  }

  const zeroLifecycleCounts =
    Object.values(gaReviewStatus.counts).length > 0 &&
    Object.values(gaReviewStatus.counts).every((value) => value === 0);
  const e10Statuses = [backlogE10, e10PlanStatus]
    .filter((value) => typeof value === 'string')
    .map((value) => normalizeStatus(value));

  if (gaReviewStatus.overallStatus === 'blocked' && zeroLifecycleCounts) {
    for (const status of e10Statuses) {
      if (FORBIDDEN_EXECUTED_STATUSES.has(status)) {
        errors.push(
          `E10-S1 cannot be marked "${status}" while GA readiness remains blocked with zero pilot lifecycle counts.`
        );
      }
    }
  }

  const releaseStatus = releaseEvidenceStatus.statuses[0] ?? null;
  if (
    releaseStatus === 'DRAFT' &&
    backlogE9 &&
    ['approved', 'released'].includes(normalizeStatus(backlogE9))
  ) {
    errors.push(
      `E9-S4 cannot be marked "${backlogE9}" while release evidence remains DRAFT.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    snapshot: {
      backlogE9,
      e9PlanStatus,
      backlogE10,
      e10PlanStatus,
      gaReviewOverallStatus: gaReviewStatus.overallStatus,
      releaseEvidenceStatus: releaseStatus
    }
  };
}

export function runCli() {
  try {
    const result = verifyDocStatusConsistency();
    if (!result.ok) {
      for (const error of result.errors) {
        console.error(error);
      }
      return 1;
    }

    console.log(
      JSON.stringify({
        event_name: 'docs_status_consistency.passed',
        occurred_at: new Date().toISOString(),
        payload: result.snapshot
      })
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'docs status consistency check failed');
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
