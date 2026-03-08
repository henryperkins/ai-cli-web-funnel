import { describe, expect, it } from 'vitest';
import { createHttpProbeClient } from '../src/http-probe-client.js';

function fakeFetch(
  responseInit: { status: number; headers?: Record<string, string>; body?: string } | 'throw'
) {
  return (async () => {
    if (responseInit === 'throw') {
      throw new Error('network_error');
    }

    return new Response(responseInit.body ?? '', {
      status: responseInit.status,
      headers: responseInit.headers
    });
  }) as typeof fetch;
}

describe('http probe client', () => {
  it('probeSse returns ok when response is 200 with text/event-stream', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch({
        status: 200,
        headers: {
          'content-type': 'text/event-stream'
        }
      })
    });

    const result = await client.probeSse('https://example.com/sse', {});
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('probeSse returns not ok when response is non-2xx', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch({
        status: 502
      })
    });

    const result = await client.probeSse('https://example.com/sse', {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it('probeSse returns not ok on network error', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch('throw')
    });

    const result = await client.probeSse('https://example.com/sse', {});
    expect(result.ok).toBe(false);
    expect(result.details).toBe('network_error');
  });

  it('probeStreamableHttp sends POST with the expected request shape', async () => {
    let capturedInit: RequestInit | undefined;

    const client = createHttpProbeClient({
      fetchImpl: (async (_input, init) => {
        capturedInit = init;
        return new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        });
      }) as typeof fetch
    });

    const result = await client.probeStreamableHttp('https://example.com/mcp', {
      Authorization: 'Bearer tok'
    });

    expect(result.ok).toBe(true);
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer tok'
    });
  });

  it('probeStreamableHttp returns not ok on network error', async () => {
    const client = createHttpProbeClient({
      fetchImpl: fakeFetch('throw')
    });

    const result = await client.probeStreamableHttp('https://example.com/mcp', {});
    expect(result.ok).toBe(false);
    expect(result.details).toBe('network_error');
  });
});
