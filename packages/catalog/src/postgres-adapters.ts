import type {
  CatalogAliasCandidate,
  CatalogConflictCandidate,
  CatalogFieldLineageCandidate,
  CatalogIngestResult,
  CatalogPackageCandidate
} from './index.js';

export interface PostgresQueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface PostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresTransactionalQueryExecutor extends PostgresQueryExecutor {
  withTransaction?<T>(callback: (tx: PostgresQueryExecutor) => Promise<T>): Promise<T>;
}

export interface CatalogIngestPersistenceResult {
  merge_run_id: string;
  package_id: string | null;
  queued_conflicts: number;
}

export interface CatalogPackageListItem {
  package_id: string;
  package_slug: string | null;
  canonical_repo: string | null;
  updated_at: string;
}

export interface CatalogPackageAliasRecord {
  alias_type: string;
  alias_value: string;
  source_name: string;
  active: boolean;
}

export interface CatalogPackageLineageSummaryRecord {
  field_name: string;
  field_source: string;
  field_source_updated_at: string | null;
  merge_run_id: string;
}

export interface CatalogPackageDetail extends CatalogPackageListItem {
  aliases: CatalogPackageAliasRecord[];
  lineage_summary: CatalogPackageLineageSummaryRecord[];
}

export type CatalogSourceFreshnessStatus = 'succeeded' | 'failed';

export interface CatalogSourceFreshnessRecord {
  source_name: string;
  status: CatalogSourceFreshnessStatus;
  stale: boolean;
  stale_after_minutes: number;
  last_attempt_at: string;
  last_success_at: string | null;
  merge_run_id: string | null;
  failure_class: string | null;
  failure_message: string | null;
  updated_at: string;
}

export interface CatalogSourceFreshnessUpsertInput {
  source_name: string;
  status: CatalogSourceFreshnessStatus;
  stale_after_minutes?: number;
  last_attempt_at: string;
  last_success_at?: string | null;
  merge_run_id?: string | null;
  failure_class?: string | null;
  failure_message?: string | null;
}

export interface CatalogReconciliationRunInput {
  run_id: string;
  run_hash: string;
  source_name: string;
  mode: 'dry-run' | 'apply';
  status: 'succeeded' | 'failed';
  attempts: number;
  merge_run_id?: string | null;
  started_at: string;
  completed_at: string;
  details?: Record<string, unknown>;
}

export interface CatalogReconciliationRunWriteResult {
  replayed: boolean;
}

export interface CatalogPackageFreshnessRecord {
  package_id: string;
  last_ingested_at: string | null;
  latest_source_updated_at: string | null;
  age_minutes: number | null;
  source_statuses: CatalogSourceFreshnessRecord[];
}

export interface CatalogPostgresAdapters {
  persistIngestResult(result: CatalogIngestResult): Promise<CatalogIngestPersistenceResult>;
  listPackages(limit: number, offset: number): Promise<CatalogPackageListItem[]>;
  getPackage(packageId: string): Promise<CatalogPackageDetail | null>;
  searchPackages(query: string, limit: number): Promise<CatalogPackageListItem[]>;
  recordSourceFreshness?(input: CatalogSourceFreshnessUpsertInput): Promise<void>;
  listSourceFreshness?(): Promise<CatalogSourceFreshnessRecord[]>;
  recordReconciliationRun?(
    input: CatalogReconciliationRunInput
  ): Promise<CatalogReconciliationRunWriteResult>;
  getPackageFreshness?(packageId: string): Promise<CatalogPackageFreshnessRecord | null>;
}

export interface CatalogPostgresAdapterOptions {
  db: PostgresTransactionalQueryExecutor;
}

async function runInTransaction<T>(
  db: PostgresTransactionalQueryExecutor,
  callback: (tx: PostgresQueryExecutor) => Promise<T>
): Promise<T> {
  if (db.withTransaction) {
    return db.withTransaction(callback);
  }

  await db.query('BEGIN');
  try {
    const result = await callback(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return `%${trimmed.replace(/[%_]/g, '')}%`;
}

function clampStaleAfterMinutes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 24 * 60;
  }

  const normalized = Math.trunc(value);
  if (normalized < 5) {
    return 5;
  }

  if (normalized > 7 * 24 * 60) {
    return 7 * 24 * 60;
  }

  return normalized;
}

