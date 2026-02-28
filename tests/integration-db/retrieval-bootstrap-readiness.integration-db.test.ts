import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { resolveRetrievalSearchServiceForStartup } from '../../apps/control-plane/src/server.js';
import {
  createIntegrationDbExecutor,
  resetIntegrationTables
} from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

describe('integration-db: retrieval bootstrap readiness wiring', () => {
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const db = createIntegrationDbExecutor(pool);

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  beforeEach(async () => {
    await resetIntegrationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('keeps readiness ready when required retrieval bootstrap succeeds', async () => {
    const readinessState = {
      ok: true,
      details: [] as string[]
    };

    const service = await resolveRetrievalSearchServiceForStartup({
      config: {
        host: '127.0.0.1',
        port: 8787,
        databaseUrl,
        requireRetrievalBootstrap: true
      },
      env: process.env,
      db,
      startupLogger: {
        log() {
          return;
        }
      },
      readinessState,
      retrievalBootstrap: async ({ db: bootstrapDb }) => {
        await bootstrapDb.query('SELECT 1');

        return {
          config: {
            embeddingModel: 'text-embedding-3-small',
            qdrantCollection: 'forge-packages'
          },
          async search() {
            return {
              documents: [],
              semantic_fallback: true
            };
          }
        };
      }
    });

    expect(service).toBeDefined();
    expect(readinessState).toEqual({
      ok: true,
      details: []
    });
  });

  it('marks readiness not_ready when required retrieval bootstrap fails', async () => {
    const readinessState = {
      ok: true,
      details: [] as string[]
    };

    const service = await resolveRetrievalSearchServiceForStartup({
      config: {
        host: '127.0.0.1',
        port: 8787,
        databaseUrl,
        requireRetrievalBootstrap: true
      },
      env: process.env,
      db,
      startupLogger: {
        log() {
          return;
        }
      },
      readinessState,
      retrievalBootstrap: async () => {
        throw new Error('retrieval_bootstrap_test_failure');
      }
    });

    expect(service).toBeUndefined();
    expect(readinessState.ok).toBe(false);
    expect(readinessState.details).toEqual([
      'retrieval_bootstrap_failed:retrieval_bootstrap_test_failure'
    ]);
  });
});
