import { createHash } from 'node:crypto';
import { createOpenAiEmbeddingProvider, type EmbeddingProvider } from './embedding-provider.js';
import type { PostgresQueryExecutor } from './postgres-bm25-retriever.js';

export type RetrievalSyncMode = 'dry-run' | 'apply';
export type RetrievalSyncFailureClass = 'transient' | 'permanent';

export interface RetrievalSyncCandidate {
  package_id: string;
  package_slug: string | null;
  canonical_repo: string | null;
  updated_at: string;
  aliases: string[];
  title: string;
  description: string;
}

export interface RetrievalSyncDocument {
  id: string;
  text: string;
  metadata: {
    package_id: string;
    package_slug: string | null;
    canonical_repo: string | null;
    aliases: string[];
    title: string;
    description: string;
    updated_at: string;
  };
  payload_sha256: string;
  source_updated_at: string;
}

export interface RetrievalSyncBatchResult {
  candidates: RetrievalSyncCandidate[];
  next_cursor: string | null;
}

export interface RetrievalSyncRunResult {
  mode: RetrievalSyncMode;
  run_id: string;
  cursor: string | null;
  next_cursor: string | null;
  candidate_count: number;
  projected_count: number;
  unchanged_count: number;
  upserted_count: number;
  persisted_state_count: number;
}

export interface RetrievalSyncRunInput {
  mode: RetrievalSyncMode;
  run_id: string;
  cursor?: string | null;
  limit?: number;
  package_ids?: string[];
  trigger?: string;
}

export interface RetrievalSyncCandidateStore {
  listBatch(input: {
    cursor: string | null;
    limit: number;
    package_ids?: string[];
  }): Promise<RetrievalSyncBatchResult>;
}

export interface RetrievalSyncStateStore {
  getHashes(packageIds: string[]): Promise<Map<string, string>>;
  upsertState(
    documents: RetrievalSyncDocument[],
    input: {
      synced_at: string;
      sync_mode: string;
      trigger: string;
    }
  ): Promise<void>;
}

export interface SemanticIndexWriter {
  upsertDocuments(documents: RetrievalSyncDocument[]): Promise<void>;
}

export interface RetrievalSyncServiceDependencies {
  candidateStore: RetrievalSyncCandidateStore;
  stateStore: RetrievalSyncStateStore;
  semanticIndexWriter: SemanticIndexWriter;
  now?: () => Date;
}

export interface PostgresRetrievalSyncCandidateStoreOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresRetrievalSyncStateStoreOptions {
  db: PostgresQueryExecutor;
}

export interface QdrantSemanticIndexWriterOptions {
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  embeddingDimensions: number;
  fetchImpl?: typeof fetch;
}

export interface PostgresRetrievalSyncServiceFromEnvOptions {
  db: PostgresQueryExecutor;
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  embeddingFetchImpl?: typeof fetch;
  now?: () => Date;
}

interface CandidateRow {
  package_id: string;
  package_slug: string | null;
  canonical_repo: string | null;
  updated_at: string;
  aliases: unknown;
  title: string;
  description: string;
}

interface StateRow {
  package_id: string;
  payload_sha256: string;
}

function stableJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value.normalize('NFC'));
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key.normalize('NFC'))}:${stableJson(entryValue)}`)
      .join(',')}}`;
  }

  return 'null';
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function normalizeAliases(aliases: string[]): string[] {
  const normalized = aliases
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function parseAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string');
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return 100;
  }

  return Math.min(500, Math.max(1, limit));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizePackageIds(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .filter((entry) => isUuid(entry))
    )
  ).sort((left, right) => left.localeCompare(right));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseEmbeddingDimensions(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      'retrieval_sync_config_invalid: EMBEDDING_DIMENSIONS must be a positive integer'
    );
  }
  return parsed;
}

function resolveEmbeddingApiKey(env: Readonly<Record<string, string | undefined>>): string {
  const key = env.EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'retrieval_sync_config_invalid: EMBEDDING_API_KEY or OPENAI_API_KEY is required'
    );
  }
  return key;
}

function resolveRequiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: string
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`retrieval_sync_config_invalid: ${key} is required`);
  }
  return value;
}

function buildProjectionText(candidate: RetrievalSyncCandidate): string {
  const aliases = normalizeAliases(candidate.aliases);
  const segments = [
    normalizeText(candidate.title),
    normalizeText(candidate.description),
    normalizeText(candidate.package_slug),
    normalizeText(candidate.canonical_repo),
    aliases.join(' ')
  ].filter((entry) => entry.length > 0);

  return segments.join('\n');
}

export function projectRetrievalSyncDocument(
  candidate: RetrievalSyncCandidate
): RetrievalSyncDocument {
  const aliases = normalizeAliases(candidate.aliases);
  const title =
    normalizeText(candidate.title) ||
    normalizeText(candidate.package_slug) ||
    candidate.package_id;
  const description = normalizeText(candidate.description);
  const text = buildProjectionText({
    ...candidate,
    aliases,
    title,
    description
  });

  const metadata = {
    package_id: candidate.package_id,
    package_slug: candidate.package_slug,
    canonical_repo: candidate.canonical_repo,
    aliases,
    title,
    description,
    updated_at: candidate.updated_at
  } satisfies RetrievalSyncDocument['metadata'];

  return {
    id: candidate.package_id,
    text,
    metadata,
    payload_sha256: sha256Hex({
      id: candidate.package_id,
      text,
      metadata
    }),
    source_updated_at: candidate.updated_at
  };
}

export function classifyRetrievalSyncFailure(error: unknown): RetrievalSyncFailureClass {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('timeout') ||
    message.includes('tempor') ||
    message.includes('transient') ||
    message.includes('rate') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('econn') ||
    message.includes('enotfound')
  ) {
    return 'transient';
  }

  return 'permanent';
}

export function createRetrievalSyncService(
  dependencies: RetrievalSyncServiceDependencies
) {
  return {
    async run(input: RetrievalSyncRunInput): Promise<RetrievalSyncRunResult> {
      const nowIso = (dependencies.now ?? (() => new Date()))().toISOString();
      const limit = normalizeLimit(input.limit);
      const cursor = input.cursor?.trim() || null;
      const packageIds = normalizePackageIds(input.package_ids);
      const trigger = input.trigger?.trim() || 'manual';

      const batch = await dependencies.candidateStore.listBatch({
        cursor,
        limit,
        ...(packageIds ? { package_ids: packageIds } : {})
      });

      const projected = batch.candidates.map((candidate) =>
        projectRetrievalSyncDocument(candidate)
      );
      const existingHashes = await dependencies.stateStore.getHashes(
        projected.map((entry) => entry.metadata.package_id)
      );
      const changed = projected.filter(
        (entry) => existingHashes.get(entry.metadata.package_id) !== entry.payload_sha256
      );
      const unchangedCount = projected.length - changed.length;

      let upsertedCount = 0;
      let persistedStateCount = 0;

      if (input.mode === 'apply' && changed.length > 0) {
        await dependencies.semanticIndexWriter.upsertDocuments(changed);
        upsertedCount = changed.length;

        await dependencies.stateStore.upsertState(changed, {
          synced_at: nowIso,
          sync_mode: 'apply',
          trigger
        });
        persistedStateCount = changed.length;
      }

      return {
        mode: input.mode,
        run_id: input.run_id,
        cursor,
        next_cursor: batch.next_cursor,
        candidate_count: batch.candidates.length,
        projected_count: projected.length,
        unchanged_count: unchangedCount,
        upserted_count: upsertedCount,
        persisted_state_count: persistedStateCount
      };
    }
  };
}

