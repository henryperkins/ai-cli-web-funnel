import { describe, expect, it } from 'vitest';
import {
  buildReleaseArtifactNames,
  evaluatePreparationReadiness
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
