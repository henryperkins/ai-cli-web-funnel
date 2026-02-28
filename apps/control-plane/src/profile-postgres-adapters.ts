import { createHash } from 'node:crypto';
import type {
  ProfileCreateInput,
  ProfileExportPayload,
  ProfileImportInput,
  ProfileInstallRunRecord,
  ProfileInstallRunStatus,
  ProfileInstallRunPlanStatus,
  ProfilePackageEntry,
  ProfileRecord,
  ProfileVisibility,
  ProfileTargetSdk,
  ProfileAuditAction
} from '@forge/shared-contracts';

export interface ProfilePostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface ProfilePostgresTransactionalQueryExecutor extends ProfilePostgresQueryExecutor {
  withTransaction?<T>(callback: (tx: ProfilePostgresQueryExecutor) => Promise<T>): Promise<T>;
}

export interface ProfileListItem {
  profile_id: string;
  name: string;
  author_id: string;
  visibility: ProfileVisibility;
  target_sdk: ProfileTargetSdk;
  tags: string[];
  version: string;
  package_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfilePostgresAdapters {
  createProfile(
    input: ProfileCreateInput,
    profileId: string
  ): Promise<ProfileRecord>;

  getProfile(profileId: string): Promise<ProfileRecord | null>;

  listProfiles(
    limit: number,
    offset: number,
    filters?: { author_id?: string; visibility?: ProfileVisibility }
  ): Promise<ProfileListItem[]>;

  exportProfile(profileId: string): Promise<ProfileExportPayload | null>;

  importProfile(
    input: ProfileImportInput,
    profileId: string
  ): Promise<ProfileRecord>;

  createInstallRun(
    profileId: string,
    runId: string,
    correlationId: string | null
  ): Promise<ProfileInstallRunRecord>;

  getInstallRun(runId: string): Promise<ProfileInstallRunRecord | null>;

  addInstallRunPlan(
    runInternalId: string,
    planInternalId: string,
    packageId: string,
    installOrder: number
  ): Promise<void>;

  addInstallRunPlanByPlanId(
    runId: string,
    planId: string,
    packageId: string,
    installOrder: number,
    status?: ProfileInstallRunPlanStatus
  ): Promise<void>;

  updateInstallRunPlanStatus(
    runInternalId: string,
    planInternalId: string,
    status: ProfileInstallRunPlanStatus
  ): Promise<void>;

  updateInstallRunPlanStatusByPlanId(
    runId: string,
    planId: string,
    status: ProfileInstallRunPlanStatus
  ): Promise<void>;

  completeInstallRun(
    runId: string,
    status: ProfileInstallRunStatus,
    counts: { succeeded: number; failed: number; skipped: number }
  ): Promise<void>;

  appendAudit(
    profileInternalId: string,
    action: ProfileAuditAction,
    actorId: string | null,
    payload: Record<string, unknown>
  ): Promise<void>;
}

export interface ProfilePostgresAdapterOptions {
  db: ProfilePostgresTransactionalQueryExecutor;
  now?: () => Date;
  idFactory?: () => string;
}

async function runInTransaction<T>(
  db: ProfilePostgresTransactionalQueryExecutor,
  callback: (tx: ProfilePostgresQueryExecutor) => Promise<T>
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

function computeProfileHash(input: {
  name: string;
  packages: Array<{ package_id: string; install_order: number }>;
}): string {
  const data = JSON.stringify({
    name: input.name,
    packages: input.packages
      .slice()
      .sort((a, b) => a.install_order - b.install_order)
      .map((p) => ({ package_id: p.package_id, install_order: p.install_order }))
  });
  return createHash('sha256').update(data).digest('hex');
}

async function insertProfilePackages(
  tx: ProfilePostgresQueryExecutor,
  profileInternalId: string,
  packages: ProfileCreateInput['packages']
): Promise<void> {
  for (const pkg of packages) {
    await tx.query(
      `
        INSERT INTO profile_packages (
          profile_internal_id,
          package_id,
          package_slug,
          version_pinned,
          required,
          install_order,
          config_overrides
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        profileInternalId,
        pkg.package_id,
        pkg.package_slug ?? null,
        pkg.version_pinned ?? null,
        pkg.required ?? true,
        pkg.install_order,
        JSON.stringify(pkg.config_overrides ?? {})
      ]
    );
  }
}

async function loadProfilePackages(
  db: ProfilePostgresQueryExecutor,
  profileInternalId: string
): Promise<ProfilePackageEntry[]> {
  const result = await db.query<{
    package_id: string;
    package_slug: string | null;
    version_pinned: string | null;
    required: boolean;
    install_order: number;
    config_overrides: Record<string, unknown>;
  }>(
    `
      SELECT
        pp.package_id::text AS package_id,
        pp.package_slug,
        pp.version_pinned,
        pp.required,
        pp.install_order,
        pp.config_overrides
      FROM profile_packages pp
      WHERE pp.profile_internal_id = $1::uuid
      ORDER BY pp.install_order ASC
    `,
    [profileInternalId]
  );
  return result.rows;
}

export function createProfilePostgresAdapters(
  options: ProfilePostgresAdapterOptions
): ProfilePostgresAdapters {
  const getNow = options.now ?? (() => new Date());

  return {
    async createProfile(input, profileId) {
      const now = getNow().toISOString();
      const visibility = input.visibility ?? 'private';
      const targetSdk = input.target_sdk ?? 'both';
      const tags = input.tags ?? [];
      const description = input.description ?? '';
      const profileHash = computeProfileHash({
        name: input.name,
        packages: input.packages
      });

      return runInTransaction(options.db, async (tx) => {
        const insertResult = await tx.query<{ id: string }>(
          `
            INSERT INTO profiles (
              profile_id, name, description, author_id,
              visibility, target_sdk, tags, version,
              profile_hash, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10::timestamptz, $10::timestamptz)
            RETURNING id::text
          `,
          [
            profileId,
            input.name,
            description,
            input.author_id,
            visibility,
            targetSdk,
            tags,
            '1.0.0',
            profileHash,
            now
          ]
        );

        const internalId = insertResult.rows[0]?.id;
        if (!internalId) {
          throw new Error('profile_insert_failed');
        }

        await insertProfilePackages(tx, internalId, input.packages);

        await tx.query(
          `
            INSERT INTO profile_audit (
              profile_internal_id, action, actor_id, payload, occurred_at
            )
            VALUES ($1::uuid, 'created', $2, $3::jsonb, $4::timestamptz)
          `,
          [internalId, input.author_id, JSON.stringify({ profile_id: profileId }), now]
        );

        const packages = await loadProfilePackages(tx, internalId);

        return {
          profile_id: profileId,
          name: input.name,
          description,
          author_id: input.author_id,
          visibility,
          target_sdk: targetSdk,
          tags,
          version: '1.0.0',
          profile_hash: profileHash,
          packages,
          created_at: now,
          updated_at: now
        } satisfies ProfileRecord;
      });
    },

    async getProfile(profileId) {
      const result = await options.db.query<{
        id: string;
        profile_id: string;
        name: string;
        description: string;
        author_id: string;
        visibility: ProfileVisibility;
        target_sdk: ProfileTargetSdk;
        tags: string[];
        version: string;
        profile_hash: string;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            p.id::text,
            p.profile_id,
            p.name,
            p.description,
            p.author_id,
            p.visibility,
            p.target_sdk,
            p.tags,
            p.version,
            p.profile_hash,
            p.created_at::text AS created_at,
            p.updated_at::text AS updated_at
          FROM profiles p
          WHERE p.profile_id = $1
          LIMIT 1
        `,
        [profileId]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      const packages = await loadProfilePackages(options.db, row.id);

      return {
        profile_id: row.profile_id,
        name: row.name,
        description: row.description,
        author_id: row.author_id,
        visibility: row.visibility,
        target_sdk: row.target_sdk,
        tags: row.tags,
        version: row.version,
        profile_hash: row.profile_hash,
        packages,
        created_at: row.created_at,
        updated_at: row.updated_at
      } satisfies ProfileRecord;
    },

    async listProfiles(limit, offset, filters) {
      const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
      const safeOffset = Math.max(0, Math.trunc(offset));

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (filters?.author_id) {
        conditions.push(`p.author_id = $${paramIdx}`);
        params.push(filters.author_id);
        paramIdx++;
      }

      if (filters?.visibility) {
        conditions.push(`p.visibility = $${paramIdx}`);
        params.push(filters.visibility);
        paramIdx++;
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      params.push(safeLimit, safeOffset);

      const result = await options.db.query<{
        profile_id: string;
        name: string;
        author_id: string;
        visibility: ProfileVisibility;
        target_sdk: ProfileTargetSdk;
        tags: string[];
        version: string;
        package_count: string;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            p.profile_id,
            p.name,
            p.author_id,
            p.visibility,
            p.target_sdk,
            p.tags,
            p.version,
            (
              SELECT COUNT(*)::text
              FROM profile_packages pp
              WHERE pp.profile_internal_id = p.id
            ) AS package_count,
            p.created_at::text AS created_at,
            p.updated_at::text AS updated_at
          FROM profiles p
          ${whereClause}
          ORDER BY p.updated_at DESC, p.profile_id ASC
          LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `,
        params
      );

      return result.rows.map((row) => ({
        ...row,
        package_count: Number(row.package_count)
      }));
    },

    async exportProfile(profileId) {
      const profile = await this.getProfile(profileId);
      if (!profile) {
        return null;
      }

      return {
        format_version: '1.0.0',
        profile: {
          profile_id: profile.profile_id,
          name: profile.name,
          description: profile.description,
          author_id: profile.author_id,
          visibility: profile.visibility,
          target_sdk: profile.target_sdk,
          tags: profile.tags,
          version: profile.version,
          packages: profile.packages
        },
        exported_at: getNow().toISOString()
      } satisfies ProfileExportPayload;
    },

    async importProfile(input, profileId) {
      const createInput: ProfileCreateInput = {
        name: input.profile.name,
        author_id: input.profile.author_id,
        packages: input.profile.packages,
        ...(input.profile.description !== undefined ? { description: input.profile.description } : {}),
        ...(input.profile.visibility !== undefined ? { visibility: input.profile.visibility } : {}),
        ...(input.profile.target_sdk !== undefined ? { target_sdk: input.profile.target_sdk } : {}),
        ...(input.profile.tags !== undefined ? { tags: input.profile.tags } : {})
      };

      const profile = await this.createProfile(createInput, profileId);

      const profileResult = await options.db.query<{ id: string }>(
        `SELECT id::text FROM profiles WHERE profile_id = $1 LIMIT 1`,
        [profileId]
      );
      const internalId = profileResult.rows[0]?.id;
      if (internalId) {
        await this.appendAudit(internalId, 'imported', input.profile.author_id, {
          profile_id: profileId,
          source_format_version: input.format_version
        });
      }

      return profile;
    },

    async createInstallRun(profileId, runId, correlationId) {
      const now = getNow().toISOString();

      const profileResult = await options.db.query<{
        id: string;
        profile_id: string;
      }>(
        `SELECT id::text, profile_id FROM profiles WHERE profile_id = $1 LIMIT 1`,
        [profileId]
      );

      const profileRow = profileResult.rows[0];
      if (!profileRow) {
        throw new Error('profile_not_found');
      }

      const packageCountResult = await options.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM profile_packages WHERE profile_internal_id = $1::uuid`,
        [profileRow.id]
      );
      const totalPackages = Number(packageCountResult.rows[0]?.count ?? '0');

      await options.db.query(
        `
          INSERT INTO profile_install_runs (
            run_id, profile_internal_id, profile_id, status,
            total_packages, correlation_id, started_at,
            created_at, updated_at
          )
          VALUES ($1, $2::uuid, $3, 'pending', $4, $5, $6::timestamptz, $6::timestamptz, $6::timestamptz)
        `,
        [runId, profileRow.id, profileId, totalPackages, correlationId, now]
      );

      await this.appendAudit(profileRow.id, 'install_started', null, {
        run_id: runId,
        total_packages: totalPackages
      });

      return {
        run_id: runId,
        profile_id: profileId,
        status: 'pending' as const,
        total_packages: totalPackages,
        succeeded_count: 0,
        failed_count: 0,
        skipped_count: 0,
        correlation_id: correlationId,
        started_at: now,
        completed_at: null,
        plans: []
      } satisfies ProfileInstallRunRecord;
    },

    async getInstallRun(runId) {
      const runResult = await options.db.query<{
        id: string;
        run_id: string;
        profile_id: string;
        status: ProfileInstallRunStatus;
        total_packages: number;
        succeeded_count: number;
        failed_count: number;
        skipped_count: number;
        correlation_id: string | null;
        started_at: string;
        completed_at: string | null;
      }>(
        `
          SELECT
            r.id::text,
            r.run_id,
            r.profile_id,
            r.status,
            r.total_packages,
            r.succeeded_count,
            r.failed_count,
            r.skipped_count,
            r.correlation_id,
            r.started_at::text AS started_at,
            r.completed_at::text AS completed_at
          FROM profile_install_runs r
          WHERE r.run_id = $1
          LIMIT 1
        `,
        [runId]
      );

      const row = runResult.rows[0];
      if (!row) {
        return null;
      }

      const plansResult = await options.db.query<{
        plan_id: string;
        package_id: string;
        install_order: number;
        status: ProfileInstallRunPlanStatus;
      }>(
        `
          SELECT
            ip.plan_id,
            rp.package_id::text AS package_id,
            rp.install_order,
            rp.status
          FROM profile_install_run_plans rp
          JOIN install_plans ip ON ip.id = rp.plan_internal_id
          WHERE rp.run_internal_id = $1::uuid
          ORDER BY rp.install_order ASC
        `,
        [row.id]
      );

      return {
        run_id: row.run_id,
        profile_id: row.profile_id,
        status: row.status,
        total_packages: row.total_packages,
        succeeded_count: row.succeeded_count,
        failed_count: row.failed_count,
        skipped_count: row.skipped_count,
        correlation_id: row.correlation_id,
        started_at: row.started_at,
        completed_at: row.completed_at,
        plans: plansResult.rows
      } satisfies ProfileInstallRunRecord;
    },

    async addInstallRunPlan(runInternalId, planInternalId, packageId, installOrder) {
      await options.db.query(
        `
          INSERT INTO profile_install_run_plans (
            run_internal_id, plan_internal_id, package_id, install_order, status
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'pending')
          ON CONFLICT (run_internal_id, plan_internal_id) DO UPDATE
          SET
            package_id = EXCLUDED.package_id,
            install_order = EXCLUDED.install_order,
            status = EXCLUDED.status,
            updated_at = now()
        `,
        [runInternalId, planInternalId, packageId, installOrder]
      );
    },

    async addInstallRunPlanByPlanId(runId, planId, packageId, installOrder, status = 'planned') {
      const result = await options.db.query<{ id: string }>(
        `
          INSERT INTO profile_install_run_plans (
            run_internal_id,
            plan_internal_id,
            package_id,
            install_order,
            status
          )
          SELECT
            run_row.id,
            plan_row.id,
            $3::uuid,
            $4,
            $5
          FROM profile_install_runs run_row
          JOIN install_plans plan_row
            ON plan_row.plan_id = $2
          WHERE run_row.run_id = $1
          ON CONFLICT (run_internal_id, plan_internal_id) DO UPDATE
          SET
            package_id = EXCLUDED.package_id,
            install_order = EXCLUDED.install_order,
            status = EXCLUDED.status,
            updated_at = now()
          RETURNING id::text AS id
        `,
        [runId, planId, packageId, installOrder, status]
      );

      if ((result.rowCount ?? result.rows.length) === 0) {
        throw new Error('install_run_or_plan_not_found');
      }
    },

    async updateInstallRunPlanStatus(runInternalId, planInternalId, status) {
      const now = getNow().toISOString();
      await options.db.query(
        `
          UPDATE profile_install_run_plans
          SET status = $1, updated_at = $2::timestamptz
          WHERE run_internal_id = $3::uuid AND plan_internal_id = $4::uuid
        `,
        [status, now, runInternalId, planInternalId]
      );
    },

    async updateInstallRunPlanStatusByPlanId(runId, planId, status) {
      const now = getNow().toISOString();
      const result = await options.db.query<{ run_internal_id: string }>(
        `
          UPDATE profile_install_run_plans run_plans
          SET
            status = $3,
            updated_at = $4::timestamptz
          WHERE run_plans.run_internal_id = (
            SELECT id
            FROM profile_install_runs
            WHERE run_id = $1
            LIMIT 1
          )
            AND run_plans.plan_internal_id = (
              SELECT id
              FROM install_plans
              WHERE plan_id = $2
              LIMIT 1
            )
          RETURNING run_plans.run_internal_id::text AS run_internal_id
        `,
        [runId, planId, status, now]
      );

      if ((result.rowCount ?? result.rows.length) === 0) {
        throw new Error('install_run_plan_not_found');
      }
    },

    async completeInstallRun(runId, status, counts) {
      const now = getNow().toISOString();
      await options.db.query(
        `
          UPDATE profile_install_runs
          SET
            status = $1,
            succeeded_count = $2,
            failed_count = $3,
            skipped_count = $4,
            completed_at = $5::timestamptz,
            updated_at = $5::timestamptz
          WHERE run_id = $6
        `,
        [status, counts.succeeded, counts.failed, counts.skipped, now, runId]
      );

      const runResult = await options.db.query<{ profile_internal_id: string }>(
        `SELECT profile_internal_id::text FROM profile_install_runs WHERE run_id = $1 LIMIT 1`,
        [runId]
      );
      const profileInternalId = runResult.rows[0]?.profile_internal_id;
      if (profileInternalId) {
        await this.appendAudit(profileInternalId, 'install_completed', null, {
          run_id: runId,
          status,
          ...counts
        });
      }
    },

    async appendAudit(profileInternalId, action, actorId, payload) {
      const now = getNow().toISOString();
      await options.db.query(
        `
          INSERT INTO profile_audit (
            profile_internal_id, action, actor_id, payload, occurred_at
          )
          VALUES ($1::uuid, $2, $3, $4::jsonb, $5::timestamptz)
        `,
        [profileInternalId, action, actorId, JSON.stringify(payload), now]
      );
    }
  };
}