export function createPostgresRetrievalSyncCandidateStore(
  options: PostgresRetrievalSyncCandidateStoreOptions
): RetrievalSyncCandidateStore {
  return {
    async listBatch(input): Promise<RetrievalSyncBatchResult> {
      const limit = normalizeLimit(input.limit);
      const packageIds = normalizePackageIds(input.package_ids);

      let rows: CandidateRow[];
      if (packageIds && packageIds.length > 0) {
        const result = await options.db.query<CandidateRow>(
          `
            SELECT
              p.id::text AS package_id,
              p.package_slug,
              p.canonical_repo,
              p.updated_at::text AS updated_at,
              COALESCE((
                SELECT array_agg(alias.alias_value ORDER BY alias.alias_value)
                FROM package_aliases AS alias
                WHERE alias.package_id = p.id
                  AND alias.active = TRUE
              ), ARRAY[]::text[]) AS aliases,
              COALESCE((
                SELECT pfl.field_value_json #>> '{}'
                FROM package_field_lineage AS pfl
                WHERE pfl.package_id = p.id
                  AND pfl.field_name = 'name'
                ORDER BY pfl.resolved_at DESC
                LIMIT 1
              ), p.package_slug, p.id::text) AS title,
              COALESCE((
                SELECT pfl.field_value_json #>> '{}'
                FROM package_field_lineage AS pfl
                WHERE pfl.package_id = p.id
                  AND pfl.field_name = 'description'
                ORDER BY pfl.resolved_at DESC
                LIMIT 1
              ), '') AS description
            FROM registry.packages AS p
            WHERE p.id = ANY($1::uuid[])
            ORDER BY p.id ASC
            LIMIT $2
          `,
          [packageIds, limit]
        );
        rows = result.rows;
      } else {
        const result = await options.db.query<CandidateRow>(
          `
            WITH selected AS (
              SELECT
                p.id,
                p.package_slug,
                p.canonical_repo,
                p.updated_at
              FROM registry.packages AS p
              WHERE ($1::text IS NULL OR p.id::text > $1::text)
              ORDER BY p.id ASC
              LIMIT $2
            )
            SELECT
              selected.id::text AS package_id,
              selected.package_slug,
              selected.canonical_repo,
              selected.updated_at::text AS updated_at,
              COALESCE((
                SELECT array_agg(alias.alias_value ORDER BY alias.alias_value)
                FROM package_aliases AS alias
                WHERE alias.package_id = selected.id
                  AND alias.active = TRUE
              ), ARRAY[]::text[]) AS aliases,
              COALESCE((
                SELECT pfl.field_value_json #>> '{}'
                FROM package_field_lineage AS pfl
                WHERE pfl.package_id = selected.id
                  AND pfl.field_name = 'name'
                ORDER BY pfl.resolved_at DESC
                LIMIT 1
              ), selected.package_slug, selected.id::text) AS title,
              COALESCE((
                SELECT pfl.field_value_json #>> '{}'
                FROM package_field_lineage AS pfl
                WHERE pfl.package_id = selected.id
                  AND pfl.field_name = 'description'
                ORDER BY pfl.resolved_at DESC
                LIMIT 1
              ), '') AS description
            FROM selected
            ORDER BY selected.id ASC
          `,
          [input.cursor, limit]
        );
        rows = result.rows;
      }

      const candidates = rows.map((row) => ({
        package_id: row.package_id,
        package_slug: row.package_slug,
        canonical_repo: row.canonical_repo,
        updated_at: row.updated_at,
        aliases: normalizeAliases(parseAliases(row.aliases)),
        title: row.title,
        description: row.description
      }));

      return {
        candidates,
        next_cursor:
          !packageIds && candidates.length === limit
            ? candidates[candidates.length - 1]?.package_id ?? null
            : null
      };
    }
  };
}

