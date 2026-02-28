import { describe, expect, it } from 'vitest';
import { resolveRuntimeFeatureFlagsFromEnv } from '../src/runtime-feature-flags.js';

describe('runtime feature flag env loader', () => {
  it('keeps conservative defaults when env is not set', () => {
    const flags = resolveRuntimeFeatureFlagsFromEnv({
      env: {}
    });

    expect(flags.runtime.localSupervisorEnabled).toBe(false);
    expect(flags.runtime.remoteSseEnabled).toBe(false);
    expect(flags.runtime.remoteStreamableHttpEnabled).toBe(false);
    expect(flags.runtime.scopeSidecarOwnershipEnabled).toBe(false);
  });

  it('applies explicit runtime env overrides', () => {
    const flags = resolveRuntimeFeatureFlagsFromEnv({
      env: {
        FORGE_RUNTIME_LOCAL_SUPERVISOR_ENABLED: 'true',
        FORGE_RUNTIME_REMOTE_SSE_ENABLED: '1',
        FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'yes',
        FORGE_RUNTIME_SCOPE_SIDECAR_OWNERSHIP_ENABLED: 'on',
        FORGE_RUNTIME_HARDCODED_VSCODE_PROFILE_PATH: 'false'
      }
    });

    expect(flags.runtime).toMatchObject({
      localSupervisorEnabled: true,
      remoteSseEnabled: true,
      remoteStreamableHttpEnabled: true,
      scopeSidecarOwnershipEnabled: true,
      hardcodedVsCodeProfilePath: false
    });
  });

  it('throws on invalid boolean env values', () => {
    expect(() =>
      resolveRuntimeFeatureFlagsFromEnv({
        env: {
          FORGE_RUNTIME_REMOTE_SSE_ENABLED: 'maybe'
        }
      })
    ).toThrow('runtime_feature_flag_invalid:FORGE_RUNTIME_REMOTE_SSE_ENABLED');
  });
});
