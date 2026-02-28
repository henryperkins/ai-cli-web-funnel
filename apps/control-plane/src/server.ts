import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { Pool, type PoolClient } from 'pg';
import { createForgeHttpAppFromPostgres, createForgeHttpNodeListener } from './http-app.js';
import { startControlPlaneRetrievalSearchService } from './retrieval-bootstrap.js';
import { validateControlPlaneStartupEnv } from './startup-env-validation.js';
import type {
  InstallLifecycleLogger,
  InstallRuntimeVerifier,
  PostgresQueryExecutor,
  PostgresQueryResult,
  PostgresTransactionalQueryExecutor
} from './install-lifecycle.js';

export interface RetrievalSearchServiceLike {
  search(query: string, limit: number): Promise<{
    documents: Array<{
      id: string;
      text: string;
      metadata?: Record<string, unknown>;
      bm25_score: number;
      semantic_score: number;
      fused_score: number;
    }>;
    semantic_fallback: boolean;
  }>;
  config?: {
    embeddingModel?: string;
    qdrantCollection?: string;
  };
}

export interface ControlPlaneStartupLogger {
  log(event: {
    event_name: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  }): void | Promise<void>;
}

export interface ControlPlaneEnvConfig {
  host: string;
  port: number;
  databaseUrl: string;
  requireRetrievalBootstrap: boolean;
}

