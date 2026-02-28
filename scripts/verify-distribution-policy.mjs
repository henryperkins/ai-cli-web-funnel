#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

const VALID_CHANNELS = new Set(['stable', 'candidate', 'canary']);

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function logEvent(eventName, payload) {
  console.log(
    JSON.stringify({
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      payload
    })
  );
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? null,
    build: match[5] ?? null
  };
}

function validateChannelVersion(channel, parsed) {
  const prerelease = parsed.prerelease?.toLowerCase() ?? '';

  if (channel === 'stable') {
    if (parsed.prerelease) {
      return 'stable channel requires a non-prerelease semantic version.';
    }
    return null;
  }

  if (channel === 'candidate') {
    if (!parsed.prerelease) {
      return 'candidate channel requires prerelease semantic version (for example -rc.1 or -beta.1).';
    }

    if (!prerelease.includes('rc') && !prerelease.includes('beta')) {
      return 'candidate channel prerelease must include rc or beta marker.';
    }

    return null;
  }

  if (!parsed.prerelease) {
    return 'canary channel requires prerelease semantic version (for example -canary.1).';
  }

  if (
    !prerelease.includes('canary') &&
    !prerelease.includes('alpha') &&
    !prerelease.includes('dev')
  ) {
    return 'canary channel prerelease must include canary, alpha, or dev marker.';
  }

  return null;
}

const channel = (getArg('--channel') ?? '').toLowerCase();
if (!VALID_CHANNELS.has(channel)) {
  console.error('Invalid --channel. Expected stable, candidate, or canary.');
  process.exit(1);
}

const version = (getArg('--version') ?? '').trim();
if (!version) {
  console.error('--version is required.');
  process.exit(1);
}

const parsed = parseSemver(version);
if (!parsed) {
  console.error(`Invalid semantic version: ${version}`);
  process.exit(1);
}

const validationError = validateChannelVersion(channel, parsed);
if (validationError) {
  console.error(validationError);
  process.exit(1);
}

const artifactName = getArg('--artifact-name') ?? null;
const checksumPath = getArg('--checksum-path') ?? null;
const signaturePath = getArg('--signature-path') ?? null;
const releaseTag = getArg('--release-tag') ?? null;
const manifestOut = getArg('--manifest-out') ?? null;

const manifest = {
  schema_version: 'forge-distribution-manifest-v1',
  generated_at: new Date().toISOString(),
  channel,
  version,
  release_tag: releaseTag,
  upgrade_policy: {
    stable: 'upgrade_patch_and_minor_automatically_after_signature_verification',
    candidate: 'manual_opt_in_upgrade_with_change_window',
    canary: 'manual_opt_in_short_lived_validation_channel'
  },
  rollback_policy: 'rollback_to_previous_signed_artifact_in_same_channel',
  deprecation_policy: 'maintain_candidate_and_canary_for_one_minor_after_stable_promotion',
  artifact: {
    artifact_name: artifactName,
    checksum_path: checksumPath,
    signature_path: signaturePath
  }
};

if (manifestOut) {
  mkdirSync(dirname(manifestOut), { recursive: true });
  writeFileSync(manifestOut, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

logEvent('distribution_policy.validation_passed', {
  channel,
  version,
  release_tag: releaseTag,
  manifest_written: Boolean(manifestOut),
  manifest_out: manifestOut
});
