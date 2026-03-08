import { describe, expect, it } from 'vitest';
import {
  buildReleaseArtifactNames,
  evaluatePreparationReadiness,
  resolveGitTarget
} from '../../scripts/prepare-release-package.mjs';

describe('contract: release package preparation', () => {
  it('builds deterministic artifact names from channel, version, and sha', () => {
    const names = buildReleaseArtifactNames({
      channel: 'candidate',
      version: '0.2.0-rc.1',
      sha: 'abc1234'
    });

    expect(names.archiveName).toBe('forge-candidate-0.2.0-rc.1-abc1234.tar.gz');
    expect(names.checksumPath).toBe('artifacts/release.sha256');
    expect(names.signaturePath).toBe('artifacts/release.sha256.asc');
  });

  it('resolves an explicit git ref into full and short commit shas', () => {
    const calls = [];
    const target = resolveGitTarget('release-source', (args) => {
      calls.push(args.join(' '));

      if (args[2] === 'release-source^{commit}') {
        return 'abcdef1234567890';
      }

      if (args[2] === 'abcdef1234567890') {
        return 'abcdef1';
      }

      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    expect(target).toEqual({
      gitRef: 'release-source',
      fullSha: 'abcdef1234567890',
      shortSha: 'abcdef1'
    });
    expect(calls).toEqual([
      'rev-parse --verify release-source^{commit}',
      'rev-parse --short abcdef1234567890'
    ]);
  });

  it('treats dirty worktree, draft evidence, and missing signing key as blockers for package mode', () => {
    const result = evaluatePreparationReadiness({
      mode: 'package',
      worktreeDirty: true,
      evidenceValid: true,
      approvedEvidence: false,
      signingKeyAvailable: false
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(3);
  });

  it('downgrades package blockers to warnings in preflight mode', () => {
    const result = evaluatePreparationReadiness({
      mode: 'preflight',
      worktreeDirty: true,
      evidenceValid: true,
      approvedEvidence: false,
      signingKeyAvailable: false
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toHaveLength(3);
  });
});
