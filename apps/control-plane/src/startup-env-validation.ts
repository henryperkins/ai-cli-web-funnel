import type { RuntimeRemoteConfigEnv } from './runtime-remote-config.js';

export interface ControlPlaneStartupEnvValidationResult {
  ok: boolean;
  errors: string[];
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function validateControlPlaneStartupEnv(
  env: NodeJS.ProcessEnv & RuntimeRemoteConfigEnv
): ControlPlaneStartupEnvValidationResult {
  const errors: string[] = [];

  const requireRetrievalBootstrap = parseBoolean(env.FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP);
  if (requireRetrievalBootstrap === null && env.FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP !== undefined) {
    errors.push(
      'FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP must be one of 1,true,yes,on,0,false,no,off'
    );
  }

  if (requireRetrievalBootstrap) {
    for (const key of [
      'QDRANT_URL',
      'QDRANT_API_KEY',
      'QDRANT_COLLECTION',
      'EMBEDDING_MODEL',
      'EMBEDDING_DIMENSIONS'
    ]) {
      if (!hasValue(env[key])) {
        errors.push(`${key} is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true`);
      }
    }

    if (!hasValue(env.EMBEDDING_API_KEY) && !hasValue(env.OPENAI_API_KEY)) {
      errors.push(
        'EMBEDDING_API_KEY or OPENAI_API_KEY is required when FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true'
      );
    }
  }

  const remoteSseEnabled = parseBoolean(env.FORGE_RUNTIME_REMOTE_SSE_ENABLED);
  if (remoteSseEnabled === null && env.FORGE_RUNTIME_REMOTE_SSE_ENABLED !== undefined) {
    errors.push('FORGE_RUNTIME_REMOTE_SSE_ENABLED must be one of 1,true,yes,on,0,false,no,off');
  }
  if (remoteSseEnabled && !hasValue(env.FORGE_RUNTIME_REMOTE_SSE_URL)) {
    errors.push(
      'FORGE_RUNTIME_REMOTE_SSE_URL is required when FORGE_RUNTIME_REMOTE_SSE_ENABLED=true'
    );
  }

  const remoteHttpEnabled = parseBoolean(env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED);
  if (
    remoteHttpEnabled === null &&
    env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED !== undefined
  ) {
    errors.push(
      'FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED must be one of 1,true,yes,on,0,false,no,off'
    );
  }
  if (remoteHttpEnabled && !hasValue(env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL)) {
    errors.push(
      'FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL is required when FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED=true'
    );
  }

  if (hasValue(env.FORGE_RUNTIME_REMOTE_AUTH_TYPE) && !hasValue(env.FORGE_RUNTIME_REMOTE_SECRET_REF)) {
    errors.push(
      'FORGE_RUNTIME_REMOTE_SECRET_REF is required when FORGE_RUNTIME_REMOTE_AUTH_TYPE is set'
    );
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
