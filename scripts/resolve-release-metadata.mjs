#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { validateDistributionPolicy } from './verify-distribution-policy.mjs';

function getArg(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return argv[index + 1] ?? null;
}

export function loadPackageVersion(packageJsonPath = 'package.json') {
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
  if (version.length === 0) {
    throw new Error(`No version field found in ${packageJsonPath}.`);
  }

  return version;
}

export function resolveReleaseMetadata({
  eventName,
  inputChannel = 'candidate',
  inputVersion = '',
  releaseTag = '',
  packageVersion
}) {
  const normalizedEvent = eventName.trim();
  const normalizedChannel = inputChannel.trim().toLowerCase() || 'candidate';
  const normalizedInputVersion = inputVersion.trim();
  const normalizedReleaseTag = releaseTag.trim();

  if (normalizedEvent === 'release') {
    if (normalizedReleaseTag.length === 0) {
      throw new Error('Release events require a non-empty release tag.');
    }

    const version = normalizedReleaseTag.startsWith('v')
      ? normalizedReleaseTag.slice(1)
      : normalizedReleaseTag;
    validateDistributionPolicy({
      channel: 'stable',
      version,
      releaseTag: normalizedReleaseTag
    });

    return {
      channel: 'stable',
      version,
      releaseRef: normalizedReleaseTag
    };
  }

  if ((normalizedChannel === 'candidate' || normalizedChannel === 'canary') && !normalizedInputVersion) {
    throw new Error(
      `workflow_dispatch requires --release-version for ${normalizedChannel} releases.`
    );
  }

  const version = normalizedInputVersion || packageVersion.trim();
  if (!version) {
    throw new Error('Unable to resolve a release version.');
  }

  validateDistributionPolicy({
    channel: normalizedChannel,
    version,
    releaseTag: normalizedInputVersion ? `v${version}` : null
  });

  return {
    channel: normalizedChannel,
    version,
    releaseRef: normalizedInputVersion ? `v${version}` : ''
  };
}

export function writeGithubOutput(outputPath, metadata) {
  const lines = [
    `channel=${metadata.channel}`,
    `version=${metadata.version}`,
    `release_ref=${metadata.releaseRef}`
  ];

  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

export function runCli(argv = process.argv) {
  try {
    const packageVersion = loadPackageVersion(getArg('--package-json', argv) ?? 'package.json');
    const metadata = resolveReleaseMetadata({
      eventName: getArg('--event-name', argv) ?? 'workflow_dispatch',
      inputChannel: getArg('--release-channel', argv) ?? 'candidate',
      inputVersion: getArg('--release-version', argv) ?? '',
      releaseTag: getArg('--release-tag', argv) ?? '',
      packageVersion
    });

    const githubOutput = getArg('--github-output', argv);
    if (githubOutput) {
      writeGithubOutput(githubOutput, metadata);
    }

    console.log(
      JSON.stringify({
        event_name: 'release_metadata.resolved',
        occurred_at: new Date().toISOString(),
        payload: {
          event_name: getArg('--event-name', argv) ?? 'workflow_dispatch',
          package_version: packageVersion,
          channel: metadata.channel,
          version: metadata.version,
          release_ref: metadata.releaseRef || null
        }
      })
    );

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'release metadata resolution failed');
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
