#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  REQUIRED_SIGNOFFS,
  validateReleaseEvidence
} from './validate-release-evidence.mjs';

const ROLE_FLAG_MAP = {
  'Release Manager': '--release-manager',
  'Security Reviewer': '--security-reviewer',
  'QA Owner': '--qa-owner',
  'Platform Owner': '--platform-owner'
};

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

function replaceLine(content, pattern, nextLine) {
  if (!pattern.test(content)) {
    throw new Error(`Unable to find line matching ${pattern}`);
  }

  return content.replace(pattern, nextLine);
}

export function applyReleaseSignoffs(
  content,
  {
    signoffs,
    approve = false,
    release = null,
    commit = null,
    date = null
  }
) {
  let next = content;

  for (const role of REQUIRED_SIGNOFFS) {
    const replacement = signoffs[role];
    if (!replacement) {
      continue;
    }

    next = replaceLine(
      next,
      new RegExp(`^- ${role}: .+$`, 'm'),
      `- ${role}: ${replacement}`
    );
  }

  if (release) {
    next = replaceLine(next, /^Release:\s*.+$/m, `Release: \`${release}\``);
  }

  if (commit) {
    next = replaceLine(next, /^Commit:\s*.+$/m, `Commit: \`${commit}\``);
  }

  if (date) {
    next = replaceLine(next, /^Date:\s*.+$/m, `Date: \`${date}\``);
  }

  if (approve) {
    next = replaceLine(next, /^STATUS:\s*.+$/m, 'STATUS: APPROVED');
  }

  return next;
}

export function runCli(argv = process.argv) {
  const filePath = getArg('--file', argv);
  if (!filePath) {
    console.error('--file is required.');
    return 1;
  }

  try {
    const signoffs = {};
    for (const role of REQUIRED_SIGNOFFS) {
      const value = getArg(ROLE_FLAG_MAP[role], argv);
      if (value) {
        signoffs[role] = value.trim();
      }
    }

    const approve = hasFlag('--approve', argv);
    const content = readFileSync(filePath, 'utf8');
    const next = applyReleaseSignoffs(content, {
      signoffs,
      approve,
      release: getArg('--release', argv),
      commit: getArg('--commit', argv),
      date: getArg('--date', argv)
    });

    const validation = validateReleaseEvidence(next, {
      requireApprovedStatus: approve,
      requireCompletedSignoffs: approve,
      expectedVersion: getArg('--expected-version', argv)
    });

    if (!validation.ok) {
      for (const error of validation.errors) {
        console.error(error);
      }
      return 1;
    }

    if (hasFlag('--dry-run', argv)) {
      process.stdout.write(next);
    } else {
      writeFileSync(filePath, next, 'utf8');
    }

    console.log(
      JSON.stringify({
        event_name: 'release_evidence.signoffs_applied',
        occurred_at: new Date().toISOString(),
        payload: {
          file: filePath,
          approve,
          dry_run: hasFlag('--dry-run', argv)
        }
      })
    );

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'failed to apply release sign-offs');
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
