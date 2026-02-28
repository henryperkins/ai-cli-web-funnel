import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createCatalogIngestService } from '../../packages/catalog/src/index.js';
import { createCatalogPostgresAdapters } from '../../packages/catalog/src/postgres-adapters.js';
import { createCatalogRouteService } from '../../apps/control-plane/src/catalog-routes.js';
import { createCopilotVscodeAdapterContract } from '../../apps/copilot-vscode-adapter/src/index.js';
import {
  createInstallLifecycleService,
  createPostgresInstallOutboxPublisher,
  createPostgresLifecycleIdempotencyAdapter
} from '../../apps/control-plane/src/install-lifecycle.js';
import {
  createIntegrationDbExecutor,
  resetIntegrationTables,
  seedPackage
} from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

describe('integration-db: catalog ingest and install lifecycle persistence', () => {
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

  it('persists catalog ingest output idempotently and queues identity conflicts', async () => {
    const ingestService = createCatalogIngestService();
    const adapters = createCatalogPostgresAdapters({ db });

    const accepted = ingestService.ingest({
      merge_run_id: 'merge-catalog-001',
      occurred_at: '2026-03-01T08:00:00Z',
      source_snapshot: {
        source: 'integration-db'
      },
      candidates: [
        {
          source_name: 'github',
          source_updated_at: '2026-03-01T07:00:00Z',
          github_repo_id: 999,
          github_repo_locator: 'https://github.com/acme/catalog-addon',
          tool_kind: 'mcp',
          package_slug: 'acme/catalog-addon',
          fields: {
            name: 'Catalog Addon',
            description: 'deterministic ingest'
          },
          aliases: [
            {
              alias_type: 'registry_alias',
              alias_value: '@acme/catalog-addon'
            }
          ]
        }
      ]
    });

    await adapters.persistIngestResult(accepted);
    await adapters.persistIngestResult(accepted);

    const ingestedPackageId = accepted.package_candidate?.package_id;
    if (!ingestedPackageId) {
      throw new Error('expected package candidate for accepted ingest');
    }

    const counts = await pool.query<{
      packages: string;
      aliases: string;
      lineage: string;
      merge_runs: string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)::text
            FROM registry.packages
            WHERE id = $1::uuid
          ) AS packages,
          (
            SELECT COUNT(*)::text
            FROM package_aliases
            WHERE package_id = $1::uuid
          ) AS aliases,
          (
            SELECT COUNT(*)::text
            FROM package_field_lineage
            WHERE package_id = $1::uuid
          ) AS lineage,
          (
            SELECT COUNT(*)::text
            FROM package_merge_runs
            WHERE merge_run_id = 'merge-catalog-001'
          ) AS merge_runs
      `,
      [ingestedPackageId]
    );

    expect(counts.rows[0]).toEqual({
      packages: '1',
      aliases: '3',
      lineage: '2',
      merge_runs: '1'
    });

    const manualReview = ingestService.ingest({
      merge_run_id: 'merge-catalog-002',
      occurred_at: '2026-03-01T09:00:00Z',
      candidates: [
        {
          source_name: 'registry',
          source_updated_at: '2026-03-01T09:00:00Z',
          registry_package_locator: 'https://registry.npmjs.org/@acme/unknown-addon',
          tool_kind: 'mcp'
        }
      ]
    });

    await adapters.persistIngestResult(manualReview);

    const conflicts = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM package_identity_conflicts'
    );
    expect(conflicts.rows[0]?.count).toBe('1');
  });

  it('persists reconciliation freshness metadata and exposes package freshness read model', async () => {
    const ingestService = createCatalogIngestService();
    const adapters = createCatalogPostgresAdapters({ db });

    const accepted = ingestService.ingest({
      merge_run_id: 'merge-docs-001',
      occurred_at: '2026-03-01T10:00:00Z',
      source_snapshot: {
        source: 'docs'
      },
      candidates: [
        {
          source_name: 'docs',
          source_updated_at: '2026-03-01T09:50:00Z',
          registry_package_locator: 'https://docs.example.com/acme/docs-addon',
          github_repo_locator: 'https://github.com/acme/docs-addon',
          tool_kind: 'mcp',
          package_slug: 'acme/docs-addon',
          fields: {
            name: 'Docs Addon',
            description: 'from docs',
            lastUpdated: '2026-03-01T09:50:00Z'
          },
          aliases: [
            {
              alias_type: 'url_alias',
              alias_value: 'https://docs.example.com/acme/docs-addon'
            }
          ]
        }
      ]
    });

    await adapters.persistIngestResult(accepted);

    const packageId = accepted.package_candidate?.package_id;
    if (!packageId) {
      throw new Error('expected package candidate package_id');
    }

    await adapters.recordSourceFreshness?.({
      source_name: 'docs',
      status: 'succeeded',
      stale_after_minutes: 1440,
      last_attempt_at: '2026-03-01T10:00:00Z',
      last_success_at: '2026-03-01T10:00:00Z',
      merge_run_id: 'merge-docs-001',
      failure_class: null,
      failure_message: null
    });

    const firstRunWrite = await adapters.recordReconciliationRun?.({
      run_id: 'reconcile-docs-001',
      run_hash: 'hash-docs-001',
      source_name: 'docs',
      mode: 'apply',
      status: 'succeeded',
      attempts: 1,
      merge_run_id: 'merge-docs-001',
      started_at: '2026-03-01T10:00:00Z',
      completed_at: '2026-03-01T10:00:10Z',
      details: {
        source: 'docs'
      }
    });
    const replayRunWrite = await adapters.recordReconciliationRun?.({
      run_id: 'reconcile-docs-001',
      run_hash: 'hash-docs-001',
      source_name: 'docs',
      mode: 'apply',
      status: 'succeeded',
      attempts: 1,
      merge_run_id: 'merge-docs-001',
      started_at: '2026-03-01T10:00:00Z',
      completed_at: '2026-03-01T10:00:10Z',
      details: {
        source: 'docs'
      }
    });

    expect(firstRunWrite?.replayed).toBe(false);
    expect(replayRunWrite?.replayed).toBe(true);

    const sourceFreshness = await adapters.listSourceFreshness?.();
    expect(sourceFreshness).toHaveLength(1);
    expect(sourceFreshness?.[0]).toMatchObject({
      source_name: 'docs',
      status: 'succeeded',
      merge_run_id: 'merge-docs-001'
    });

    const packageFreshness = await adapters.getPackageFreshness?.(packageId);
    expect(packageFreshness?.package_id).toBe(packageId);
    expect(packageFreshness?.last_ingested_at).not.toBeNull();
    expect(packageFreshness?.source_statuses[0]?.source_name).toBe('docs');

    const routes = createCatalogRouteService({ catalog: adapters });
    const detail = await routes.getPackage(packageId);
    const freshnessStatus = await routes.getFreshnessStatus();

    expect(detail?.freshness?.package_id).toBe(packageId);
    expect(freshnessStatus.sources[0]?.source_name).toBe('docs');
  });

  it('persists plan/create/apply/verify lifecycle attempts and supports idempotent replay', async () => {
    const packageId = '7d8c3be9-3366-4aa9-9bc2-a2afeb06df74';
    await seedPackage(pool, packageId);

    const workspace = await mkdtemp(join(tmpdir(), 'forge-lifecycle-intg-'));

    const copilotAdapter = createCopilotVscodeAdapterContract(
      {
        async preflight(input) {
          return {
            outcome: 'allowed',
            install_allowed: true,
            runtime_allowed: true,
            reason_code: null,
            warnings: [],
            policy_blocked: false,
            blocked_by: 'none'
          };
        }
      },
      {
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
          return { healthy: true, details: ['ok'] };
        }
      },
      {},
      {
        workspaceRoot: workspace,
        userProfilePath: join(workspace, 'user-profile.json'),
        daemonDefaultPath: join(workspace, 'daemon-default.json'),
        now: () => new Date('2026-03-01T12:00:00Z')
      }
    );

    let planCounter = 1;
    const lifecycle = createInstallLifecycleService({
      db,
      copilotAdapter,
      runtimeVerifier: {
        async run(request) {
          return {
            ready: true,
            failure_reason_code: null,
            final_trust_state: 'trusted',
            policy: {
              outcome: 'allowed',
              install_allowed: true,
              runtime_allowed: true,
              reason_code: null,
              warnings: [],
              policy_blocked: false,
              blocked_by: 'none'
            },
            scope_resolution: {
              ordered_writable_scopes: request.scope_candidates,
              blocked_scopes: []
            },
            stages: [
              {
                stage: 'policy_preflight',
                ok: true,
                details: ['allowed']
              },
              {
                stage: 'trust_gate',
                ok: true,
                details: ['trust_state=trusted']
              },
              {
                stage: 'preflight_checks',
                ok: true,
                details: ['ok']
              },
              {
                stage: 'start_or_connect',
                ok: true,
                details: ['ok']
              },
              {
                stage: 'health_validate',
                ok: true,
                details: ['ok']
              },
              {
                stage: 'supervise',
                ok: true,
                details: ['ok']
              }
            ]
          };
        },
        async writeScopeSidecarGuarded() {
          return {
            ok: true,
            reason_code: null
          };
        }
      },
      idempotency: createPostgresLifecycleIdempotencyAdapter({ db }),
      outboxPublisher: createPostgresInstallOutboxPublisher({ db }),
      now: () => new Date('2026-03-01T12:00:00Z'),
      idFactory: () => `plan-intg-${String(planCounter++).padStart(3, '0')}`
    });

    const createInput = {
      package_id: packageId,
      org_id: 'org-intg-1',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [packageId],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 5,
          disallowedPermissions: []
        }
      }
    };

    const created = await lifecycle.createPlan(createInput, 'plan-idem-1');
    expect(created).toMatchObject({
      status: 'planned',
      replayed: false,
      plan_id: 'plan-intg-001'
    });

    const replayed = await lifecycle.createPlan(createInput, 'plan-idem-1');
    expect(replayed).toMatchObject({
      status: 'planned',
      replayed: true,
      plan_id: 'plan-intg-001'
    });

    await expect(
      lifecycle.createPlan(
        {
          ...createInput,
          requested_permissions: ['read:config', 'write:settings']
        },
        'plan-idem-1'
      )
    ).rejects.toThrow('idempotency_conflict');

    const secondCreated = await lifecycle.createPlan(createInput, 'plan-idem-2');
    expect(secondCreated).toMatchObject({
      status: 'planned',
      replayed: false,
      plan_id: 'plan-intg-002'
    });

    const plan = await lifecycle.getPlan('plan-intg-001');
    const secondPlan = await lifecycle.getPlan('plan-intg-002');
    expect(plan?.actions.length).toBeGreaterThan(0);
    expect(secondPlan?.actions).toEqual(plan?.actions);

    const apply = await lifecycle.applyPlan('plan-intg-001', 'apply-idem-1', 'corr-intg-1');
    expect(apply).toMatchObject({
      status: 'apply_succeeded',
      replayed: false,
      attempt_number: 1
    });

    const verify = await lifecycle.verifyPlan('plan-intg-001', 'verify-idem-1', 'corr-intg-1');
    expect(verify).toMatchObject({
      status: 'verify_succeeded',
      readiness: true,
      replayed: false,
      attempt_number: 1
    });

    const lifecycleCounts = await pool.query<{
      plan_status: string;
      action_count: string;
      audit_count: string;
      apply_attempts: string;
      verify_attempts: string;
      outbox_count: string;
    }>(
      `
        SELECT
          (SELECT status FROM install_plans WHERE plan_id = 'plan-intg-001') AS plan_status,
          (SELECT COUNT(*)::text FROM install_plan_actions) AS action_count,
          (SELECT COUNT(*)::text FROM install_plan_audit) AS audit_count,
          (SELECT COUNT(*)::text FROM install_apply_attempts) AS apply_attempts,
          (SELECT COUNT(*)::text FROM install_verify_attempts) AS verify_attempts,
          (
            SELECT COUNT(*)::text
            FROM ingestion_outbox
            WHERE event_type IN (
              'install.plan.created',
              'install.apply.succeeded',
              'install.verify.succeeded'
            )
          ) AS outbox_count
      `
    );

    expect(lifecycleCounts.rows[0]).toEqual({
      plan_status: 'verify_succeeded',
      action_count: '6',
      audit_count: '4',
      apply_attempts: '1',
      verify_attempts: '1',
      outbox_count: '4'
    });

    await rm(workspace, { recursive: true, force: true });
  });

  it('persists remove/rollback transitions with audit + outbox continuity', async () => {
    const packageId = '8f0d6b7e-884f-4c8f-871e-aabbccddeeff';
    await seedPackage(pool, packageId);

    const workspace = await mkdtemp(join(tmpdir(), 'forge-lifecycle-remove-rb-intg-'));
    const copilotAdapter = createCopilotVscodeAdapterContract(
      {
        async preflight() {
          return {
            outcome: 'allowed',
            install_allowed: true,
            runtime_allowed: true,
            reason_code: null,
            warnings: [],
            policy_blocked: false,
            blocked_by: 'none'
          };
        }
      },
      {
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
          return { healthy: true, details: ['ok'] };
        }
      },
      {},
      {
        workspaceRoot: workspace,
        userProfilePath: join(workspace, 'user-profile.json'),
        daemonDefaultPath: join(workspace, 'daemon-default.json'),
        now: () => new Date('2026-03-01T15:00:00Z')
      }
    );

    let planCounter = 1;
    const lifecycle = createInstallLifecycleService({
      db,
      copilotAdapter,
      runtimeVerifier: {
        async run(request) {
          return {
            ready: true,
            failure_reason_code: null,
            final_trust_state: 'trusted',
            policy: {
              outcome: 'allowed',
              install_allowed: true,
              runtime_allowed: true,
              reason_code: null,
              warnings: [],
              policy_blocked: false,
              blocked_by: 'none'
            },
            scope_resolution: {
              ordered_writable_scopes: request.scope_candidates,
              blocked_scopes: []
            },
            stages: []
          };
        },
        async writeScopeSidecarGuarded() {
          return {
            ok: true,
            reason_code: null
          };
        }
      },
      idempotency: createPostgresLifecycleIdempotencyAdapter({ db }),
      outboxPublisher: createPostgresInstallOutboxPublisher({ db }),
      now: () => new Date('2026-03-01T15:00:00Z'),
      idFactory: () => `plan-rmrb-${String(planCounter++).padStart(3, '0')}`
    });

    const createInput = {
      package_id: packageId,
      org_id: 'org-rmrb',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [packageId],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 5,
          disallowedPermissions: []
        }
      }
    };

    const planRemove = await lifecycle.createPlan(createInput, 'rm-create-1');
    await lifecycle.applyPlan(planRemove.plan_id, 'rm-apply-1', 'corr-rm-1');

    const removed = await lifecycle.removePlan(planRemove.plan_id, 'rm-remove-1', 'corr-rm-1');
    expect(removed).toMatchObject({
      status: 'remove_succeeded',
      replayed: false
    });

    const removedReplay = await lifecycle.removePlan(planRemove.plan_id, 'rm-remove-1', 'corr-rm-1');
    expect(removedReplay).toMatchObject({
      status: 'remove_succeeded',
      replayed: true
    });

    const planRollback = await lifecycle.createPlan(createInput, 'rb-create-1');
    await lifecycle.applyPlan(planRollback.plan_id, 'rb-apply-1', 'corr-rb-1');

    const planRollbackLoaded = await lifecycle.getPlan(planRollback.plan_id);
    if (!planRollbackLoaded) {
      throw new Error('expected rollback plan to exist');
    }

    await pool.query(
      `
        INSERT INTO install_apply_attempts (
          plan_internal_id,
          attempt_number,
          status,
          reason_code,
          details,
          started_at,
          completed_at
        )
        VALUES (
          $1::uuid,
          2,
          'failed',
          'adapter_remove_failed',
          $2::jsonb,
          '2026-03-01T15:00:00Z'::timestamptz,
          '2026-03-01T15:00:00Z'::timestamptz
        )
      `,
      [
        planRollbackLoaded.internal_id,
        JSON.stringify({
          operation: 'remove',
          correlation_id: 'corr-rb-seed'
        })
      ]
    );

    await pool.query(
      `
        UPDATE install_plans
        SET
          status = 'remove_failed',
          reason_code = 'adapter_remove_failed'
        WHERE id = $1::uuid
      `,
      [planRollbackLoaded.internal_id]
    );

    const rolledBack = await lifecycle.rollbackPlan(planRollback.plan_id, 'rb-rollback-1', 'corr-rb-1');
    expect(rolledBack).toMatchObject({
      status: 'rollback_succeeded',
      replayed: false,
      rollback_mode: 'restore_removed_entries',
      source_operation: 'remove'
    });

    const counts = await pool.query<{
      remove_attempts: string;
      rollback_attempts: string;
      remove_audit: string;
      rollback_audit: string;
      outbox_remove_success: string;
      outbox_rollback_success: string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)::text
            FROM install_apply_attempts
            WHERE details->>'operation' = 'remove'
          ) AS remove_attempts,
          (
            SELECT COUNT(*)::text
            FROM install_apply_attempts
            WHERE details->>'operation' = 'rollback'
          ) AS rollback_attempts,
          (
            SELECT COUNT(*)::text
            FROM install_plan_audit
            WHERE stage = 'remove'
          ) AS remove_audit,
          (
            SELECT COUNT(*)::text
            FROM install_plan_audit
            WHERE stage = 'rollback'
          ) AS rollback_audit,
          (
            SELECT COUNT(*)::text
            FROM ingestion_outbox
            WHERE event_type = 'install.remove.succeeded'
          ) AS outbox_remove_success,
          (
            SELECT COUNT(*)::text
            FROM ingestion_outbox
            WHERE event_type = 'install.rollback.succeeded'
          ) AS outbox_rollback_success
      `
    );

    expect(counts.rows[0]).toEqual({
      remove_attempts: '2',
      rollback_attempts: '1',
      remove_audit: '1',
      rollback_audit: '1',
      outbox_remove_success: '1',
      outbox_rollback_success: '1'
    });

    await rm(workspace, { recursive: true, force: true });
  });
});
