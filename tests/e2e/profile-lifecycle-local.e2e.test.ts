import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryReporterDirectory,
  InMemoryReporterNonceStore,
  InMemorySecurityReportStore
} from '@forge/security-governance';
import type {
  ProfileCreateInput,
  ProfileExportPayload,
  ProfileImportInput,
  ProfileInstallRunPlanStatus,
  ProfileInstallRunRecord,
  ProfileInstallRunStatus,
  ProfileRecord,
  ProfileVisibility
} from '@forge/shared-contracts';
import { createForgeHttpApp } from '../../apps/control-plane/src/http-app.js';
import type { IngestionResult } from '../../apps/control-plane/src/index.js';
import { createProfileRouteService } from '../../apps/control-plane/src/profile-routes.js';
import type {
  ProfilePostgresAdapters,
  ProfileListItem
} from '../../apps/control-plane/src/profile-postgres-adapters.js';

// ---------------------------------------------------------------------------
// In-memory adapters --------------------------------------------------------
// ---------------------------------------------------------------------------

function createInMemoryEventDependencies() {
  const idempotency = new Map<string, { hash: string; response: IngestionResult }>();

  return {
    idempotency: {
      async get(scope: string, idempotencyKey: string) {
        const entry = idempotency.get(`${scope}:${idempotencyKey}`);
        if (!entry) return null;
        return {
          scope,
          idempotency_key: idempotencyKey,
          request_hash: entry.hash,
          response_code: 202,
          response_body: entry.response,
          stored_at: '2026-03-01T12:00:00Z'
        };
      },
      async put(record: {
        scope: string;
        idempotency_key: string;
        request_hash: string;
        response_body: IngestionResult;
      }) {
        idempotency.set(`${record.scope}:${record.idempotency_key}`, {
          hash: record.request_hash,
          response: record.response_body
        });
      }
    },
    persistence: {
      async appendRawEvent() {
        return {
          raw_event_id: '00000000-0000-4000-8000-000000000001',
          persisted_at: '2026-03-01T12:00:00Z'
        };
      }
    }
  };
}

