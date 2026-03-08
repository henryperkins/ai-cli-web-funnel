import process from 'node:process';
import {
  createOAuthClientCredentialsTokenClient,
  type OAuthClientCredentialsTokenClientOptions,
  type OAuthTokenExchangeLogger
} from './oauth-token-client.js';
import { createHttpProbeClient } from './http-probe-client.js';
import type {
  RemoteConnectorResolver,
  RemoteEndpointAuth,
  RemoteEndpointConfig,
  RemoteProbeClient,
  SecretRefResolver
} from './remote-connectors.js';

export type RuntimeRemoteConfigEnv = Readonly<Record<string, string | undefined>>;

function asOptionalTrimmed(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAuthType(value: string | null): RemoteEndpointAuth['type'] | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'api-key' ||
    normalized === 'bearer' ||
    normalized === 'oauth2_client_credentials'
  ) {
    return normalized;
  }

  throw new Error(
    'runtime_remote_config_invalid: FORGE_RUNTIME_REMOTE_AUTH_TYPE must be api-key, bearer, or oauth2_client_credentials'
  );
}

function resolveRemoteAuth(env: RuntimeRemoteConfigEnv): RemoteEndpointAuth | undefined {
  const authType = parseAuthType(asOptionalTrimmed(env.FORGE_RUNTIME_REMOTE_AUTH_TYPE));
  if (!authType) {
    return undefined;
  }

  const secretRef = asOptionalTrimmed(env.FORGE_RUNTIME_REMOTE_SECRET_REF);
  if (!secretRef) {
    throw new Error(
      'runtime_remote_config_invalid: FORGE_RUNTIME_REMOTE_SECRET_REF is required when remote auth is configured'
    );
  }

  const auth: RemoteEndpointAuth = {
    type: authType,
    secret_ref: secretRef
  };

  if (authType === 'api-key') {
    const headerName = asOptionalTrimmed(env.FORGE_RUNTIME_REMOTE_AUTH_HEADER_NAME);
    if (headerName) {
      auth.header_name = headerName;
    }
  }

  return auth;
}

function parseSecretMap(env: RuntimeRemoteConfigEnv): Record<string, string> {
  const raw = asOptionalTrimmed(env.FORGE_RUNTIME_SECRET_REFS_JSON);
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'runtime_remote_config_invalid: FORGE_RUNTIME_SECRET_REFS_JSON must be valid JSON object'
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'runtime_remote_config_invalid: FORGE_RUNTIME_SECRET_REFS_JSON must be a JSON object'
    );
  }

  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(
        'runtime_remote_config_invalid: FORGE_RUNTIME_SECRET_REFS_JSON values must be strings'
      );
    }
    map[key] = value;
  }

  return map;
}

function createSecretRefResolverFromMap(secretMap: Record<string, string>): SecretRefResolver {
  return {
    async resolve(secretRef: string): Promise<string | null> {
      return secretMap[secretRef] ?? null;
    }
  };
}

export function createRuntimeRemoteResolverFromEnv(
  env: RuntimeRemoteConfigEnv = process.env
): RemoteConnectorResolver {
  const sseUrl = asOptionalTrimmed(env.FORGE_RUNTIME_REMOTE_SSE_URL);
  const streamableHttpUrl = asOptionalTrimmed(env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL);
  const auth = sseUrl || streamableHttpUrl ? resolveRemoteAuth(env) : undefined;

  const config: RemoteEndpointConfig | null =
    sseUrl || streamableHttpUrl
      ? {
          ...(sseUrl ? { sse_url: sseUrl } : {}),
          ...(streamableHttpUrl ? { streamable_http_url: streamableHttpUrl } : {}),
          ...(auth ? { auth } : {})
        }
      : null;

  return {
    async resolve() {
      return config;
    }
  };
}

export function createSecretRefResolverFromEnv(
  env: RuntimeRemoteConfigEnv = process.env
): SecretRefResolver {
  return createSecretRefResolverFromMap(parseSecretMap(env));
}

export function createSecretRefResolver(options: {
  primary?: SecretRefResolver;
  fallback?: SecretRefResolver;
} = {}): SecretRefResolver {
  const fallback = options.fallback ?? createSecretRefResolverFromEnv();

  if (!options.primary) {
    return fallback;
  }
  const primary = options.primary;

  return {
    async resolve(secretRef: string): Promise<string | null> {
      const primaryValue = await primary.resolve(secretRef);
      if (primaryValue !== null) {
        return primaryValue;
      }
      return fallback.resolve(secretRef);
    }
  };
}

export function createFetchBackedRemoteProbeClient(
  fetchImpl: typeof fetch = fetch
): RemoteProbeClient {
  return createHttpProbeClient({
    fetchImpl
  });
}

export function createRuntimeOAuthTokenClientFromEnv(
  logger?: OAuthTokenExchangeLogger,
  options: Omit<OAuthClientCredentialsTokenClientOptions, 'logger'> = {}
) {
  const redactingLogger: OAuthTokenExchangeLogger | undefined = logger
    ? {
        async log(event) {
          const sanitizedReason = event.payload.reason
            .replace(/(client_secret=)[^&\s]+/gi, '$1[REDACTED]')
            .replace(/(access_token=)[^&\s]+/gi, '$1[REDACTED]')
            .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
            .replace(/(bearer\s+)[a-z0-9._-]{8,}/gi, '$1[REDACTED]');

          await logger.log({
            ...event,
            payload: {
              ...event.payload,
              reason: sanitizedReason
            }
          });
        }
      }
    : undefined;

  return createOAuthClientCredentialsTokenClient({
    ...options,
    ...(redactingLogger ? { logger: redactingLogger } : {})
  });
}
