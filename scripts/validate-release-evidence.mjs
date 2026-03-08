#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_SIGNOFFS = [
  'Release Manager',
  'Security Reviewer',
  'QA Owner',
  'Platform Owner'
];

const ALLOWED_STATUSES = new Set(['DRAFT', 'APPROVED']);

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

function normalizeReleaseReference(value) {
  return value.trim().replace(/^v/i, '');
}

function normalizeCommitReference(value) {
  return value.trim().toLowerCase();
}

function normalizeSignoffValue(value) {
  return value.trim();
}

function commitReferencesMatch(actualCommit, expectedCommit) {
  const normalizedActual = normalizeCommitReference(actualCommit);
  const normalizedExpected = normalizeCommitReference(expectedCommit);

  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(normalizedExpected) ||
    normalizedExpected.startsWith(normalizedActual)
  );
}

function isPlaceholderValue(value) {
  return (
    value.length === 0 ||
    /^<.*>$/.test(value) ||
    value.toLowerCase() === 'pending' ||
    value.toLowerCase() === '<pending>'
  );
}

export function parseReleaseEvidence(content) {
  const statusMatches = [...content.matchAll(/^STATUS:\s*(.+)\s*$/gm)].map((match) =>
    match[1].trim().toUpperCase()
  );
  const releaseMatch = /^Release:\s*`?([^`\n]+)`?\s*$/m.exec(content);
  const commitMatch = /^Commit:\s*`?([^`\n]+)`?\s*$/m.exec(content);
  const signoffMatches = [...content.matchAll(/^- ([A-Za-z ]+):\s*(.+)\s*$/gm)];

  const signoffs = {};
  for (const [, role, value] of signoffMatches) {
    if (REQUIRED_SIGNOFFS.includes(role)) {
      signoffs[role] = normalizeSignoffValue(value);
    }
  }

  return {
    statuses: statusMatches,
    releaseReference: releaseMatch ? releaseMatch[1].trim() : null,
    commitReference: commitMatch ? commitMatch[1].trim() : null,
    signoffs
  };
}

export function validateReleaseEvidence(
  content,
  {
    requireApprovedStatus = false,
    requireCompletedSignoffs = false,
    expectedVersion = null,
    expectedCommit = null
  } = {}
) {
  const parsed = parseReleaseEvidence(content);
  const errors = [];

  if (parsed.statuses.length !== 1) {
    errors.push(
      `Expected exactly one STATUS line, found ${parsed.statuses.length}.`
    );
  } else if (!ALLOWED_STATUSES.has(parsed.statuses[0])) {
    errors.push(
      `Unsupported STATUS value "${parsed.statuses[0]}". Expected DRAFT or APPROVED.`
    );
  }

  if (requireApprovedStatus && parsed.statuses[0] !== 'APPROVED') {
    errors.push(
      `Release evidence must be APPROVED for release gating, found "${parsed.statuses[0] ?? 'missing'}".`
    );
  }

  if (!parsed.releaseReference) {
    errors.push('Missing Release line.');
  } else if (
    expectedVersion &&
    normalizeReleaseReference(parsed.releaseReference) !== normalizeReleaseReference(expectedVersion)
  ) {
    errors.push(
      `Release line "${parsed.releaseReference}" does not match expected version "${expectedVersion}".`
    );
  }

  if (expectedCommit) {
    if (!parsed.commitReference) {
      errors.push('Missing Commit line.');
    } else if (!commitReferencesMatch(parsed.commitReference, expectedCommit)) {
      errors.push(
        `Commit line "${parsed.commitReference}" does not match expected commit "${expectedCommit}".`
      );
    }
  }

  for (const role of REQUIRED_SIGNOFFS) {
    const value = parsed.signoffs[role];
    if (!value) {
      errors.push(`Missing required sign-off field: ${role}.`);
      continue;
    }

    if (requireCompletedSignoffs && isPlaceholderValue(value)) {
      errors.push(`Sign-off field "${role}" must be completed before release gating.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    parsed
  };
}

export function runCli(argv = process.argv) {
  const filePath = getArg('--file', argv);
  if (!filePath) {
    console.error('--file is required.');
    return 1;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const result = validateReleaseEvidence(content, {
      requireApprovedStatus: hasFlag('--require-approved-status', argv),
      requireCompletedSignoffs:
        hasFlag('--require-complete-signoffs', argv) ||
        hasFlag('--require-approved-status', argv),
      expectedVersion: getArg('--expected-version', argv),
      expectedCommit: getArg('--expected-commit', argv)
    });

    if (!result.ok) {
      for (const error of result.errors) {
        console.error(error);
      }
      return 1;
    }

    console.log(
      JSON.stringify({
        event_name: 'release_evidence.validation_passed',
        occurred_at: new Date().toISOString(),
        payload: {
          file: filePath,
          status: result.parsed.statuses[0],
          release: result.parsed.releaseReference,
          commit: result.parsed.commitReference
        }
      })
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'release evidence validation failed');
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