function createInMemoryProfileAdapters(): ProfilePostgresAdapters {
  const profiles = new Map<string, ProfileRecord>();
  const runs = new Map<string, ProfileInstallRunRecord>();

  const now = () => '2026-03-01T12:00:00Z';

  return {
    async createProfile(input: ProfileCreateInput, profileId: string): Promise<ProfileRecord> {
      const record: ProfileRecord = {
        profile_id: profileId,
        name: input.name,
        description: input.description ?? '',
        author_id: input.author_id,
        visibility: input.visibility ?? 'private',
        target_sdk: input.target_sdk ?? 'both',
        tags: input.tags ?? [],
        version: '1.0.0',
        profile_hash: createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16),
        packages: input.packages.map((pkg) => ({
          package_id: pkg.package_id,
          package_slug: pkg.package_slug ?? null,
          version_pinned: pkg.version_pinned ?? null,
          required: pkg.required ?? true,
          install_order: pkg.install_order,
          config_overrides: pkg.config_overrides ?? {}
        })),
        created_at: now(),
        updated_at: now()
      };
      profiles.set(profileId, record);
      return record;
    },

    async getProfile(profileId: string): Promise<ProfileRecord | null> {
      return profiles.get(profileId) ?? null;
    },

    async listProfiles(
      limit: number,
      offset: number,
      filters?: { author_id?: string; visibility?: ProfileVisibility }
    ): Promise<ProfileListItem[]> {
      let items = [...profiles.values()];
      if (filters?.author_id) {
        items = items.filter((p) => p.author_id === filters.author_id);
      }
      if (filters?.visibility) {
        items = items.filter((p) => p.visibility === filters.visibility);
      }
      return items.slice(offset, offset + limit).map((p) => ({
        profile_id: p.profile_id,
        name: p.name,
        author_id: p.author_id,
        visibility: p.visibility,
        target_sdk: p.target_sdk,
        tags: p.tags,
        version: p.version,
        package_count: p.packages.length,
        created_at: p.created_at,
        updated_at: p.updated_at
      }));
    },

    async exportProfile(profileId: string): Promise<ProfileExportPayload | null> {
      const record = profiles.get(profileId);
      if (!record) return null;
      return {
        format_version: '1.0.0',
        profile: {
          profile_id: record.profile_id,
          name: record.name,
          description: record.description,
          author_id: record.author_id,
          visibility: record.visibility,
          target_sdk: record.target_sdk,
          tags: record.tags,
          version: record.version,
          packages: record.packages
        },
        exported_at: now()
      };
    },

    async importProfile(input: ProfileImportInput, profileId: string): Promise<ProfileRecord> {
      const p = input.profile;
      const record: ProfileRecord = {
        profile_id: profileId,
        name: p.name,
        description: p.description ?? '',
        author_id: p.author_id,
        visibility: p.visibility ?? 'private',
        target_sdk: p.target_sdk ?? 'both',
        tags: p.tags ?? [],
        version: p.version ?? '1.0.0',
        profile_hash: createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16),
        packages: p.packages.map((pkg) => ({
          package_id: pkg.package_id,
          package_slug: pkg.package_slug ?? null,
          version_pinned: pkg.version_pinned ?? null,
          required: pkg.required ?? true,
          install_order: pkg.install_order,
          config_overrides: pkg.config_overrides ?? {}
        })),
        created_at: now(),
        updated_at: now()
      };
      profiles.set(profileId, record);
      return record;
    },

    async createInstallRun(
      profileId: string,
      runId: string,
      correlationId: string | null
    ): Promise<ProfileInstallRunRecord> {
      const run: ProfileInstallRunRecord = {
        run_id: runId,
        profile_id: profileId,
        status: 'pending',
        total_packages: 0,
        succeeded_count: 0,
        failed_count: 0,
        skipped_count: 0,
        correlation_id: correlationId,
        started_at: now(),
        completed_at: null,
        plans: []
      };
      runs.set(runId, run);
      return run;
    },

    async getInstallRun(runId: string): Promise<ProfileInstallRunRecord | null> {
      return runs.get(runId) ?? null;
    },

    async addInstallRunPlan(
      _runInternalId: string,
      _planInternalId: string,
      _packageId: string,
      _installOrder: number
    ): Promise<void> {
      // not used in this e2e path
    },

    async addInstallRunPlanByPlanId(
      runId: string,
      planId: string,
      packageId: string,
      installOrder: number,
      status?: ProfileInstallRunPlanStatus
    ): Promise<void> {
      const run = runs.get(runId);
      if (!run) return;
      run.plans.push({
        plan_id: planId,
        package_id: packageId,
        install_order: installOrder,
        status: status ?? 'pending'
      });
      run.total_packages = run.plans.length;
    },

    async updateInstallRunPlanStatus(
      _runInternalId: string,
      _planInternalId: string,
      _status: ProfileInstallRunPlanStatus
    ): Promise<void> {
      // not used in this e2e path
    },

    async updateInstallRunPlanStatusByPlanId(
      runId: string,
      planId: string,
      status: ProfileInstallRunPlanStatus
    ): Promise<void> {
      const run = runs.get(runId);
      if (!run) return;
      const plan = run.plans.find((p) => p.plan_id === planId);
      if (plan) plan.status = status;
    },

    async completeInstallRun(
      runId: string,
      status: ProfileInstallRunStatus,
      counts: { succeeded: number; failed: number; skipped: number }
    ): Promise<void> {
      const run = runs.get(runId);
      if (!run) return;
      run.status = status;
      run.succeeded_count = counts.succeeded;
      run.failed_count = counts.failed;
      run.skipped_count = counts.skipped;
      run.completed_at = now();
    },

    async appendAudit(): Promise<void> {
      // no-op
    }
  };
}

