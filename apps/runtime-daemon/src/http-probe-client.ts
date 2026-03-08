import type { RemoteProbeClient, RemoteProbeResult } from './remote-connectors.js';

export interface HttpProbeClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: {
    log(event: {
      event_name: string;
      occurred_at: string;
      payload: Record<string, unknown>;
    }): void | Promise<void>;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;

async function emitLog(
  logger: HttpProbeClientOptions['logger'],
  event_name: string,
  payload: Record<string, unknown>
) {
  if (!logger) {
    return;
  }

  await logger.log({
    event_name,
    occurred_at: new Date().toISOString(),
    payload
  });
}

export function createHttpProbeClient(
  options: HttpProbeClientOptions = {}
): RemoteProbeClient {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function doFetch(
    probe_type: 'sse' | 'streamable_http',
    url: string,
    init: RequestInit
  ): Promise<RemoteProbeResult> {
    try {
      const response = await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        await emitLog(options.logger, 'runtime.remote_probe_failed', {
          probe_type,
          url,
          status: response.status
        });
      }

      return {
        ok: response.ok,
        status: response.status,
        details: response.ok ? 'probe_ok' : 'probe_http_error'
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : 'probe_request_failed';
      await emitLog(options.logger, 'runtime.remote_probe_failed', {
        probe_type,
        url,
        details
      });
      return {
        ok: false,
        details
      };
    }
  }

  return {
    async probeSse(url, headers) {
      return doFetch('sse', url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...headers
        },
        redirect: 'manual'
      });
    },

    async probeStreamableHttp(url, headers) {
      return doFetch('streamable_http', url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'forge-daemon-probe',
              version: '0.1.0'
            }
          }
        }),
        redirect: 'manual'
      });
    }
  };
}
