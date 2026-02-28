import { describe, expect, it } from 'vitest';
import { createOAuthClientCredentialsTokenClient } from '../src/oauth-token-client.js';

function buildSecretPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    token_url: 'https://auth.example.test/oauth/token',
    client_id: 'client-id',
    client_secret: 'client-secret',
    scope: 'scope:read',
    ...overrides
  });
}

describe('oauth2 client-credentials token exchange', () => {
  it('fetches token once and reuses in-memory cache until expiry window', async () => {
    let fetchCalls = 0;
    const client = createOAuthClientCredentialsTokenClient({
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: 'token-1',
            token_type: 'Bearer',
            expires_in: 600
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      },
      nowMs: () => 1_000
    });

    const first = await client.exchange({
      secret_ref: 'sec://oauth-client-1',
      secret_payload: buildSecretPayload(),
      correlation_id: 'corr-1'
    });
    const second = await client.exchange({
      secret_ref: 'sec://oauth-client-1',
      secret_payload: buildSecretPayload(),
      correlation_id: 'corr-1'
    });

    expect(fetchCalls).toBe(1);
    expect(first).toEqual({
      token_type: 'Bearer',
      access_token: 'token-1'
    });
    expect(second).toEqual(first);
  });

  it('throws deterministic error when token endpoint returns non-2xx', async () => {
    const client = createOAuthClientCredentialsTokenClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'invalid_client' }), {
          status: 401,
          headers: {
            'content-type': 'application/json'
          }
        })
    });

    await expect(
      client.exchange({
        secret_ref: 'sec://oauth-client-2',
        secret_payload: buildSecretPayload(),
        correlation_id: 'corr-2'
      })
    ).rejects.toThrow('oauth_token_http_error');
  });

  it('refreshes token deterministically after cached token expiry', async () => {
    let now = 10_000;
    let fetchCalls = 0;
    const client = createOAuthClientCredentialsTokenClient({
      nowMs: () => now,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `token-${fetchCalls}`,
            token_type: 'Bearer',
            expires_in: 1
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }
    });

    const first = await client.exchange({
      secret_ref: 'sec://oauth-client-3',
      secret_payload: buildSecretPayload(),
      correlation_id: 'corr-3'
    });
    now = 12_000;
    const second = await client.exchange({
      secret_ref: 'sec://oauth-client-3',
      secret_payload: buildSecretPayload(),
      correlation_id: 'corr-3'
    });

    expect(fetchCalls).toBe(2);
    expect(first.access_token).toBe('token-1');
    expect(second.access_token).toBe('token-2');
  });

  it('fails on malformed token response and does not leak client_secret in logs', async () => {
    const logs: Array<Record<string, unknown>> = [];
    const client = createOAuthClientCredentialsTokenClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 60 }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }),
      logger: {
        log(event) {
          logs.push(event.payload);
        }
      }
    });

    const secretPayload = buildSecretPayload({
      client_secret: 'super-secret-do-not-log'
    });

    await expect(
      client.exchange({
        secret_ref: 'sec://oauth-client-4',
        secret_payload: secretPayload,
        correlation_id: 'corr-4'
      })
    ).rejects.toThrow('oauth_token_response_invalid');

    expect(logs).toHaveLength(1);
    const payloadText = JSON.stringify(logs[0] ?? {});
    expect(payloadText).toContain('corr-4');
    expect(payloadText).toContain('sec://oauth-client-4');
    expect(payloadText).not.toContain('super-secret-do-not-log');
  });
});
