import { describe, expect, it } from 'vitest';
import {
  resolveReleaseMetadata
} from '../../scripts/resolve-release-metadata.mjs';

describe('contract: release metadata resolution', () => {
  it('requires an explicit prerelease version for candidate workflow dispatch runs', () => {
    expect(() =>
      resolveReleaseMetadata({
        eventName: 'workflow_dispatch',
        inputChannel: 'candidate',
        inputVersion: '',
        releaseTag: '',
        packageVersion: '0.1.0'
      })
    ).toThrow('workflow_dispatch requires --release-version for candidate releases.');
  });

  it('derives stable release metadata from the published tag', () => {
    const resolved = resolveReleaseMetadata({
      eventName: 'release',
      inputChannel: 'candidate',
      inputVersion: '',
      releaseTag: 'v1.2.3',
      packageVersion: '0.1.0'
    });

    expect(resolved).toEqual({
      channel: 'stable',
      version: '1.2.3',
      releaseRef: 'v1.2.3'
    });
  });

  it('falls back to package version for stable workflow dispatch releases', () => {
    const resolved = resolveReleaseMetadata({
      eventName: 'workflow_dispatch',
      inputChannel: 'stable',
      inputVersion: '',
      releaseTag: '',
      packageVersion: '1.4.2'
    });

    expect(resolved).toEqual({
      channel: 'stable',
      version: '1.4.2',
      releaseRef: ''
    });
  });

  it('rejects invalid channel and version combinations before artifact generation', () => {
    expect(() =>
      resolveReleaseMetadata({
        eventName: 'workflow_dispatch',
        inputChannel: 'candidate',
        inputVersion: '0.2.0',
        releaseTag: '',
        packageVersion: '0.1.0'
      })
    ).toThrow(
      'candidate channel requires prerelease semantic version (for example -rc.1 or -beta.1).'
    );
  });
});
