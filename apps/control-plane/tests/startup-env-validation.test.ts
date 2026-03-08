import { describe, expect, it } from 'vitest';
import { loadControlPlaneEnvConfig } from '../src/server.js';
import { validateControlPlaneStartupEnv } from '../src/startup-env-validation.js';

function createBaselineEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    FORGE_DATABASE_URL: 'postgres://example.invalid/forge',
    FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP: 'false',
    FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'false',
    FORGE_RUNTIME_REMOTE_SSE_ENABLED: 'false',
    FORGE_VSCODE_WORKSPACE_ROOT: '/tmp/forge-workspace',
    FORGE_VSCODE_USER_PROFILE_PATH: '/tmp/forge-user-profile.json',
    FORGE_VSCODE_DAEMON_DEFAULT_PATH: '/tmp/forge-daemon-default.json',
    ...overrides
  };
}

describe('control-plane startup env validation', () => {
  it('accepts valid baseline env matrix', () => {
    const result = validateControlPlaneStartupEnv(createBaselineEnv());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects retrieval bootstrap matrix when required env values are missing', () => {
    const result = validateControlPlaneStartupEnv({
      ...createBaselineEnv(),
      FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP: 'true',
      EMBEDDING_MODEL: 'text-embedding-3-large'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'QDRANT_URL is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true',
        'QDRANT_API_KEY is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true',
        'QDRANT_COLLECTION is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true',
        'EMBEDDING_DIMENSIONS is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true',
        'EMBEDDING_API_KEY or OPENAI_API_KEY is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true'
      ])
    );
  });

  it('rejects remote auth matrix without secret ref', () => {
    const result = validateControlPlaneStartupEnv({
      ...createBaselineEnv(),
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'true',
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL: 'https://remote.example.test/stream',
      FORGE_RUNTIME_REMOTE_AUTH_TYPE: 'bearer'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'FORGE_RUNTIME_REMOTE_SECRET_REF is required when FORGE_RUNTIME_REMOTE_AUTH_TYPE is set'
    );
  });

  it('skips remote runtime env validation when FORGE_RUNTIME_DAEMON_URL is configured', () => {
    const result = validateControlPlaneStartupEnv({
      ...createBaselineEnv(),
      FORGE_RUNTIME_DAEMON_URL: 'http://127.0.0.1:4100',
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'maybe',
      FORGE_RUNTIME_REMOTE_AUTH_TYPE: 'bearer'
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects missing VS Code adapter target paths', () => {
    const result = validateControlPlaneStartupEnv(
      createBaselineEnv({
        FORGE_VSCODE_USER_PROFILE_PATH: undefined
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'FORGE_VSCODE_USER_PROFILE_PATH is required for control-plane VS Code adapter targets'
    );
  });

  it('rejects non-absolute VS Code adapter target paths', () => {
    const result = validateControlPlaneStartupEnv(
      createBaselineEnv({
        FORGE_VSCODE_WORKSPACE_ROOT: './relative-workspace'
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('FORGE_VSCODE_WORKSPACE_ROOT must be an absolute path');
  });

  it('allows injected-adapter startup validation without VS Code adapter target paths', () => {
    const result = validateControlPlaneStartupEnv(
      createBaselineEnv({
        FORGE_VSCODE_WORKSPACE_ROOT: undefined,
        FORGE_VSCODE_USER_PROFILE_PATH: undefined,
        FORGE_VSCODE_DAEMON_DEFAULT_PATH: undefined
      }),
      {
        requireVscodeAdapterPaths: false
      }
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('throws deterministic config error in loadControlPlaneEnvConfig for invalid startup env', () => {
    expect(() =>
      loadControlPlaneEnvConfig({
        ...createBaselineEnv(),
        FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP: 'true'
      })
    ).toThrow('control_plane_env_invalid:');
  });

  it('parses explicit VS Code adapter target paths in loadControlPlaneEnvConfig', () => {
    expect(loadControlPlaneEnvConfig(createBaselineEnv())).toMatchObject({
      vscodeAdapterPaths: {
        workspaceRoot: '/tmp/forge-workspace',
        userProfilePath: '/tmp/forge-user-profile.json',
        daemonDefaultPath: '/tmp/forge-daemon-default.json'
      }
    });
  });

  it('skips VS Code adapter path parsing in loadControlPlaneEnvConfig when adapter injection is used', () => {
    expect(
      loadControlPlaneEnvConfig(
        createBaselineEnv({
          FORGE_VSCODE_WORKSPACE_ROOT: undefined,
          FORGE_VSCODE_USER_PROFILE_PATH: undefined,
          FORGE_VSCODE_DAEMON_DEFAULT_PATH: undefined
        }),
        {
          requireVscodeAdapterPaths: false
        }
      )
    ).toMatchObject({
      host: '127.0.0.1',
      port: 8787,
      databaseUrl: 'postgres://example.invalid/forge',
      requireRetrievalBootstrap: false
    });
  });
});
