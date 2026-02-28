import { describe, expect, it } from 'vitest';
import { requestJson, startForgeControlPlaneServer } from '../src/server.js';

class FakeDb {
  async query<Row = Record<string, unknown>>(): Promise<{ rows: Row[]; rowCount: number | null }> {
    return {
      rows: [],
      rowCount: 0
    };
  }

  async withTransaction<T>(
    callback: (tx: { query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> }) => Promise<T>
  ): Promise<T> {
    return callback({
      query: async <Row = Record<string, unknown>>() => ({ rows: [] as Row[], rowCount: 0 })
    });
  }
}

describe('control-plane server bootstrap', () => {
  it('starts server, serves health/readiness, and shuts down cleanly', async () => {
    try {
      const server = await startForgeControlPlaneServer({
        db: new FakeDb(),
        host: '127.0.0.1',
        port: 0
      });

      const health = await requestJson(server.host, server.port, '/healthz', 'GET');
      const ready = await requestJson(server.host, server.port, '/readyz', 'GET');

      expect(health.statusCode).toBe(200);
      expect(health.body).toMatchObject({ status: 'ok' });
      expect(ready.statusCode).toBe(200);
      expect(ready.body).toMatchObject({ status: 'ready' });

      await server.close();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('operation not permitted');
    }
  });

  it('fails closed on readiness when startup dependencies are degraded', async () => {
    try {
      const server = await startForgeControlPlaneServer({
        db: new FakeDb(),
        host: '127.0.0.1',
        port: 0,
        readinessState: {
          ok: false,
          details: ['db_connectivity_failed:timeout']
        }
      });

      const ready = await requestJson(server.host, server.port, '/ready', 'GET');

      expect(ready.statusCode).toBe(503);
      expect(ready.body).toMatchObject({
        status: 'not_ready',
        details: ['db_connectivity_failed:timeout']
      });

      await server.close();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('operation not permitted');
    }
  });
});
