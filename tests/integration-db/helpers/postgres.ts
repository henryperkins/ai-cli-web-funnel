import { Pool } from 'pg';

export interface IntegrationPostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
  withTransaction?<T>(
    callback: (
      tx: Pick<IntegrationPostgresQueryExecutor, 'query'>
    ) => Promise<T>
  ): Promise<T>;
}

export function createIntegrationDbExecutor(
  pool: Pool
): IntegrationPostgresQueryExecutor {
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = []
    ) {
      const result = await pool.query(sql, params);
      return {
        rows: result.rows as Row[],
        rowCount: result.rowCount
      };
    },
    async withTransaction<T>(
      callback: (
        tx: Pick<IntegrationPostgresQueryExecutor, 'query'>
      ) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const tx = {
          async query<Row = Record<string, unknown>>(
            sql: string,
            params: readonly unknown[] = []
          ) {
            const result = await client.query(sql, params);
            return {
              rows: result.rows as Row[],
              rowCount: result.rowCount
            };
          }
        } satisfies Pick<IntegrationPostgresQueryExecutor, 'query'>;

        const output = await callback(tx);
        await client.query('COMMIT');
        return output;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export async function resetIntegrationTables(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      event_flags,
      raw_events,
      ingestion_idempotency_records,
      ingestion_outbox,
      security_report_nonces,
      security_reports,
      security_enforcement_actions,
      security_enforcement_projections,
      security_appeals,
      security_enforcement_promotion_decisions,
      outbox_internal_dispatch_runs,
      outbox_internal_dispatch_effects,
      outbox_dead_letter_replay_audit,
      retrieval_sync_documents,
      install_verify_attempts,
      install_apply_attempts,
      install_plan_audit,
      install_plan_actions,
      install_plans,
      profile_audit,
      profile_install_run_plans,
      profile_install_runs,
      profile_packages,
      profiles,
      catalog_reconciliation_runs,
      catalog_source_freshness,
      operational_slo_snapshots,
      operational_slo_rollup_runs
    RESTART IDENTITY CASCADE
  `);

  await pool.query(`
    INSERT INTO security_enforcement_rollout_state (
      singleton_key,
      current_mode,
      freeze_active,
      freeze_reason,
      decision_run_id,
      decision_evidence,
      updated_at
    )
    VALUES (
      TRUE,
      'raw-only',
      TRUE,
      'integration_reset',
      'integration-reset',
      '{"source":"tests.integration-db.reset"}'::jsonb,
      now()
    )
    ON CONFLICT (singleton_key) DO UPDATE
    SET
      current_mode = EXCLUDED.current_mode,
      freeze_active = EXCLUDED.freeze_active,
      freeze_reason = EXCLUDED.freeze_reason,
      decision_run_id = EXCLUDED.decision_run_id,
      decision_evidence = EXCLUDED.decision_evidence,
      updated_at = EXCLUDED.updated_at
  `);
}

export async function seedPackage(pool: Pool, packageId: string): Promise<void> {
  await pool.query(
    `
      INSERT INTO registry.packages (
        id,
        package_id,
        package_slug
      )
      VALUES ($1::uuid, $1::uuid, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [packageId, `seed/${packageId}`]
  );
}

export async function seedReporter(
  pool: Pool,
  reporterId: string,
  tier: 'A' | 'B' | 'C' = 'A'
): Promise<void> {
  await pool.query(
    `
      INSERT INTO security_reporters (
        reporter_id,
        tier,
        status
      )
      VALUES ($1, $2::reporter_tier, 'active')
      ON CONFLICT (reporter_id) DO UPDATE
      SET
        tier = EXCLUDED.tier,
        status = 'active',
        updated_at = now()
    `,
    [reporterId, tier]
  );
}