async function upsertPackageMergeRun(
  tx: PostgresQueryExecutor,
  result: CatalogIngestResult
): Promise<void> {
  await tx.query(
    `
      INSERT INTO package_merge_runs (
        merge_run_id,
        source_snapshot,
        created_at
      )
      VALUES ($1, $2::jsonb, $3::timestamptz)
      ON CONFLICT (merge_run_id) DO UPDATE
      SET
        source_snapshot = EXCLUDED.source_snapshot
    `,
    [result.merge_run_id, JSON.stringify(result.source_snapshot), result.occurred_at]
  );
}

async function upsertIdentityConflict(
  tx: PostgresQueryExecutor,
  conflict: CatalogConflictCandidate,
  occurredAt: string
): Promise<void> {
  await tx.query(
    `
      INSERT INTO package_identity_conflicts (
        conflict_fingerprint,
        canonical_locator_candidate,
        conflicting_aliases,
        detected_by,
        status,
        review_sla_hours,
        review_due_at,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3::jsonb,
        $4,
        $5,
        $6,
        $7::timestamptz,
        $8::timestamptz
      )
      ON CONFLICT (conflict_fingerprint) DO UPDATE
      SET
        canonical_locator_candidate = EXCLUDED.canonical_locator_candidate,
        conflicting_aliases = EXCLUDED.conflicting_aliases,
        detected_by = EXCLUDED.detected_by,
        review_sla_hours = EXCLUDED.review_sla_hours,
        review_due_at = EXCLUDED.review_due_at
    `,
    [
      conflict.conflict_fingerprint,
      conflict.canonical_locator_candidate,
      JSON.stringify(conflict.conflicting_aliases),
      conflict.detected_by,
      conflict.status,
      conflict.review_sla_hours,
      conflict.review_due_at,
      occurredAt
    ]
  );
}

async function upsertPackage(
  tx: PostgresQueryExecutor,
  packageCandidate: CatalogPackageCandidate,
  occurredAt: string
): Promise<void> {
  await tx.query(
    `
      INSERT INTO registry.packages (
        id,
        package_id,
        package_slug,
        canonical_repo,
        repo_aliases,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $1::uuid,
        $2,
        $3,
        $4::text[],
        $5::timestamptz,
        $5::timestamptz
      )
      ON CONFLICT (id) DO UPDATE
      SET
        package_id = EXCLUDED.package_id,
        package_slug = EXCLUDED.package_slug,
        canonical_repo = EXCLUDED.canonical_repo,
        repo_aliases = EXCLUDED.repo_aliases,
        updated_at = EXCLUDED.updated_at
    `,
    [
      packageCandidate.package_id,
      packageCandidate.package_slug,
      packageCandidate.canonical_repo,
      packageCandidate.repo_aliases,
      occurredAt
    ]
  );
}

async function upsertAliases(
  tx: PostgresQueryExecutor,
  aliases: CatalogAliasCandidate[],
  occurredAt: string
): Promise<void> {
  for (const alias of aliases) {
    await tx.query(
      `
        INSERT INTO package_aliases (
          package_id,
          alias_type,
          alias_value,
          source_name,
          active,
          created_at,
          retired_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6::timestamptz,
          CASE WHEN $5 THEN NULL ELSE $6::timestamptz END
        )
        ON CONFLICT (alias_type, alias_value) DO UPDATE
        SET
          package_id = EXCLUDED.package_id,
          source_name = EXCLUDED.source_name,
          active = EXCLUDED.active,
          retired_at = CASE
            WHEN EXCLUDED.active THEN NULL
            ELSE COALESCE(package_aliases.retired_at, EXCLUDED.created_at)
          END
      `,
      [
        alias.package_id,
        alias.alias_type,
        alias.alias_value,
        alias.source_name,
        alias.active,
        occurredAt
      ]
    );
  }
}

async function upsertLineage(
  tx: PostgresQueryExecutor,
  lineageRows: CatalogFieldLineageCandidate[],
  occurredAt: string
): Promise<void> {
  for (const lineage of lineageRows) {
    await tx.query(
      `
        INSERT INTO package_field_lineage (
          package_id,
          field_name,
          field_value_json,
          field_source,
          field_source_updated_at,
          merge_run_id,
          resolved_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3::jsonb,
          $4,
          $5::timestamptz,
          $6,
          $7::timestamptz
        )
        ON CONFLICT (package_id, field_name, merge_run_id) DO UPDATE
        SET
          field_value_json = EXCLUDED.field_value_json,
          field_source = EXCLUDED.field_source,
          field_source_updated_at = EXCLUDED.field_source_updated_at,
          resolved_at = EXCLUDED.resolved_at
      `,
      [
        lineage.package_id,
        lineage.field_name,
        JSON.stringify(lineage.field_value_json),
        lineage.field_source,
        lineage.field_source_updated_at,
        lineage.merge_run_id,
        occurredAt
      ]
    );
  }
}

