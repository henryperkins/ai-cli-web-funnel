import type { RemoteModeHooks, RuntimeStartRequest } from './index.js';
import type {
  OAuthClientCredentialsTokenClient,
  OAuthTokenExchangeLogger
} from './oauth-token-client.js';

export type RemoteAuthType =
  | 'api-key'
  | 'bearer'
  | 'oauth2_client_credentials';

export interface RemoteEndpointAuth {
  type: RemoteAuthType;
  secret_ref: string;
  header_name?: string;
}

export interface RemoteEndpointConfig {
  sse_url?: string;
  streamable_http_url?: string;
  auth?: RemoteEndpointAuth;
}

export interface RemoteConnectorResolver {
  resolve(request: RuntimeStartRequest): Promise<RemoteEndpointConfig | null>;
}

export interface SecretRefResolver {
  resolve(secretRef: string): Promise<string | null>;
}

export interface RemoteProbeResult {
  ok: boolean;
  status?: number;
  details?: string;
}

export interface RemoteProbeClient {
  probeSse(
    url: string,
    headers: Record<string, string>
  ): Promise<RemoteProbeResult>;
  probeStreamableHttp(
    url: string,
    headers: Record<string, string>
  ): Promise<RemoteProbeResult>;
}

export interface RemoteConnectorOptions {
  oauthTokenClient?: OAuthClientCredentialsTokenClient;
  logger?: OAuthTokenExchangeLogger;
}

async function buildAuthHeaders(
  auth: RemoteEndpointAuth | undefined,
  secret: string | null,
  options: RemoteConnectorOptions,
  request: RuntimeStartRequest
): Promise<{ ok: true; headers: Record<string, string> } | { ok: false; reason: string }> {
  if (!auth) {
    return {
      ok: true,
      headers: {}
    };
  }

  if (!secret) {
    return {
      ok: false,
      reason: 'secret_ref_not_found'
    };
  }

  if (auth.type === 'api-key') {
    return {
      ok: true,
      headers: {
        [auth.header_name ?? 'x-api-key']: secret
      }
    };
  }

  if (auth.type === 'bearer') {
    return {
      ok: true,
      headers: {
        Authorization: `Bearer ${secret}`
      }
    };
  }

  if (auth.type === 'oauth2_client_credentials') {
    if (!options.oauthTokenClient) {
      return {
        ok: false,
        reason: 'oauth_client_not_configured'
      };
    }

    try {
      const token = await options.oauthTokenClient.exchange({
        secret_ref: auth.secret_ref,
        secret_payload: secret,
        correlation_id: request.correlation_id ?? request.package_id
      });

      return {
        ok: true,
        headers: {
          Authorization: `${token.token_type} ${token.access_token}`
        }
      };
    } catch (error) {
      if (options.logger) {
        await options.logger.log({
          event_name: 'runtime.oauth_token_exchange_failed',
          occurred_at: new Date().toISOString(),
          payload: {
            correlation_id: request.correlation_id ?? request.package_id,
            package_id: request.package_id,
            secret_ref: auth.secret_ref,
            reason: error instanceof Error ? error.message : 'oauth_token_exchange_failed'
          }
        });
      }

      return {
        ok: false,
        reason: 'oauth_token_exchange_failed'
      };
    }
  }

  return {
    ok: true,
    headers: {
      Authorization: `Bearer ${secret}`
    }
  };
}

export function createRemoteConnectors(
  resolver: RemoteConnectorResolver,
  secrets: SecretRefResolver,
  probeClient: RemoteProbeClient,
  options: RemoteConnectorOptions = {}
): RemoteModeHooks {
  return {
    async connect_sse(request) {
      const config = await resolver.resolve(request);
      if (!config?.sse_url) {
        return {
          ok: false,
          reason_code: 'remote_sse_probe_failed',
          details: ['remote_config_missing_sse_url']
        };
      }

      const secret = config.auth
        ? await secrets.resolve(config.auth.secret_ref)
        : null;
      const auth = await buildAuthHeaders(config.auth, secret, options, request);
      if (!auth.ok) {
        return {
          ok: false,
          reason_code: 'remote_sse_probe_failed',
          details: [`remote_auth_failed:${auth.reason}`]
        };
      }

      const probe = await probeClient.probeSse(config.sse_url, auth.headers);
      if (!probe.ok) {
        return {
          ok: false,
          reason_code: 'remote_sse_probe_failed',
          details: [
            `remote_sse_probe_failed:${probe.status ?? 'no_status'}`,
            probe.details ?? 'probe_failed'
          ]
        };
      }

      return {
        ok: true,
        details: ['remote_sse_probe_ok']
      };
    },

    async connect_streamable_http(request) {
      const config = await resolver.resolve(request);
      if (!config?.streamable_http_url) {
        return {
          ok: false,
          reason_code: 'remote_streamable_http_probe_failed',
          details: ['remote_config_missing_streamable_http_url']
        };
      }

      const secret = config.auth
        ? await secrets.resolve(config.auth.secret_ref)
        : null;
      const auth = await buildAuthHeaders(config.auth, secret, options, request);
      if (!auth.ok) {
        return {
          ok: false,
          reason_code: 'remote_streamable_http_probe_failed',
          details: [`remote_auth_failed:${auth.reason}`]
        };
      }

      const probe = await probeClient.probeStreamableHttp(
        config.streamable_http_url,
        auth.headers
      );
      if (!probe.ok) {
        return {
          ok: false,
          reason_code: 'remote_streamable_http_probe_failed',
          details: [
            `remote_streamable_http_probe_failed:${probe.status ?? 'no_status'}`,
            probe.details ?? 'probe_failed'
          ]
        };
      }

      return {
        ok: true,
        details: ['remote_streamable_http_probe_ok']
      };
    }
  };
}
