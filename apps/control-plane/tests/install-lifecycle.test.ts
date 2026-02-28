import { describe, expect, it } from 'vitest';
import {
  createDbBackedReporterSignatureVerifier,
  createPostgresLifecycleIdempotencyAdapter
} from '../src/install-lifecycle.js';

class FakeDb {
  readonly idempotency = new Map<
    string,
    {
      scope: string;
      idempotency_key: string;
      request_hash: string;
      response_code: number;
      response_body: unknown;
      stored_at: string;
    }
  >();

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('FROM security_reporter_keys')) {
      const reporterId = params[0] as string;
      const keyId = params[1] as string;

      if (reporterId === 'reporter-a' && keyId === 'key-valid') {
        return {
          rows: [
            {
              reporter_id: reporterId,
              key_id: keyId,
              key_algorithm: 'ed25519',
              active: true,
              revoked_at: null
            }
          ] as Row[],
          rowCount: 1
        };
      }

      if (reporterId === 'reporter-a' && keyId === 'key-revoked') {
        return {
          rows: [
            {
              reporter_id: reporterId,
              key_id: keyId,
              key_algorithm: 'ed25519',
              active: true,
              revoked_at: '2026-03-01T00:00:00Z'
            }
          ] as Row[],
          rowCount: 1
        };
      }

      return {
        rows: [],
        rowCount: 0
      };
    }

    if (sql.includes('FROM ingestion_idempotency_records')) {
      const scope = params[0] as string;
      const idempotencyKey = params[1] as string;
      const key = `${scope}:${idempotencyKey}`;
      const record = this.idempotency.get(key);

      return {
        rows: record ? ([record] as Row[]) : [],
        rowCount: record ? 1 : 0
      };
    }

    if (sql.includes('INSERT INTO ingestion_idempotency_records')) {
      const scope = params[0] as string;
      const idempotencyKey = params[1] as string;
      const requestHash = params[2] as string;
      const key = `${scope}:${idempotencyKey}`;
      const existing = this.idempotency.get(key);

      if (existing && existing.request_hash !== requestHash) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      this.idempotency.set(key, {
        scope,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        response_code: params[3] as number,
        response_body: JSON.parse(params[4] as string),
        stored_at: params[5] as string
      });

      return {
        rows: [{ request_hash: requestHash }] as Row[],
        rowCount: 1
      };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

describe('install lifecycle helpers', () => {
  it('verifies reporter keys with active/revoked semantics and signature validation', async () => {
    const db = new FakeDb();

    const verifier = createDbBackedReporterSignatureVerifier({
      db,
      async verifySignature(input) {
        return input.signature === 'sig-valid';
      }
    });

    await expect(
      verifier.verify({
        reporter_id: 'reporter-a',
        key_id: 'key-valid',
        canonical_string: 'canonical',
        signature: 'sig-valid'
      })
    ).resolves.toBe(true);

    await expect(
      verifier.verify({
        reporter_id: 'reporter-a',
        key_id: 'key-valid',
        canonical_string: 'canonical',
        signature: 'sig-invalid'
      })
    ).resolves.toBe(false);

    await expect(
      verifier.verify({
        reporter_id: 'reporter-a',
        key_id: 'key-revoked',
        canonical_string: 'canonical',
        signature: 'sig-valid'
      })
    ).resolves.toBe(false);

    await expect(
      verifier.verify({
        reporter_id: 'reporter-a',
        key_id: 'key-unknown',
        canonical_string: 'canonical',
        signature: 'sig-valid'
      })
    ).resolves.toBe(false);
  });

  it('enforces generic lifecycle idempotency replay/conflict semantics', async () => {
    const db = new FakeDb();
    const idempotency = createPostgresLifecycleIdempotencyAdapter({ db });

    await idempotency.put({
      scope: 'POST:/v1/install/plans',
      idempotency_key: 'idem-1',
      request_hash: 'hash-1',
      response_code: 200,
      response_body: {
        status: 'planned',
        plan_id: 'plan-1'
      },
      stored_at: '2026-03-01T12:00:00Z'
    });

    const replay = await idempotency.get('POST:/v1/install/plans', 'idem-1');
    expect(replay?.request_hash).toBe('hash-1');

    await expect(
      idempotency.put({
        scope: 'POST:/v1/install/plans',
        idempotency_key: 'idem-1',
        request_hash: 'hash-2',
        response_code: 200,
        response_body: {
          status: 'planned',
          plan_id: 'plan-2'
        },
        stored_at: '2026-03-01T12:00:01Z'
      })
    ).rejects.toThrow('idempotency_conflict');
  });
});
