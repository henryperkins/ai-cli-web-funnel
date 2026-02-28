#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import {
  classifyRetrievalSyncFailure,
  createOpenAiEmbeddingProvider,
  createPostgresRetrievalSyncCandidateStore,
  createPostgresRetrievalSyncStateStore,
  createQdrantSemanticIndexWriter,
  createRetrievalSyncService
} from '@forge/ranking';

const VALID_MODES = new Set(['dry-run', 'apply']);

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function getArgValues(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function parseInteger(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizePackageIds(value) {
  if (!value) {
    return undefined;
  }

  const ids = Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );

  return ids.length > 0 ? ids : undefined;
}

function resolveRequiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`retrieval_sync_config_invalid: ${key} is required in apply mode`);
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
      'retrieval_sync_config_invalid: EMBEDDING_API_KEY or OPENAI_API_KEY is required in apply mode'
    );
  }
  return key;
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

const mode = (getArg('--mode') ?? 'dry-run').toLowerCase();
if (!VALID_MODES.has(mode)) {
  console.error(`Invalid --mode "${mode}". Expected dry-run or apply.`);
  process.exit(1);
}

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required.');
  process.exit(1);
}

const cursor = getArg('--cursor');
const limit = parseInteger(getArg('--limit') ?? process.env.RETRIEVAL_SYNC_LIMIT, 100);
const packageIdsFromCsv = normalizePackageIds(getArg('--package-ids'));
const packageIdsFromMulti = getArgValues('--package-id');
const packageIds =
  packageIdsFromCsv ?? (packageIdsFromMulti.length > 0 ? packageIdsFromMulti : undefined);
const runId = randomUUID();

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

const semanticIndexWriter =
  mode === 'apply'
    ? (() => {
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

        return createQdrantSemanticIndexWriter({
          qdrantUrl,
          qdrantApiKey,
          qdrantCollection,
          embeddingProvider,
          embeddingModel,
          embeddingDimensions
        });
      })()
    : {
        async upsertDocuments() {
          return;
        }
      };

const service = createRetrievalSyncService({
  candidateStore: createPostgresRetrievalSyncCandidateStore({ db }),
  stateStore: createPostgresRetrievalSyncStateStore({ db }),
  semanticIndexWriter
});

try {
  logEvent('retrieval_sync.run_started', {
    run_id: runId,
    mode,
    limit,
    cursor: cursor ?? null,
    package_ids: packageIds ?? null
  });

  const result = await service.run({
    mode,
    run_id: runId,
    cursor,
    limit,
    ...(packageIds ? { package_ids: packageIds } : {}),
    trigger: 'script.run-retrieval-sync'
  });

  logEvent('retrieval_sync.run_completed', {
    ...result
  });
} catch (error) {
  logEvent('retrieval_sync.run_failed', {
    run_id: runId,
    mode,
    failure_class: classifyRetrievalSyncFailure(error),
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
