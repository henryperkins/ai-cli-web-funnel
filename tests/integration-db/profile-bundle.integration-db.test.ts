import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createCopilotVscodeAdapterContract } from '../../apps/copilot-vscode-adapter/src/index.js';
import {
  createInstallLifecycleService,
  createPostgresInstallOutboxPublisher,
  createPostgresLifecycleIdempotencyAdapter
} from '../../apps/control-plane/src/install-lifecycle.js';
import {
  createProfilePostgresAdapters
} from '../../apps/control-plane/src/profile-postgres-adapters.js';
import {
  createProfileRouteService
} from '../../apps/control-plane/src/profile-routes.js';
import {
  createIntegrationDbExecutor,
  resetIntegrationTables,
  seedPackage
} from './helpers/postgres.js';

const databaseUrl = process.env.FORGE_INTEGRATION_DB_URL;
if (!databaseUrl) {
  throw new Error('FORGE_INTEGRATION_DB_URL is required for integration-db tests.');
}

describe('integration-db: profile bundle create, export/import, and install lifecycle', () => {
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const db = createIntegrationDbExecutor(pool);

  const PKG_A = '00000000-0000-4000-a000-000000000a01';
  const PKG_B = '00000000-0000-4000-a000-000000000b02';

  let idCounter = 0;
  const idFactory = () => {
    idCounter++;
    const hex = idCounter.toString(16).padStart(12, '0');
    return `aaaaaaaa-bbbb-4ccc-8ddd-${hex}`;
  };

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  beforeEach(async () => {
    idCounter = 0;
    await resetIntegrationTables(pool);
    await seedPackage(pool, PKG_A);
    await seedPackage(pool, PKG_B);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a profile with packages, retrieves it, and lists it', async () => {
    const profileAdapters = createProfilePostgresAdapters({ db, idFactory });

    const service = createProfileRouteService({
      profileAdapters,
      idFactory
    });

    const createResult = await service.createProfile({
      name: 'My Dev Bundle',
      description: 'A curated bundle for React devs',
      author_id: 'user-001',
      visibility: 'public',
      target_sdk: 'both',
      tags: ['react', 'typescript'],
      packages: [
        {
          package_id: PKG_A,
          package_slug: 'seed/pkg-a',
          install_order: 0,
          required: true
        },
        {
          package_id: PKG_B,
          package_slug: 'seed/pkg-b',
          version_pinned: '2.0.0',
          install_order: 1,
          required: false,
          config_overrides: { theme: 'dark' }
        }
      ]
    });

    expect(createResult.profile.name).toBe('My Dev Bundle');
    expect(createResult.profile.author_id).toBe('user-001');
    expect(createResult.profile.visibility).toBe('public');
    expect(createResult.profile.target_sdk).toBe('both');
    expect(createResult.profile.tags).toEqual(['react', 'typescript']);
    expect(createResult.profile.packages).toHaveLength(2);
    expect(createResult.profile.packages[0]?.package_id).toBe(PKG_A);
    expect(createResult.profile.packages[0]?.install_order).toBe(0);
    expect(createResult.profile.packages[1]?.package_id).toBe(PKG_B);
    expect(createResult.profile.packages[1]?.version_pinned).toBe('2.0.0');
    expect(createResult.profile.packages[1]?.config_overrides).toEqual({ theme: 'dark' });

    // Verify it persisted to the DB
    const profileCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM profiles WHERE name = 'My Dev Bundle'`
    );
    expect(profileCount.rows[0]?.count).toBe(1);

    const packageCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM profile_packages`
    );
    expect(packageCount.rows[0]?.count).toBe(2);

    // Retrieve by ID
    const getResult = await service.getProfile(createResult.profile.profile_id);
    expect(getResult.profile).not.toBeNull();
    expect(getResult.profile!.name).toBe('My Dev Bundle');
    expect(getResult.profile!.packages).toHaveLength(2);

    // List
    const listResult = await service.listProfiles();
    expect(listResult.profiles).toHaveLength(1);
    expect(listResult.profiles[0]?.name).toBe('My Dev Bundle');
    expect(listResult.profiles[0]?.package_count).toBe(2);

    // Audit trail
    const auditCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM profile_audit WHERE action = 'created'`
    );
    expect(auditCount.rows[0]?.count).toBe(1);
  });

  it('exports and imports a profile with round-trip fidelity', async () => {
    const profileAdapters = createProfilePostgresAdapters({ db, idFactory });

    const service = createProfileRouteService({
      profileAdapters,
      idFactory
    });

    // Create the source profile
    const created = await service.createProfile({
      name: 'Export Test Bundle',
      description: 'Bundle for export test',
      author_id: 'user-export',
      visibility: 'public',
      target_sdk: 'claude_code',
      tags: ['export', 'test'],
      packages: [
        {
          package_id: PKG_A,
          install_order: 0,
          required: true
        }
      ]
    });

    // Export
    const exportResult = await service.exportProfile(created.profile.profile_id);
    expect(exportResult.export).not.toBeNull();
    expect(exportResult.export!.format_version).toBe('1.0.0');
    expect(exportResult.export!.profile.name).toBe('Export Test Bundle');
    expect(exportResult.export!.profile.packages).toHaveLength(1);
    expect(exportResult.export!.exported_at).toBeTruthy();

    // Import into a new profile
    const importResult = await service.importProfile({
      format_version: '1.0.0',
      profile: {
        name: exportResult.export!.profile.name,
        description: exportResult.export!.profile.description,
        author_id: exportResult.export!.profile.author_id,
        visibility: exportResult.export!.profile.visibility,
        target_sdk: exportResult.export!.profile.target_sdk,
        tags: exportResult.export!.profile.tags,
        packages: exportResult.export!.profile.packages.map((p) => ({
          package_id: p.package_id,
          package_slug: p.package_slug,
          version_pinned: p.version_pinned,
          required: p.required,
          install_order: p.install_order,
          config_overrides: p.config_overrides
        }))
      }
    });

    expect(importResult.profile.name).toBe('Export Test Bundle');
    expect(importResult.profile.profile_id).not.toBe(created.profile.profile_id);
    expect(importResult.profile.packages).toHaveLength(1);

    // Verify both profiles exist
    const profileCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM profiles`
    );
    expect(profileCount.rows[0]?.count).toBe(2);

    // Verify import audit
    const importAuditCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM profile_audit WHERE action = 'imported'`
    );
    expect(importAuditCount.rows[0]?.count).toBe(1);
  });

  it('creates an install run for a profile, wiring to the install lifecycle', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'forge-profile-install-'));

    try {
      const profileAdapters = createProfilePostgresAdapters({ db, idFactory });

      const copilotAdapter = createCopilotVscodeAdapterContract(
        {
          async preflight() {
            return {
              outcome: 'allowed' as const,
              install_allowed: true,
              runtime_allowed: true,
              reason_code: null,
              warnings: [],
              policy_blocked: false,
              blocked_by: 'none' as const
            };
          }
        },
        {
          async on_before_write() { return; },
          async on_after_write() { return; },
          async on_lifecycle() { return; },
          async on_health_check() { return { healthy: true, details: ['ok'] }; }
        },
        {},
        {
          workspaceRoot: tmpDir,
          userProfilePath: join(tmpDir, 'user-profile.json'),
          daemonDefaultPath: join(tmpDir, 'daemon-default.json'),
          now: () => new Date('2026-06-01T12:00:00Z')
        }
      );

      const installLifecycle = createInstallLifecycleService({
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
                { stage: 'policy_preflight', ok: true, details: ['allowed'] },
                { stage: 'trust_gate', ok: true, details: ['trusted'] },
                { stage: 'preflight_checks', ok: true, details: ['ok'] },
                { stage: 'start_or_connect', ok: true, details: ['ok'] },
                { stage: 'health_validate', ok: true, details: ['ok'] },
                { stage: 'supervise', ok: true, details: ['ok'] }
              ]
            };
          },
          async writeScopeSidecarGuarded() {
            return { ok: true, reason_code: null };
          }
        },
        idempotency: createPostgresLifecycleIdempotencyAdapter({ db }),
        outboxPublisher: createPostgresInstallOutboxPublisher({ db }),
        idFactory
      });

      const service = createProfileRouteService({
        profileAdapters,
        installLifecycle,
        idFactory
      });

      // Create a profile with 2 required packages
      const created = await service.createProfile({
        name: 'Install Test Bundle',
        author_id: 'user-installer',
        packages: [
          { package_id: PKG_A, package_slug: `seed/${PKG_A}`, install_order: 0, required: true },
          { package_id: PKG_B, package_slug: `seed/${PKG_B}`, install_order: 1, required: true }
        ]
      });

      // Install the profile
      const installResult = await service.installProfile(
        created.profile.profile_id,
        {
          org_id: 'org-test-001',
          org_policy: {
            mcp_enabled: true,
            server_allowlist: [],
            block_flagged: false,
            permission_caps: {
              maxPermissions: 10,
              disallowedPermissions: []
            }
          },
          correlation_id: 'corr-profile-install-001'
        }
      );

      // Verify the run was created
      expect(installResult.run).not.toBeNull();
      expect(installResult.plan_results).toHaveLength(2);
      expect(installResult.plan_results[0]?.status).toBe('planned');
      expect(installResult.plan_results[0]?.plan_id).toBeTruthy();
      expect(installResult.plan_results[1]?.status).toBe('planned');
      expect(installResult.plan_results[1]?.plan_id).toBeTruthy();

      // Verify install plans were created in the DB
      const planCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM install_plans`
      );
      expect(planCount.rows[0]?.count).toBe(2);

      // Verify profile install run was recorded
      const runCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM profile_install_runs`
      );
      expect(runCount.rows[0]?.count).toBe(1);

      // Verify audit trail has install_started and install_completed
      const auditResult = await pool.query<{ action: string }>(
        `SELECT action FROM profile_audit WHERE action IN ('install_started', 'install_completed') ORDER BY occurred_at`
      );
      expect(auditResult.rows).toHaveLength(2);
      expect(auditResult.rows[0]?.action).toBe('install_started');
      expect(auditResult.rows[1]?.action).toBe('install_completed');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles profile install with optional packages (skipped)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'forge-profile-skip-'));

    try {
      const profileAdapters = createProfilePostgresAdapters({ db, idFactory });

      const copilotAdapter = createCopilotVscodeAdapterContract(
        {
          async preflight() {
            return {
              outcome: 'allowed' as const,
              install_allowed: true,
              runtime_allowed: true,
              reason_code: null,
              warnings: [],
              policy_blocked: false,
              blocked_by: 'none' as const
            };
          }
        },
        {
          async on_before_write() { return; },
          async on_after_write() { return; },
          async on_lifecycle() { return; },
          async on_health_check() { return { healthy: true, details: ['ok'] }; }
        },
        {},
        {
          workspaceRoot: tmpDir,
          userProfilePath: join(tmpDir, 'user-profile.json'),
          daemonDefaultPath: join(tmpDir, 'daemon-default.json'),
          now: () => new Date('2026-06-01T12:00:00Z')
        }
      );

      const installLifecycle = createInstallLifecycleService({
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
                { stage: 'policy_preflight', ok: true, details: ['allowed'] },
                { stage: 'trust_gate', ok: true, details: ['trusted'] },
                { stage: 'preflight_checks', ok: true, details: ['ok'] },
                { stage: 'start_or_connect', ok: true, details: ['ok'] },
                { stage: 'health_validate', ok: true, details: ['ok'] },
                { stage: 'supervise', ok: true, details: ['ok'] }
              ]
            };
          },
          async writeScopeSidecarGuarded() {
            return { ok: true, reason_code: null };
          }
        },
        idempotency: createPostgresLifecycleIdempotencyAdapter({ db }),
        outboxPublisher: createPostgresInstallOutboxPublisher({ db }),
        idFactory
      });

      const service = createProfileRouteService({
        profileAdapters,
        installLifecycle,
        idFactory
      });

      // Create profile: one required, one optional
      const created = await service.createProfile({
        name: 'Skip Test Bundle',
        author_id: 'user-skipper',
        packages: [
          { package_id: PKG_A, install_order: 0, required: true },
          { package_id: PKG_B, install_order: 1, required: false }
        ]
      });

      const installResult = await service.installProfile(
        created.profile.profile_id,
        {
          org_id: 'org-skip-001',
          org_policy: {
            mcp_enabled: true,
            server_allowlist: [],
            block_flagged: false,
            permission_caps: { maxPermissions: 10, disallowedPermissions: [] }
          }
        }
      );

      expect(installResult.plan_results).toHaveLength(2);
      expect(installResult.plan_results[0]?.status).toBe('planned');
      expect(installResult.plan_results[1]?.status).toBe('skipped');

      // Only 1 install plan should have been created
      const planCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM install_plans`
      );
      expect(planCount.rows[0]?.count).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns null for a non-existent profile', async () => {
    const profileAdapters = createProfilePostgresAdapters({ db, idFactory });
    const service = createProfileRouteService({ profileAdapters, idFactory });

    const result = await service.getProfile('nonexistent-profile-id');
    expect(result.profile).toBeNull();
  });

  it('filters profiles by author_id and visibility', async () => {
    const profileAdapters = createProfilePostgresAdapters({ db, idFactory });
    const service = createProfileRouteService({ profileAdapters, idFactory });

    await service.createProfile({
      name: 'Public Bundle',
      author_id: 'user-public',
      visibility: 'public',
      packages: [{ package_id: PKG_A, install_order: 0 }]
    });

    await service.createProfile({
      name: 'Private Bundle',
      author_id: 'user-private',
      visibility: 'private',
      packages: [{ package_id: PKG_B, install_order: 0 }]
    });

    const publicOnly = await service.listProfiles({ visibility: 'public' });
    expect(publicOnly.profiles).toHaveLength(1);
    expect(publicOnly.profiles[0]?.name).toBe('Public Bundle');

    const byAuthor = await service.listProfiles({ author_id: 'user-private' });
    expect(byAuthor.profiles).toHaveLength(1);
    expect(byAuthor.profiles[0]?.name).toBe('Private Bundle');

    const all = await service.listProfiles();
    expect(all.profiles).toHaveLength(2);
  });
});
