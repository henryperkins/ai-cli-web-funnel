import { describe, expect, it } from 'vitest';
import type { CopilotAdapterContract } from '@forge/copilot-vscode-adapter';
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

function createStubCopilotAdapter(): CopilotAdapterContract {
  return {
    async discover_scopes() {
      return [
        {
          scope: 'workspace',
          scope_path: '/tmp/forge-workspace/.vscode/mcp.json',
          writable: true,
          approved: true,
          daemon_owned: true
        }
      ];
    },
    async read_entry() {
      return null;
    },
    async write_entry() {
      return;
    },
    async remove_entry() {
      return;
    },
    async policy_preflight() {
      return {
        outcome: 'allowed',
        install_allowed: true,
        runtime_allowed: true,
        reason_code: null,
        warnings: [],
        policy_blocked: false,
        blocked_by: 'none'
      };
    },
    lifecycle_hooks: {
      async on_before_write() {
        return;
      },
      async on_after_write() {
        return;
      },
      async on_lifecycle() {
        return;
      },
      async on_health_check() {
        return {
          healthy: true,
          details: []
        };
      }
    },
    remote_hooks: {}
  };
}

describe('control-plane server bootstrap', () => {
  it('starts server, serves health/readiness, and shuts down cleanly', async () => {
    try {
      const server = await startForgeControlPlaneServer({
        db: new FakeDb(),
        host: '127.0.0.1',
        port: 0,
        copilotAdapter: createStubCopilotAdapter()
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
        copilotAdapter: createStubCopilotAdapter(),
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