export function createCatalogPostgresAdapters(
  options: CatalogPostgresAdapterOptions
): CatalogPostgresAdapters {
  return {
    async persistIngestResult(result) {
      await runInTransaction(options.db, async (tx) => {
        await upsertPackageMergeRun(tx, result);

        for (const conflict of result.conflicts) {
          await upsertIdentityConflict(tx, conflict, result.occurred_at);
        }

        if (!result.package_candidate) {
          return;
        }

        await upsertPackage(tx, result.package_candidate, result.occurred_at);
        await upsertAliases(tx, result.alias_candidates, result.occurred_at);
        await upsertLineage(tx, result.field_lineage, result.occurred_at);
      });

      return {
        merge_run_id: result.merge_run_id,
        package_id: result.package_candidate?.package_id ?? null,
        queued_conflicts: result.conflicts.length
      } satisfies CatalogIngestPersistenceResult;
    },

    async listPackages(limit, offset) {
      const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
      const safeOffset = Math.max(0, Math.trunc(offset));

      const result = await options.db.query<CatalogPackageListItem>(
        `
          SELECT
            p.id::text AS package_id,
            p.package_slug,
            p.canonical_repo,
            p.updated_at::text AS updated_at
          FROM registry.packages p
          ORDER BY p.updated_at DESC, p.id::text ASC
          LIMIT $1 OFFSET $2
        `,
        [safeLimit, safeOffset]
      );

      return result.rows;
    },

    async getPackage(packageId) {
      const packageResult = await options.db.query<CatalogPackageListItem>(
        `
          SELECT
            p.id::text AS package_id,
            p.package_slug,
            p.canonical_repo,
            p.updated_at::text AS updated_at
          FROM registry.packages p
          WHERE p.id = $1::uuid
          LIMIT 1
        `,
        [packageId]
      );

      const packageRow = packageResult.rows[0];
      if (!packageRow) {
        return null;
      }

      const aliasesResult = await options.db.query<CatalogPackageAliasRecord>(
        `
          SELECT
            alias_type,
            alias_value,
            source_name,
            active
          FROM package_aliases
          WHERE package_id = $1::uuid
          ORDER BY alias_type ASC, alias_value ASC
        `,
        [packageId]
      );

      const lineageResult = await options.db.query<CatalogPackageLineageSummaryRecord>(
        `
          SELECT DISTINCT ON (field_name)
            field_name,
            field_source,
            field_source_updated_at::text AS field_source_updated_at,
            merge_run_id
          FROM package_field_lineage
          WHERE package_id = $1::uuid
          ORDER BY field_name, resolved_at DESC
        `,
        [packageId]
      );

      return {
        ...packageRow,
        aliases: aliasesResult.rows,
        lineage_summary: lineageResult.rows
      } satisfies CatalogPackageDetail;
    },

    async searchPackages(query, limit) {
      const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
      const pattern = normalizeSearchQuery(query);
      if (pattern.length === 0) {
        return [];
      }

      const result = await options.db.query<CatalogPackageListItem>(
        `
          SELECT DISTINCT
            p.id::text AS package_id,
            p.package_slug,
            p.canonical_repo,
            p.updated_at::text AS updated_at
          FROM registry.packages p
          LEFT JOIN package_field_lineage lineage
            ON lineage.package_id = p.id
           AND lineage.field_name IN ('name', 'description', 'tags')
          WHERE
            p.package_slug ILIKE $1
            OR COALESCE(p.canonical_repo, '') ILIKE $1
            OR lineage.field_value_json::text ILIKE $1
          ORDER BY p.updated_at DESC, p.id::text ASC
          LIMIT $2
        `,
        [pattern, safeLimit]
      );

      return result.rows;
    },

    async recordSourceFreshness(input) {
      const staleAfterMinutes = clampStaleAfterMinutes(input.stale_after_minutes);

      await options.db.query(
        `
          INSERT INTO catalog_source_freshness (
            source_name,
            status,
            stale_after_minutes,
            last_attempt_at,
            last_success_at,
            merge_run_id,
            failure_class,
            failure_message,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4::timestamptz,
            $5::timestamptz,
            $6,
            $7,
            $8,
            $9::timestamptz
          )
          ON CONFLICT (source_name) DO UPDATE
          SET
            status = EXCLUDED.status,
            stale_after_minutes = EXCLUDED.stale_after_minutes,
            last_attempt_at = EXCLUDED.last_attempt_at,
            last_success_at = EXCLUDED.last_success_at,
            merge_run_id = EXCLUDED.merge_run_id,
            failure_class = EXCLUDED.failure_class,
            failure_message = EXCLUDED.failure_message,
            updated_at = EXCLUDED.updated_at
        `,
        [
          input.source_name,
          input.status,
          staleAfterMinutes,
          input.last_attempt_at,
          input.last_success_at ?? null,
          input.merge_run_id ?? null,
          input.failure_class ?? null,
          input.failure_message ?? null,
          input.last_attempt_at
        ]
      );
    },

    async listSourceFreshness() {
      const result = await options.db.query<CatalogSourceFreshnessRecord>(
        `
          SELECT
            source_name,
            status,
            stale_after_minutes,
            last_attempt_at::text AS last_attempt_at,
            last_success_at::text AS last_success_at,
            merge_run_id,
            failure_class,
            failure_message,
            updated_at::text AS updated_at,
            (
              last_success_at IS NULL OR
              last_success_at < (now() - ((stale_after_minutes::text || ' minutes')::interval))
            ) AS stale
          FROM catalog_source_freshness
          ORDER BY source_name ASC
        `
      );

      return result.rows;
    },

    async recordReconciliationRun(input) {
      const existing = await options.db.query<{ run_hash: string }>(
        `
          SELECT run_hash
          FROM catalog_reconciliation_runs
          WHERE run_id = $1
          LIMIT 1
        `,
        [input.run_id]
      );

      const existingHash = existing.rows[0]?.run_hash;
      if (existingHash) {
        if (existingHash !== input.run_hash) {
          throw new Error('catalog_reconciliation_conflict');
        }

        return {
          replayed: true
        } satisfies CatalogReconciliationRunWriteResult;
      }

      await options.db.query(
        `
          INSERT INTO catalog_reconciliation_runs (
            run_id,
            run_hash,
            source_name,
            mode,
            status,
            attempts,
            merge_run_id,
            started_at,
            completed_at,
            details,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::timestamptz,
            $9::timestamptz,
            $10::jsonb,
            $8::timestamptz
          )
        `,
        [
          input.run_id,
          input.run_hash,
          input.source_name,
          input.mode,
          input.status,
          input.attempts,
          input.merge_run_id ?? null,
          input.started_at,
          input.completed_at,
          JSON.stringify(input.details ?? {})
        ]
      );

      return {
        replayed: false
      } satisfies CatalogReconciliationRunWriteResult;
    },

    async getPackageFreshness(packageId) {
      const packageExists = await options.db.query<{ package_id: string }>(
        `
          SELECT id::text AS package_id
          FROM registry.packages
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [packageId]
      );

      if ((packageExists.rowCount ?? packageExists.rows.length) === 0) {
        return null;
      }

      const lineage = await options.db.query<{
        last_ingested_at: string | null;
        latest_source_updated_at: string | null;
        age_minutes: string | null;
      }>(
        `
          SELECT
            MAX(resolved_at)::text AS last_ingested_at,
            MAX(field_source_updated_at)::text AS latest_source_updated_at,
            CASE
              WHEN MAX(resolved_at) IS NULL THEN NULL
              ELSE FLOOR(EXTRACT(EPOCH FROM (now() - MAX(resolved_at))) / 60)::text
            END AS age_minutes
          FROM package_field_lineage
          WHERE package_id = $1::uuid
        `,
        [packageId]
      );

      const sourceStatusesResult = await options.db.query<CatalogSourceFreshnessRecord>(
        `
          SELECT
            source_name,
            status,
            stale_after_minutes,
            last_attempt_at::text AS last_attempt_at,
            last_success_at::text AS last_success_at,
            merge_run_id,
            failure_class,
            failure_message,
            updated_at::text AS updated_at,
            (
              last_success_at IS NULL OR
              last_success_at < (now() - ((stale_after_minutes::text || ' minutes')::interval))
            ) AS stale
          FROM catalog_source_freshness
          ORDER BY source_name ASC
        `
      );
      const ageMinutesRaw = lineage.rows[0]?.age_minutes;
      const ageMinutes =
        typeof ageMinutesRaw === 'string' ? Number.parseInt(ageMinutesRaw, 10) : null;

      return {
        package_id: packageId,
        last_ingested_at: lineage.rows[0]?.last_ingested_at ?? null,
        latest_source_updated_at: lineage.rows[0]?.latest_source_updated_at ?? null,
        age_minutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
        source_statuses: sourceStatusesResult.rows
      } satisfies CatalogPackageFreshnessRecord;
    }
  };
}