export interface ControlPlaneServerHandle {
  host: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

export interface ControlPlaneServerOptions {
  db: PostgresTransactionalQueryExecutor & PostgresQueryExecutor;
  host?: string;
  port?: number;
  readinessState?: {
    ok: boolean;
    details: string[];
  };
  retrievalSearchService?: RetrievalSearchServiceLike;
  runtimeVerifier?: InstallRuntimeVerifier;
  installLogger?: InstallLifecycleLogger;
  signatureVerifier?: {
    verify(input: {
      reporter_id: string;
      key_id: string;
      canonical_string: string;
      signature: string;
    }): Promise<boolean>;
  };
}

export interface ControlPlaneServerFromEnvOptions {
  env?: NodeJS.ProcessEnv;
  retrievalBootstrap?: (context: {
    env: NodeJS.ProcessEnv;
    db: PostgresTransactionalQueryExecutor & PostgresQueryExecutor;
    startupLogger: ControlPlaneStartupLogger;
  }) => Promise<RetrievalSearchServiceLike>;
  runtimeVerifier?: InstallRuntimeVerifier;
  installLogger?: InstallLifecycleLogger;
  startupLogger?: ControlPlaneStartupLogger;
}

const defaultStartupLogger: ControlPlaneStartupLogger = {
  log(event) {
    console.log(JSON.stringify(event));
  }
};

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid FORGE_PORT value: ${value}`);
  }

  return parsed;
}

export function loadControlPlaneEnvConfig(
  env: NodeJS.ProcessEnv = process.env
): ControlPlaneEnvConfig {
  const validation = validateControlPlaneStartupEnv(env);
  if (!validation.ok) {
    throw new Error(`control_plane_env_invalid:${validation.errors.join(';')}`);
  }

  const databaseUrl = env.FORGE_DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('FORGE_DATABASE_URL or DATABASE_URL is required');
  }

  const host = env.FORGE_HOST?.trim() || '127.0.0.1';
  const port = parsePort(env.FORGE_PORT, 8787);
  const requireRetrievalBootstrap =
    (env.FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP ?? 'false').toLowerCase() === 'true';

  return {
    host,
    port,
    databaseUrl,
    requireRetrievalBootstrap
  };
}

export function createPoolQueryExecutor(
  pool: Pool
): PostgresTransactionalQueryExecutor {
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> => {
    const result = await pool.query(sql, params);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount
    };
  };

  const withTransaction = async <T>(
    callback: (tx: PostgresQueryExecutor) => Promise<T>
  ): Promise<T> => {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const txExecutor: PostgresQueryExecutor = {
        async query<Row = Record<string, unknown>>(
          sql: string,
          params: readonly unknown[] = []
        ): Promise<PostgresQueryResult<Row>> {
          const result = await client.query(sql, params);
          return {
            rows: result.rows as Row[],
            rowCount: result.rowCount
          };
        }
      };

      const output = await callback(txExecutor);
      await client.query('COMMIT');
      return output;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    query,
    withTransaction
  };
}

export async function startForgeControlPlaneServer(
  options: ControlPlaneServerOptions
): Promise<ControlPlaneServerHandle> {
  const readinessState = options.readinessState ?? {
    ok: true,
    details: []
  };

  const app = createForgeHttpAppFromPostgres({
    db: options.db,
    ...(options.signatureVerifier
      ? {
          signatureVerifier: options.signatureVerifier
        }
      : {}),
    ...(options.retrievalSearchService
      ? {
          retrievalSearchService: options.retrievalSearchService
        }
      : {}),
    ...(options.runtimeVerifier
      ? {
          runtimeVerifier: options.runtimeVerifier
        }
      : {}),
    ...(options.installLogger
      ? {
          installLogger: options.installLogger
        }
      : {}),
    readinessProbe: async () => readinessState
  });

  const server = createServer(createForgeHttpNodeListener(app));

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(
      {
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 8787
      },
      () => {
        server.off('error', rejectPromise);
        resolvePromise();
      }
    );
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve control-plane server address');
  }

  return {
    host: address.address,
    port: address.port,
    server,
    async close() {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    }
  };
}

export async function startForgeControlPlaneServerFromEnv(
  options: ControlPlaneServerFromEnvOptions = {}
): Promise<ControlPlaneServerHandle> {
  const config = loadControlPlaneEnvConfig(options.env);
  const pool = new Pool({
    connectionString: config.databaseUrl
  });

  const db = createPoolQueryExecutor(pool);
  const startupLogger = options.startupLogger ?? defaultStartupLogger;
  const readinessState = {
    ok: true,
    details: [] as string[]
  };

  try {
    await db.query('SELECT 1');
  } catch (error) {
    readinessState.ok = false;
    readinessState.details.push(
      `db_connectivity_failed:${error instanceof Error ? error.message : 'unknown_error'}`
    );
  }

  const retrievalSearchService = await resolveRetrievalSearchServiceForStartup({
    config,
    env: options.env ?? process.env,
    db,
    startupLogger,
    retrievalBootstrap: options.retrievalBootstrap,
    readinessState
  });

  const serverHandle = await startForgeControlPlaneServer({
    db,
    host: config.host,
    port: config.port,
    readinessState,
    ...(retrievalSearchService ? { retrievalSearchService } : {}),
    ...(options.runtimeVerifier ? { runtimeVerifier: options.runtimeVerifier } : {}),
    ...(options.installLogger ? { installLogger: options.installLogger } : {})
  });

  const originalClose = serverHandle.close.bind(serverHandle);

  return {
    ...serverHandle,
    async close() {
      await originalClose();
      await pool.end();
    }
  };
}

export async function resolveRetrievalSearchServiceForStartup(options: {
  config: ControlPlaneEnvConfig;
  env: NodeJS.ProcessEnv;
  db: PostgresTransactionalQueryExecutor & PostgresQueryExecutor;
  startupLogger: ControlPlaneStartupLogger;
  retrievalBootstrap?: ControlPlaneServerFromEnvOptions['retrievalBootstrap'];
  readinessState: {
    ok: boolean;
    details: string[];
  };
}): Promise<RetrievalSearchServiceLike | undefined> {
  if (!options.config.requireRetrievalBootstrap) {
    return undefined;
  }

  const bootstrap =
    options.retrievalBootstrap ??
    (async ({ env, db }: { env: NodeJS.ProcessEnv; db: PostgresTransactionalQueryExecutor & PostgresQueryExecutor }) =>
      startControlPlaneRetrievalSearchService({
        env,
        db,
        logger: {
          log(event) {
            return options.startupLogger.log(event);
          }
        }
      }));

  try {
    const service = await bootstrap({
      env: options.env,
      db: options.db,
      startupLogger: options.startupLogger
    });

    await options.startupLogger.log({
      event_name: 'control_plane.startup.retrieval_bootstrap_ready',
      occurred_at: new Date().toISOString(),
      payload: {
        qdrant_collection: service.config?.qdrantCollection ?? null,
        embedding_model: service.config?.embeddingModel ?? null
      }
    });

    return service;
  } catch (error) {
    options.readinessState.ok = false;
    const reason = error instanceof Error ? error.message : 'unknown_error';
    options.readinessState.details.push(`retrieval_bootstrap_failed:${reason}`);

    await options.startupLogger.log({
      event_name: 'control_plane.startup.retrieval_bootstrap_failed',
      occurred_at: new Date().toISOString(),
      payload: {
        reason
      }
    });

    return undefined;
  }
}

export async function requestJson(
  host: string,
  port: number,
  path: string,
  method: 'GET' | 'POST',
  body: unknown = null
): Promise<{ statusCode: number; body: unknown }> {
  const response = await fetch(`http://${host}:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json'
    },
    ...(body === null ? {} : { body: JSON.stringify(body) })
  });

  return {
    statusCode: response.status,
    body: await response.json()
  };
}
