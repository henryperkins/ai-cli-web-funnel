#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const VALID_CHANNELS = new Set(['stable', 'candidate', 'canary']);

function getArg(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return argv[index + 1] ?? null;
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

export function parseSemver(version) {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version);
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

export function validateChannelVersion(channel, parsed) {
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

export function buildDistributionManifest({
  channel,
  version,
  artifactName = null,
  checksumPath = null,
  signaturePath = null,
  releaseTag = null
}) {
  return {
    schema_version: 'forge-distribution-manifest-v1',
    generated_at: new Date().toISOString(),
    channel,
    version,
    release_tag: releaseTag && releaseTag.length > 0 ? releaseTag : null,
    upgrade_policy: {
      stable: 'upgrade_patch_and_minor_automatically_after_signature_verification',
      candidate: 'manual_opt_in_upgrade_with_change_window',
      canary: 'manual_opt_in_short_lived_validation_channel'
    },
    rollback_policy: 'rollback_to_previous_signed_artifact_in_same_channel',
    deprecation_policy:
      'maintain_candidate_and_canary_for_one_minor_after_stable_promotion',
    artifact: {
      artifact_name: artifactName,
      checksum_path: checksumPath,
      signature_path: signaturePath
    }
  };
}

export function validateDistributionPolicy({
  channel,
  version,
  artifactName = null,
  checksumPath = null,
  signaturePath = null,
  releaseTag = null
}) {
  const normalizedChannel = channel.toLowerCase();
  if (!VALID_CHANNELS.has(normalizedChannel)) {
    throw new Error('Invalid --channel. Expected stable, candidate, or canary.');
  }

  const normalizedVersion = version.trim();
  if (normalizedVersion.length === 0) {
    throw new Error('--version is required.');
  }

  const parsed = parseSemver(normalizedVersion);
  if (!parsed) {
    throw new Error(`Invalid semantic version: ${normalizedVersion}`);
  }

  const validationError = validateChannelVersion(normalizedChannel, parsed);
  if (validationError) {
    throw new Error(validationError);
  }

  return {
    channel: normalizedChannel,
    version: normalizedVersion,
    parsed,
    manifest: buildDistributionManifest({
      channel: normalizedChannel,
      version: normalizedVersion,
      artifactName,
      checksumPath,
      signaturePath,
      releaseTag
    })
  };
}

export function runCli(argv = process.argv) {
  try {
    const channel = (getArg('--channel', argv) ?? '').toLowerCase();
    const version = (getArg('--version', argv) ?? '').trim();
    const artifactName = getArg('--artifact-name', argv) ?? null;
    const checksumPath = getArg('--checksum-path', argv) ?? null;
    const signaturePath = getArg('--signature-path', argv) ?? null;
    const releaseTag = getArg('--release-tag', argv) ?? null;
    const manifestOut = getArg('--manifest-out', argv) ?? null;

    const result = validateDistributionPolicy({
      channel,
      version,
      artifactName,
      checksumPath,
      signaturePath,
      releaseTag
    });

    if (manifestOut) {
      mkdirSync(dirname(manifestOut), { recursive: true });
      writeFileSync(manifestOut, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
    }

    logEvent('distribution_policy.validation_passed', {
      channel: result.channel,
      version: result.version,
      release_tag: result.manifest.release_tag,
      manifest_written: Boolean(manifestOut),
      manifest_out: manifestOut
    });

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'distribution policy validation failed');
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
