import { describe, expect, it } from 'vitest';
import { loadControlPlaneEnvConfig } from '../src/server.js';
import { validateControlPlaneStartupEnv } from '../src/startup-env-validation.js';

describe('control-plane startup env validation', () => {
  it('accepts valid baseline env matrix', () => {
    const result = validateControlPlaneStartupEnv({
      FORGE_DATABASE_URL: 'postgres://example.invalid/forge',
      FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP: 'false',
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'false',
      FORGE_RUNTIME_REMOTE_SSE_ENABLED: 'false'
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects retrieval bootstrap matrix when required env values are missing', () => {
    const result = validateControlPlaneStartupEnv({
      FORGE_DATABASE_URL: 'postgres://example.invalid/forge',
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
      FORGE_DATABASE_URL: 'postgres://example.invalid/forge',
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
      FORGE_DATABASE_URL: 'postgres://example.invalid/forge',
      FORGE_RUNTIME_DAEMON_URL: 'http://127.0.0.1:4100',
      FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED: 'maybe',
      FORGE_RUNTIME_REMOTE_AUTH_TYPE: 'bearer'
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('throws deterministic config error in loadControlPlaneEnvConfig for invalid startup env', () => {
    expect(() =>
      loadControlPlaneEnvConfig({
        FORGE_DATABASE_URL: 'postgres://example.invalid/forge',
        FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP: 'true'
      })
    ).toThrow('control_plane_env_invalid:');
  });
});
