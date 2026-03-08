#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { validateDistributionPolicy } from './verify-distribution-policy.mjs';
import { validateReleaseEvidence } from './validate-release-evidence.mjs';

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

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8'
  }).trim();
}

function runGpg(args, env = process.env) {
  return execFileSync('gpg', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

export function buildReleaseArtifactNames({
  channel,
  version,
  sha,
  artifactsDir = 'artifacts'
}) {
  const versionSafe = version.replace(/[^A-Za-z0-9._-]+/g, '_');
  const archiveName = `forge-${channel}-${versionSafe}-${sha}.tar.gz`;

  return {
    archiveName,
    archivePath: join(artifactsDir, archiveName),
    checksumPath: join(artifactsDir, 'release.sha256'),
    signaturePath: join(artifactsDir, 'release.sha256.asc'),
    manifestPath: join(artifactsDir, 'distribution-manifest.json'),
    summaryPath: join(artifactsDir, 'release-package-summary.json')
  };
}

export function evaluatePreparationReadiness({
  mode,
  worktreeDirty,
  evidenceValid,
  approvedEvidence,
  signingKeyAvailable
}) {
  const blockers = [];
  const warnings = [];

  if (worktreeDirty) {
    const message = 'git worktree is dirty; final release artifacts must be generated from a committed revision.';
    if (mode === 'package') {
      blockers.push(message);
    } else {
      warnings.push(message);
    }
  }

  if (!evidenceValid) {
    blockers.push('release evidence is structurally invalid.');
  }

  if (!approvedEvidence) {
    const message = 'release evidence is not approved with completed sign-offs.';
    if (mode === 'package') {
      blockers.push(message);
    } else {
      warnings.push(message);
    }
  }

  if (!signingKeyAvailable) {
    const message =
      'no GPG signing key is available locally or via FORGE_RELEASE_GPG_PRIVATE_KEY_B64.';
    if (mode === 'package') {
      blockers.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    blockers,
    warnings,
    ready: blockers.length === 0
  };
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function findLocalSigningKeyId() {
  try {
    const output = runGpg(['--list-secret-keys', '--with-colons']);
    const match = output.match(/^sec:[^:]*:[^:]*:[^:]*:[^:]*:([^:]+):/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function signChecksum({
  checksumPath,
  signaturePath
}) {
  const envKey = process.env.FORGE_RELEASE_GPG_PRIVATE_KEY_B64?.trim();
  const envPassphrase = process.env.FORGE_RELEASE_GPG_PASSPHRASE ?? '';

  if (envKey) {
    const gpgHome = mkdtempSync(join(tmpdir(), 'forge-release-gpg-'));
    const keyPath = join(gpgHome, 'release.key');
    try {
      mkdirSync(gpgHome, { recursive: true });
      writeFileSync(keyPath, Buffer.from(envKey, 'base64'));
      runGpg(['--batch', '--import', keyPath], { GNUPGHOME: gpgHome });
      const keyOutput = runGpg(['--list-secret-keys', '--with-colons'], {
        GNUPGHOME: gpgHome
      });
      const match = keyOutput.match(/^sec:[^:]*:[^:]*:[^:]*:[^:]*:([^:]+):/m);
      if (!match) {
        throw new Error('Failed to resolve imported signing key id.');
      }

      const keyId = match[1];
      const baseArgs = ['--batch', '--yes', '--armor', '--detach-sign', '--local-user', keyId];
      const passphraseArgs = envPassphrase
        ? ['--pinentry-mode', 'loopback', '--passphrase', envPassphrase]
        : [];

      runGpg(
        [...baseArgs, ...passphraseArgs, '--output', signaturePath, checksumPath],
        { GNUPGHOME: gpgHome }
      );
      runGpg(['--verify', signaturePath, checksumPath], { GNUPGHOME: gpgHome });
      return {
        mode: 'env-imported',
        keyId
      };
    } finally {
      rmSync(gpgHome, {
        force: true,
        recursive: true
      });
    }
  }

  const localKeyId = findLocalSigningKeyId();
  if (!localKeyId) {
    throw new Error(
      'No GPG signing key available. Set FORGE_RELEASE_GPG_PRIVATE_KEY_B64 or import a local secret key.'
    );
  }

  runGpg([
    '--batch',
    '--yes',
    '--armor',
    '--detach-sign',
    '--local-user',
    localKeyId,
    '--output',
    signaturePath,
    checksumPath
  ]);
  runGpg(['--verify', signaturePath, checksumPath]);

  return {
    mode: 'local-keyring',
    keyId: localKeyId
  };
}

export function runCli(argv = process.argv) {
  const mode = (getArg('--mode', argv) ?? 'preflight').trim().toLowerCase();
  if (!['preflight', 'package'].includes(mode)) {
    console.error('Invalid --mode. Expected preflight or package.');
    return 1;
  }

  const channel = (getArg('--channel', argv) ?? 'candidate').trim().toLowerCase();
  const version = (getArg('--version', argv) ?? '').trim();
  const evidencePath = getArg('--evidence', argv) ?? 'docs/release-evidence.md';
  const artifactsDir = getArg('--artifacts-dir', argv) ?? 'artifacts';
  const releaseTag = getArg('--release-tag', argv) ?? `v${version}`;

  if (!version) {
    console.error('--version is required.');
    return 1;
  }

  try {
    const policy = validateDistributionPolicy({
      channel,
      version,
      releaseTag
    });

    const evidenceContent = readFileSync(evidencePath, 'utf8');
    const structuralEvidence = validateReleaseEvidence(evidenceContent, {
      expectedVersion: version
    });
    const approvedEvidence = validateReleaseEvidence(evidenceContent, {
      expectedVersion: version,
      requireApprovedStatus: true,
      requireCompletedSignoffs: true
    });
    const worktreeDirty = runGit(['status', '--porcelain']).length > 0;
    const signingKeyAvailable =
      Boolean(process.env.FORGE_RELEASE_GPG_PRIVATE_KEY_B64?.trim()) ||
      findLocalSigningKeyId() !== null;

    const readiness = evaluatePreparationReadiness({
      mode,
      worktreeDirty,
      evidenceValid: structuralEvidence.ok,
      approvedEvidence: approvedEvidence.ok,
      signingKeyAvailable
    });

    const sha = runGit(['rev-parse', '--short', 'HEAD']);
    const names = buildReleaseArtifactNames({
      channel: policy.channel,
      version: policy.version,
      sha,
      artifactsDir
    });

    const summary = {
      event_name:
        mode === 'package'
          ? readiness.ready
            ? 'release_package.prepared'
            : 'release_package.package_blocked'
          : 'release_package.preflight_completed',
      occurred_at: new Date().toISOString(),
      payload: {
        mode,
        channel: policy.channel,
        version: policy.version,
        release_tag: releaseTag,
        git_sha: sha,
        ready: readiness.ready,
        worktree_dirty: worktreeDirty,
        evidence_path: evidencePath,
        approved_evidence: approvedEvidence.ok,
        structural_evidence: structuralEvidence.ok,
        signing_key_available: signingKeyAvailable,
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        artifacts: {
          archive: names.archivePath,
          checksum: names.checksumPath,
          signature: names.signaturePath,
          manifest: names.manifestPath
        }
      }
    };

    if (!readiness.ready) {
      console.log(JSON.stringify(summary));
      return 1;
    }

    if (mode === 'preflight') {
      console.log(JSON.stringify(summary));
      return 0;
    }

    mkdirSync(artifactsDir, { recursive: true });

    runGit(['archive', '--format=tar.gz', '--output', names.archivePath, 'HEAD']);
    const checksum = sha256File(names.archivePath);
    writeFileSync(
      names.checksumPath,
      `${checksum}  ${names.archiveName}\n`,
      'utf8'
    );

    const signing = signChecksum({
      checksumPath: names.checksumPath,
      signaturePath: names.signaturePath
    });

    const manifest = validateDistributionPolicy({
      channel: policy.channel,
      version: policy.version,
      artifactName: names.archiveName,
      checksumPath: names.checksumPath,
      signaturePath: names.signaturePath,
      releaseTag
    }).manifest;

    writeFileSync(names.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const finalSummary = {
      ...summary,
      payload: {
        ...summary.payload,
        checksum,
        signing
      }
    };

    writeFileSync(names.summaryPath, `${JSON.stringify(finalSummary, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(finalSummary));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'failed to prepare release package');
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
