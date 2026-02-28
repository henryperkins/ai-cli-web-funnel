export interface OAuthTokenExchangeLogEvent {
  event_name: 'runtime.oauth_token_exchange_failed';
  occurred_at: string;
  payload: {
    correlation_id: string;
    package_id?: string;
    secret_ref: string;
    reason: string;
  };
}

export interface OAuthTokenExchangeLogger {
  log(event: OAuthTokenExchangeLogEvent): void | Promise<void>;
}

export interface OAuthClientCredentialsTokenClient {
  exchange(input: {
    secret_ref: string;
    secret_payload: string | null;
    correlation_id: string;
  }): Promise<{ token_type: string; access_token: string }>;
}

export interface OAuthClientCredentialsTokenClientOptions {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  refreshSkewMs?: number;
  logger?: OAuthTokenExchangeLogger;
}

interface OAuthClientCredentialsSecretConfig {
  token_url: string;
  client_id: string;
  client_secret: string;
  scope?: string;
  audience?: string;
}

interface CachedToken {
  access_token: string;
  token_type: string;
  expires_at_ms: number;
}

const DEFAULT_REFRESH_SKEW_MS = 30_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1_000;

function createError(code: string, message: string): Error {
  const error = new Error(`${code}:${message}`);
  return error;
}

function parseSecretConfig(secretPayload: string): OAuthClientCredentialsSecretConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretPayload);
  } catch {
    throw createError('oauth_secret_invalid', 'secret payload must be valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw createError('oauth_secret_invalid', 'secret payload must be a JSON object');
  }

  const payload = parsed as Record<string, unknown>;

  const tokenUrl = typeof payload.token_url === 'string' ? payload.token_url.trim() : '';
  const clientId = typeof payload.client_id === 'string' ? payload.client_id.trim() : '';
  const clientSecret =
    typeof payload.client_secret === 'string' ? payload.client_secret : '';
  const scope = typeof payload.scope === 'string' ? payload.scope.trim() : undefined;
  const audience =
    typeof payload.audience === 'string' ? payload.audience.trim() : undefined;

  if (!tokenUrl || !clientId || !clientSecret) {
    throw createError(
      'oauth_secret_invalid',
      'secret payload must include token_url, client_id, client_secret'
    );
  }

  return {
    token_url: tokenUrl,
    client_id: clientId,
    client_secret: clientSecret,
    ...(scope ? { scope } : {}),
    ...(audience ? { audience } : {})
  };
}

async function parseTokenResponse(
  response: Response,
  nowMs: () => number
): Promise<{
  access_token: string;
  token_type: string;
  expires_at_ms: number;
}> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw createError('oauth_token_response_invalid', 'token endpoint did not return JSON');
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw createError('oauth_token_response_invalid', 'token response must be a JSON object');
  }

  const tokenPayload = payload as Record<string, unknown>;

  const accessToken =
    typeof tokenPayload.access_token === 'string'
      ? tokenPayload.access_token.trim()
      : '';
  if (!accessToken) {
    throw createError('oauth_token_response_invalid', 'token response missing access_token');
  }

  const tokenTypeRaw =
    typeof tokenPayload.token_type === 'string'
      ? tokenPayload.token_type.trim()
      : 'Bearer';
  const tokenType = tokenTypeRaw.length === 0 ? 'Bearer' : tokenTypeRaw;

  const expiresIn =
    typeof tokenPayload.expires_in === 'number' && Number.isFinite(tokenPayload.expires_in)
      ? tokenPayload.expires_in
      : null;
  const expiresAt =
    typeof tokenPayload.expires_at === 'string'
      ? Date.parse(tokenPayload.expires_at)
      : Number.NaN;

  const now = nowMs();
  const expiresAtMs =
    expiresIn !== null && expiresIn > 0
      ? now + expiresIn * 1_000
      : Number.isFinite(expiresAt) && expiresAt > now
        ? expiresAt
        : now + DEFAULT_TOKEN_TTL_MS;

  return {
    access_token: accessToken,
    token_type: tokenType,
    expires_at_ms: expiresAtMs
  };
}

export function createOAuthClientCredentialsTokenClient(
  options: OAuthClientCredentialsTokenClientOptions = {}
): OAuthClientCredentialsTokenClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? (() => Date.now());
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const cache = new Map<string, CachedToken>();

  return {
    async exchange({ secret_ref, secret_payload, correlation_id }) {
      if (!secret_payload) {
        const error = createError('oauth_secret_invalid', 'secret payload not found');
        if (options.logger) {
          await options.logger.log({
            event_name: 'runtime.oauth_token_exchange_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              correlation_id,
              secret_ref,
              reason: error.message
            }
          });
        }
        throw error;
      }

      const cached = cache.get(secret_ref);
      if (cached && nowMs() + refreshSkewMs < cached.expires_at_ms) {
        return {
          token_type: cached.token_type,
          access_token: cached.access_token
        };
      }

      let config: OAuthClientCredentialsSecretConfig;
      try {
        config = parseSecretConfig(secret_payload);
      } catch (error) {
        if (options.logger) {
          await options.logger.log({
            event_name: 'runtime.oauth_token_exchange_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              correlation_id,
              secret_ref,
              reason: error instanceof Error ? error.message : 'oauth_secret_invalid'
            }
          });
        }
        throw error;
      }

      const body = new URLSearchParams();
      body.set('grant_type', 'client_credentials');
      body.set('client_id', config.client_id);
      body.set('client_secret', config.client_secret);
      if (config.scope) {
        body.set('scope', config.scope);
      }
      if (config.audience) {
        body.set('audience', config.audience);
      }

      let response: Response;
      try {
        response = await fetchImpl(config.token_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded'
          },
          body
        });
      } catch (error) {
        const networkError = createError(
          'oauth_token_network_error',
          error instanceof Error ? error.message : 'request failed'
        );
        if (options.logger) {
          await options.logger.log({
            event_name: 'runtime.oauth_token_exchange_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              correlation_id,
              secret_ref,
              reason: networkError.message
            }
          });
        }
        throw networkError;
      }

      if (!response.ok) {
        const httpError = createError(
          'oauth_token_http_error',
          `status=${response.status}`
        );
        if (options.logger) {
          await options.logger.log({
            event_name: 'runtime.oauth_token_exchange_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              correlation_id,
              secret_ref,
              reason: httpError.message
            }
          });
        }
        throw httpError;
      }

      let tokenPayload: {
        access_token: string;
        token_type: string;
        expires_at_ms: number;
      };
      try {
        tokenPayload = await parseTokenResponse(response, nowMs);
      } catch (error) {
        if (options.logger) {
          await options.logger.log({
            event_name: 'runtime.oauth_token_exchange_failed',
            occurred_at: new Date().toISOString(),
            payload: {
              correlation_id,
              secret_ref,
              reason: error instanceof Error ? error.message : 'oauth_token_response_invalid'
            }
          });
        }
        throw error;
      }

      cache.set(secret_ref, {
        access_token: tokenPayload.access_token,
        token_type: tokenPayload.token_type,
        expires_at_ms: tokenPayload.expires_at_ms
      });

      return {
        token_type: tokenPayload.token_type,
        access_token: tokenPayload.access_token
      };
    }
  };
}