// ---------------------------------------------------------------------------
// Install lifecycle harness  ------------------------------------------------
// ---------------------------------------------------------------------------

function buildLifecycleHarness() {
  let planCounter = 0;
  const planCreateIdempotency = new Map<string, { requestHash: string; planId: string }>();
  const plans = new Map<
    string,
    {
      status: 'planned' | 'apply_succeeded' | 'apply_failed' | 'verify_succeeded' | 'verify_failed';
      attempt_apply: number;
      attempt_verify: number;
      attempt_update: number;
    }
  >();
  const applyIdempotency = new Map<string, true>();
  const verifyIdempotency = new Map<string, true>();
  const updateIdempotency = new Map<string, true>();

  function requestHash(input: { package_id: string; org_id: string }): string {
    return `${input.package_id}|${input.org_id}`;
  }

  return {
    async createPlan(
      input: {
        package_id: string;
        package_slug?: string;
        org_id: string;
        requested_permissions: string[];
      },
      idempotencyKey: string | null
    ) {
      if (!idempotencyKey) throw new Error('idempotency_conflict');

      const hash = requestHash(input);
      const existing = planCreateIdempotency.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== hash) throw new Error('idempotency_conflict');
        return {
          status: 'planned' as const,
          replayed: true,
          plan_id: existing.planId,
          package_id: input.package_id,
          package_slug: input.package_slug ?? 'unknown',
          policy_outcome: 'allowed' as const,
          policy_reason_code: null,
          security_state: 'none',
          action_count: 1
        };
      }

      planCounter++;
      const planId = `plan-profile-e2e-${String(planCounter).padStart(3, '0')}`;
      planCreateIdempotency.set(idempotencyKey, { requestHash: hash, planId });
      plans.set(planId, {
        status: 'planned',
        attempt_apply: 0,
        attempt_verify: 0,
        attempt_update: 0
      });

      return {
        status: 'planned' as const,
        replayed: false,
        plan_id: planId,
        package_id: input.package_id,
        package_slug: input.package_slug ?? 'unknown',
        policy_outcome: 'allowed' as const,
        policy_reason_code: null,
        security_state: 'none',
        action_count: 1
      };
    },

    async getPlan(planId: string) {
      const state = plans.get(planId);
      if (!state) return null;
      return {
        internal_id: `internal-${planId}`,
        plan_id: planId,
        package_id: '11111111-1111-4111-8111-111111111111',
        package_slug: 'acme/addon',
        target_client: 'vscode_copilot' as const,
        target_mode: 'local' as const,
        status: state.status,
        reason_code: null,
        policy_outcome: 'allowed' as const,
        policy_reason_code: null,
        security_state: 'none',
        planner_version: 'planner-v1',
        plan_hash: `hash-${planId}`,
        policy_input: {
          org_id: 'org-e2e',
          package_id: '11111111-1111-4111-8111-111111111111',
          requested_permissions: [],
          org_policy: {
            mcp_enabled: true,
            server_allowlist: [],
            block_flagged: false,
            permission_caps: {
              maxPermissions: 5,
              disallowedPermissions: []
            }
          },
          enforcement: {
            package_id: '11111111-1111-4111-8111-111111111111',
            state: 'none' as const,
            reason_code: null,
            policy_blocked: false,
            source: 'none' as const,
            updated_at: '2026-03-01T12:00:00Z'
          }
        },
        runtime_context: {
          trust_state: 'trusted' as const,
          trust_reset_trigger: 'none' as const,
          mode: 'local' as const,
          transport: 'stdio' as const
        },
        correlation_id: null,
        created_at: '2026-03-01T12:00:00Z',
        updated_at: '2026-03-01T12:00:00Z',
        actions: []
      };
    },

    async applyPlan(planId: string, idempotencyKey: string | null, _correlationId?: string | null) {
      const state = plans.get(planId);
      if (!state) throw new Error('plan_not_found');
      if (!idempotencyKey) throw new Error('idempotency_conflict');

      if (applyIdempotency.has(idempotencyKey)) {
        return {
          status: 'apply_succeeded' as const,
          replayed: true,
          plan_id: planId,
          attempt_number: state.attempt_apply,
          reason_code: null
        };
      }

      state.status = 'apply_succeeded';
      state.attempt_apply += 1;
      applyIdempotency.set(idempotencyKey, true);

      return {
        status: 'apply_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: state.attempt_apply,
        reason_code: null
      };
    },

    async updatePlan(
      planId: string,
      idempotencyKey: string | null,
      _correlationId?: string | null,
      targetVersion?: string | null
    ) {
      const state = plans.get(planId);
      if (!state) throw new Error('plan_not_found');
      if (!idempotencyKey) throw new Error('idempotency_conflict');

      if (updateIdempotency.has(idempotencyKey)) {
        return {
          status: 'update_succeeded' as const,
          replayed: true,
          plan_id: planId,
          attempt_number: state.attempt_update,
          reason_code: null,
          target_version: targetVersion ?? null
        };
      }

      state.status = 'apply_succeeded';
      state.attempt_update += 1;
      updateIdempotency.set(idempotencyKey, true);

      return {
        status: 'update_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: state.attempt_update,
        reason_code: null,
        target_version: targetVersion ?? null
      };
    },

    async verifyPlan(planId: string, idempotencyKey: string | null, _correlationId?: string | null) {
      const state = plans.get(planId);
      if (!state) throw new Error('plan_not_found');
      if (!idempotencyKey) throw new Error('idempotency_conflict');

      if (verifyIdempotency.has(idempotencyKey)) {
        return {
          status: 'verify_succeeded' as const,
          replayed: true,
          plan_id: planId,
          attempt_number: state.attempt_verify,
          readiness: true,
          reason_code: null,
          stages: []
        };
      }

      state.status = 'verify_succeeded';
      state.attempt_verify += 1;
      verifyIdempotency.set(idempotencyKey, true);

      return {
        status: 'verify_succeeded' as const,
        replayed: false,
        plan_id: planId,
        attempt_number: state.attempt_verify,
        readiness: true,
        reason_code: null,
        stages: []
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Test helpers  -------------------------------------------------------------
// ---------------------------------------------------------------------------

const PACKAGE_A = '11111111-1111-4111-8111-111111111111';
const PACKAGE_B = '22222222-2222-4222-8222-222222222222';

function buildApp() {
  const profileAdapters = createInMemoryProfileAdapters();
  const lifecycle = buildLifecycleHarness();

  let idCounter = 0;
  const idFactory = () => {
    idCounter++;
    return `deterministic-id-${String(idCounter).padStart(4, '0')}`;
  };

  const profileRoutes = createProfileRouteService({
    profileAdapters,
    installLifecycle: lifecycle,
    idFactory
  });

  const app = createForgeHttpApp({
    eventIngestion: createInMemoryEventDependencies(),
    securityIngestion: {
      reporters: new InMemoryReporterDirectory({}),
      nonceStore: new InMemoryReporterNonceStore(),
      persistence: new InMemorySecurityReportStore(),
      signatureVerifier: { async verify() { return true; } }
    },
    profileRoutes
  });

  return { app, profileAdapters };
}

// ---------------------------------------------------------------------------
// E2E scenarios  ------------------------------------------------------------
// ---------------------------------------------------------------------------

describe('e2e local: profile lifecycle', () => {
  it('create -> export -> import -> install (plan_only) -> install (apply_verify) -> verify status', async () => {
    const { app } = buildApp();

    // Step 1: Create profile
    const createRes = await app.handle({
      method: 'POST',
      path: '/v1/profiles',
      headers: {},
      body: {
        name: 'E2E Profile',
        description: 'Profile for e2e lifecycle test',
        author_id: 'author-e2e',
        visibility: 'private',
        target_sdk: 'both',
        tags: ['e2e', 'test'],
        packages: [
          { package_id: PACKAGE_A, package_slug: 'acme/addon-a', install_order: 0, required: true },
          { package_id: PACKAGE_B, package_slug: 'acme/addon-b', install_order: 1, required: true }
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const createdProfile = (createRes.body as { profile: ProfileRecord }).profile;
    expect(createdProfile.name).toBe('E2E Profile');
    expect(createdProfile.packages).toHaveLength(2);
    const profileId = createdProfile.profile_id;

    // Step 2: Get profile
    const getRes = await app.handle({
      method: 'GET',
      path: `/v1/profiles/${profileId}`,
      headers: {},
      body: null
    });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.body as { profile: ProfileRecord }).profile.profile_id).toBe(profileId);

    // Step 3: List profiles
    const listRes = await app.handle({
      method: 'GET',
      path: '/v1/profiles',
      headers: {},
      body: null
    });
    expect(listRes.statusCode).toBe(200);
    const listed = (listRes.body as { profiles: ProfileListItem[] }).profiles;
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed.some((p) => p.profile_id === profileId)).toBe(true);

    // Step 4: Export profile
    const exportRes = await app.handle({
      method: 'POST',
      path: `/v1/profiles/${profileId}/export`,
      headers: {},
      body: null
    });
    expect(exportRes.statusCode).toBe(200);
    const exportPayload = (exportRes.body as { export: ProfileExportPayload }).export;
    expect(exportPayload.format_version).toBe('1.0.0');
    expect(exportPayload.profile.name).toBe('E2E Profile');
    expect(exportPayload.profile.packages).toHaveLength(2);

    // Step 5: Import the exported profile
    const importRes = await app.handle({
      method: 'POST',
      path: '/v1/profiles/import',
      headers: {},
      body: {
        format_version: '1.0.0',
        profile: {
          name: 'Imported E2E Profile',
          description: 'Imported from export',
          author_id: 'author-e2e',
          visibility: 'private',
          target_sdk: 'both',
          tags: ['imported'],
          packages: exportPayload.profile.packages.map((pkg) => ({
            package_id: pkg.package_id,
            package_slug: pkg.package_slug,
            install_order: pkg.install_order,
            required: pkg.required
          }))
        }
      }
    });
    expect(importRes.statusCode).toBe(201);
    const importedProfile = (importRes.body as { profile: ProfileRecord }).profile;
    expect(importedProfile.name).toBe('Imported E2E Profile');
    const importedProfileId = importedProfile.profile_id;

    // Step 6: Install profile — plan_only mode
    const planOnlyRes = await app.handle({
      method: 'POST',
      path: `/v1/profiles/${importedProfileId}/install`,
      headers: { 'x-correlation-id': 'corr-e2e-plan-only' },
      body: {
        org_id: 'org-e2e',
        mode: 'plan_only',
        org_policy: {
          mcp_enabled: true,
          server_allowlist: [PACKAGE_A, PACKAGE_B],
          block_flagged: false,
          permission_caps: { maxPermissions: 5, disallowedPermissions: [] }
        }
      }
    });
    expect(planOnlyRes.statusCode).toBe(201);
    const planOnlyBody = planOnlyRes.body as {
      run: ProfileInstallRunRecord;
      plan_results: Array<{ package_id: string; status: string; plan_id: string | null }>;
    };
    expect(planOnlyBody.run.status).toBe('succeeded');
    expect(planOnlyBody.plan_results).toHaveLength(2);
    for (const r of planOnlyBody.plan_results) {
      expect(r.plan_id).toBeTruthy();
      expect(r.status).toBe('planned');
    }

    // Step 7: Retrieve install run
    const runRes = await app.handle({
      method: 'GET',
      path: `/v1/profiles/install-runs/${planOnlyBody.run.run_id}`,
      headers: {},
      body: null
    });
    expect(runRes.statusCode).toBe(200);
    expect((runRes.body as { run: ProfileInstallRunRecord }).run.status).toBe('succeeded');

    // Step 8: Install profile — apply_verify mode (full)
    const fullInstallRes = await app.handle({
      method: 'POST',
      path: `/v1/profiles/${profileId}/install`,
      headers: { 'x-correlation-id': 'corr-e2e-apply-verify' },
      body: {
        org_id: 'org-e2e',
        mode: 'apply_verify',
        org_policy: {
          mcp_enabled: true,
          server_allowlist: [PACKAGE_A, PACKAGE_B],
          block_flagged: false,
          permission_caps: { maxPermissions: 5, disallowedPermissions: [] }
        }
      }
    });
    expect(fullInstallRes.statusCode).toBe(201);
    const fullBody = fullInstallRes.body as {
      run: ProfileInstallRunRecord;
      plan_results: Array<{ package_id: string; status: string; plan_id: string | null }>;
    };
    expect(fullBody.run.status).toBe('succeeded');
    expect(fullBody.plan_results).toHaveLength(2);
    for (const r of fullBody.plan_results) {
      expect(r.plan_id).toBeTruthy();
      expect(r.status).toBe('verified');
    }
  });

  it('returns 404 for missing profile', async () => {
    const { app } = buildApp();
    const res = await app.handle({
      method: 'GET',
      path: '/v1/profiles/nonexistent-id',
      headers: {},
      body: null
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for missing install run', async () => {
    const { app } = buildApp();
    const res = await app.handle({
      method: 'GET',
      path: '/v1/profiles/install-runs/nonexistent-run',
      headers: {},
      body: null
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects invalid profile create input', async () => {
    const { app } = buildApp();
    const res = await app.handle({
      method: 'POST',
      path: '/v1/profiles',
      headers: {},
      body: { name: 123 }
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects invalid import payload', async () => {
    const { app } = buildApp();
    const res = await app.handle({
      method: 'POST',
      path: '/v1/profiles/import',
      headers: {},
      body: { format_version: '2.0.0', profile: {} }
    });
    expect(res.statusCode).toBe(422);
  });

  it('handles install with optional (non-required) packages by skipping them', async () => {
    const { app } = buildApp();

    const createRes = await app.handle({
      method: 'POST',
      path: '/v1/profiles',
      headers: {},
      body: {
        name: 'Mixed Required Profile',
        author_id: 'author-e2e',
        packages: [
          { package_id: PACKAGE_A, install_order: 0, required: true },
          { package_id: PACKAGE_B, install_order: 1, required: false }
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const pid = (createRes.body as { profile: ProfileRecord }).profile.profile_id;

    const installRes = await app.handle({
      method: 'POST',
      path: `/v1/profiles/${pid}/install`,
      headers: { 'x-correlation-id': 'corr-optional-test' },
      body: {
        org_id: 'org-e2e',
        mode: 'apply_verify',
        org_policy: {
          mcp_enabled: true,
          server_allowlist: [PACKAGE_A, PACKAGE_B],
          block_flagged: false,
          permission_caps: { maxPermissions: 5, disallowedPermissions: [] }
        }
      }
    });
    expect(installRes.statusCode).toBe(201);
    const body = installRes.body as {
      run: ProfileInstallRunRecord;
      plan_results: Array<{ package_id: string; status: string }>;
    };
    expect(body.run.status).toBe('succeeded');

    const verifiedResults = body.plan_results.filter((r) => r.status === 'verified');
    const skippedResults = body.plan_results.filter((r) => r.status === 'skipped');
    expect(verifiedResults).toHaveLength(1);
    expect(skippedResults).toHaveLength(1);
    expect(skippedResults[0]?.package_id).toBe(PACKAGE_B);
  });
});