export function createPostgresRetrievalSyncStateStore(
  options: PostgresRetrievalSyncStateStoreOptions
): RetrievalSyncStateStore {
  return {
    async getHashes(packageIds): Promise<Map<string, string>> {
      const normalized = normalizePackageIds(packageIds);
      if (!normalized) {
        return new Map();
      }

      const result = await options.db.query<StateRow>(
        `
          SELECT
            package_id::text AS package_id,
            payload_sha256
          FROM retrieval_sync_documents
          WHERE package_id = ANY($1::uuid[])
        `,
        [normalized]
      );

      const output = new Map<string, string>();
      for (const row of result.rows) {
        output.set(row.package_id, row.payload_sha256);
      }

      return output;
    },

    async upsertState(documents, input): Promise<void> {
      for (const document of documents) {
        await options.db.query(
          `
            INSERT INTO retrieval_sync_documents (
              package_id,
              document_id,
              payload_sha256,
              source_updated_at,
              last_synced_at,
              last_sync_mode,
              last_trigger,
              updated_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4::timestamptz,
              $5::timestamptz,
              $6,
              $7,
              $5::timestamptz
            )
            ON CONFLICT (package_id) DO UPDATE
            SET
              document_id = EXCLUDED.document_id,
              payload_sha256 = EXCLUDED.payload_sha256,
              source_updated_at = EXCLUDED.source_updated_at,
              last_synced_at = EXCLUDED.last_synced_at,
              last_sync_mode = EXCLUDED.last_sync_mode,
              last_trigger = EXCLUDED.last_trigger,
              updated_at = EXCLUDED.updated_at
          `,
          [
            document.metadata.package_id,
            document.id,
            document.payload_sha256,
            document.source_updated_at,
            input.synced_at,
            input.sync_mode,
            input.trigger
          ]
        );
      }
    }
  };
}

export function createQdrantSemanticIndexWriter(
  options: QdrantSemanticIndexWriterOptions
): SemanticIndexWriter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const qdrantBaseUrl = normalizeBaseUrl(options.qdrantUrl);
  const collection = encodeURIComponent(options.qdrantCollection);

  return {
    async upsertDocuments(documents): Promise<void> {
      if (documents.length === 0) {
        return;
      }

      const points = [];
      for (const document of documents) {
        const embedding = await options.embeddingProvider.embed({
          model: options.embeddingModel,
          text: document.text,
          dimensions: options.embeddingDimensions
        });

        points.push({
          id: document.id,
          vector: embedding,
          payload: {
            text: document.text,
            ...document.metadata
          }
        });
      }

      const response = await fetchImpl(
        `${qdrantBaseUrl}/collections/${collection}/points?wait=true`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'api-key': options.qdrantApiKey
          },
          body: JSON.stringify({
            points
          })
        }
      );

      if (!response.ok) {
        throw new Error(`retrieval_sync_qdrant_upsert_failed:status=${response.status}`);
      }
    }
  };
}

export function createPostgresRetrievalSyncServiceFromEnv(
  options: PostgresRetrievalSyncServiceFromEnvOptions
) {
  const env = options.env ?? process.env;
  const qdrantUrl = resolveRequiredEnv(env, 'QDRANT_URL');
  const qdrantApiKey = resolveRequiredEnv(env, 'QDRANT_API_KEY');
  const qdrantCollection = resolveRequiredEnv(env, 'QDRANT_COLLECTION');
  const embeddingModel = resolveRequiredEnv(env, 'EMBEDDING_MODEL');
  const embeddingDimensions = parseEmbeddingDimensions(env.EMBEDDING_DIMENSIONS);
  const embeddingApiKey = resolveEmbeddingApiKey(env);

  const embeddingProvider = createOpenAiEmbeddingProvider({
    apiKey: embeddingApiKey,
    ...(env.EMBEDDING_API_BASE_URL?.trim()
      ? {
          baseUrl: env.EMBEDDING_API_BASE_URL.trim()
        }
      : {}),
    ...(options.embeddingFetchImpl ? { fetchImpl: options.embeddingFetchImpl } : {})
  });

  return createRetrievalSyncService({
    candidateStore: createPostgresRetrievalSyncCandidateStore({
      db: options.db
    }),
    stateStore: createPostgresRetrievalSyncStateStore({
      db: options.db
    }),
    semanticIndexWriter: createQdrantSemanticIndexWriter({
      qdrantUrl,
      qdrantApiKey,
      qdrantCollection,
      embeddingProvider,
      embeddingModel,
      embeddingDimensions,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }),
    ...(options.now ? { now: options.now } : {})
  });
}
