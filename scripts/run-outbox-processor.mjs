#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import {
  createPostgresInternalOutboxDispatchHandlers,
  createDeterministicOutboxDispatcher,
  createOutboxProcessorJob,
  createPostgresOutboxJobStore
} from '@forge/security-governance';
import {
  classifyRetrievalSyncFailure,
  createOpenAiEmbeddingProvider,
  createPostgresRetrievalSyncCandidateStore,
  createPostgresRetrievalSyncStateStore,
  createQdrantSemanticIndexWriter,
  createRetrievalSyncService
} from '@forge/ranking';

const VALID_MODES = new Set(['dry-run', 'shadow', 'production']);

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function parseInteger(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function logEvent(eventName, payload) {
  console.log(
    JSON.stringify({
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      payload
    })
  );
}

function resolveRequiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`retrieval_sync_config_invalid: ${key} is required`);
  }
  return value;
}

function parseEmbeddingDimensions(value) {
  const parsed = Number.parseInt(value?.trim() ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      'retrieval_sync_config_invalid: EMBEDDING_DIMENSIONS must be a positive integer'
    );
  }
  return parsed;
}

function resolveEmbeddingApiKey() {
  const key = process.env.EMBEDDING_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'retrieval_sync_config_invalid: EMBEDDING_API_KEY or OPENAI_API_KEY is required'
    );
  }
  return key;
}

const mode = getArg('--mode') ?? process.env.OUTBOX_JOB_MODE ?? 'dry-run';
if (!VALID_MODES.has(mode)) {
  console.error(`Invalid mode "${mode}". Expected dry-run, shadow, or production.`);
  process.exit(1);
}

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required.');
  process.exit(1);
}

const limit = parseInteger(getArg('--limit') ?? process.env.OUTBOX_JOB_LIMIT, 100);
const maxAttempts = parseInteger(
  getArg('--max-attempts') ?? process.env.OUTBOX_MAX_ATTEMPTS,
  5
);
const retryBackoffSeconds = parseInteger(
  getArg('--retry-backoff-seconds') ?? process.env.OUTBOX_RETRY_BACKOFF_SECONDS,
  60
);
const rankingSyncLimit = parseInteger(
  getArg('--ranking-sync-limit') ?? process.env.OUTBOX_RANKING_SYNC_LIMIT,
  100
);

const dispatchEndpoint = process.env.OUTBOX_DISPATCH_ENDPOINT ?? null;
const dispatchBearerToken = process.env.OUTBOX_DISPATCH_BEARER_TOKEN ?? null;
const internalDispatch = (process.env.OUTBOX_INTERNAL_DISPATCH ?? 'false').toLowerCase() === 'true';
if (mode !== 'dry-run' && !dispatchEndpoint && !internalDispatch) {
  console.error('OUTBOX_DISPATCH_ENDPOINT is required for shadow/production modes.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl
});

const db = {
  async query(sql, params = []) {
    const result = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  }
};

const runId = randomUUID();
const nowIso = new Date().toISOString();

const store = createPostgresOutboxJobStore({
  db,
  maxAttempts,
  retryBackoffSeconds,
  logger: {
    log(event) {
      logEvent(event.event_name, {
        run_id: runId,
        ...event.payload
      });
    }
  }
});

const buildRankingSyncExecutor = () => {
  let service = null;

  function getService() {
    if (service) {
      return service;
    }

    const qdrantUrl = resolveRequiredEnv('QDRANT_URL');
    const qdrantApiKey = resolveRequiredEnv('QDRANT_API_KEY');
    const qdrantCollection = resolveRequiredEnv('QDRANT_COLLECTION');
    const embeddingModel = resolveRequiredEnv('EMBEDDING_MODEL');
    const embeddingDimensions = parseEmbeddingDimensions(process.env.EMBEDDING_DIMENSIONS);

    const embeddingProvider = createOpenAiEmbeddingProvider({
      apiKey: resolveEmbeddingApiKey(),
      ...(process.env.EMBEDDING_API_BASE_URL?.trim()
        ? {
            baseUrl: process.env.EMBEDDING_API_BASE_URL.trim()
          }
        : {})
    });

    service = createRetrievalSyncService({
      candidateStore: createPostgresRetrievalSyncCandidateStore({ db }),
      stateStore: createPostgresRetrievalSyncStateStore({ db }),
      semanticIndexWriter: createQdrantSemanticIndexWriter({
        qdrantUrl,
        qdrantApiKey,
        qdrantCollection,
        embeddingProvider,
        embeddingModel,
        embeddingDimensions
      })
    });

    return service;
  }

  return {
    async sync(input) {
      try {
        const syncService = getService();
        const result = await syncService.run({
          mode: 'apply',
          run_id: `${runId}:${input.outbox_job_id}`,
          limit: rankingSyncLimit,
          package_ids: input.package_ids,
          trigger: input.trigger
        });

        logEvent('outbox.ranking_sync.executed', {
          run_id: runId,
          outbox_job_id: input.outbox_job_id,
          dedupe_key: input.dedupe_key,
          correlation_id: input.correlation_id,
          result
        });

        return {
          candidate_count: result.candidate_count,
          upserted_count: result.upserted_count,
          unchanged_count: result.unchanged_count,
          persisted_state_count: result.persisted_state_count
        };
      } catch (error) {
        logEvent('outbox.ranking_sync.failed', {
          run_id: runId,
          outbox_job_id: input.outbox_job_id,
          dedupe_key: input.dedupe_key,
          failure_class: classifyRetrievalSyncFailure(error),
          error_message: error instanceof Error ? error.message : 'unknown_error'
        });
        throw error;
      }
    }
  };
};

const processor = createOutboxProcessorJob(
  store,
  internalDispatch
    ? createDeterministicOutboxDispatcher(
        createPostgresInternalOutboxDispatchHandlers({
          db,
          rankingSyncExecutor: buildRankingSyncExecutor(),
          logger: {
            log(event) {
              logEvent(event.event_name, {
                run_id: runId,
                ...event.payload
              });
            }
          }
        })
      )
    : {
        async dispatch(job) {
          if (!dispatchEndpoint) {
            return;
          }

          const response = await fetch(dispatchEndpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(dispatchBearerToken
                ? { authorization: `Bearer ${dispatchBearerToken}` }
                : {})
            },
            body: JSON.stringify({
              event_type: job.event_type,
              dedupe_key: job.dedupe_key,
              payload: job.payload,
              outbox_job_id: job.id,
              correlation_id: runId
            })
          });

          if (!response.ok) {
            throw new Error(`dispatch_http_status_${response.status}`);
          }
        }
      },
  {
    logger: {
      log(event) {
        logEvent(event.event_name, {
          run_id: runId,
          ...event.payload
        });
      }
    }
  }
);

try {
  const result = await processor.run(mode, nowIso, limit);
  logEvent('outbox.run_completed', {
    run_id: runId,
    mode,
    limit,
    result
  });
} catch (error) {
  logEvent('outbox.run_failed', {
    run_id: runId,
    mode,
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
