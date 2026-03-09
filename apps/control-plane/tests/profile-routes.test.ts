import { describe, expect, it, vi } from 'vitest';
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
import { createProfileRouteService } from '../src/profile-routes.js';
import type { ProfileListItem, ProfilePostgresAdapters } from '../src/profile-postgres-adapters.js';

const BASE_PROFILE: ProfileRecord = {
  profile_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Dev Setup',
  description: 'Profile under test',
  author_id: 'author-1',
  visibility: 'private',
  target_sdk: 'codex',
  tags: ['dev'],
  version: '1.0.0',
  profile_hash: 'hash-1',
  packages: [
    {
      package_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      package_slug: 'acme/forge-addon',
      version_pinned: null,
      required: true,
      install_order: 0,
      config_overrides: {}
    }
  ],
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z'
};

function createInMemoryProfileAdapters(profile: ProfileRecord): ProfilePostgresAdapters {
  const runs = new Map<string, ProfileInstallRunRecord>();

  return {
    async createProfile(_input: ProfileCreateInput): Promise<ProfileRecord> {
      return profile;
    },
    async getProfile(profileId: string): Promise<ProfileRecord | null> {
      return profileId === profile.profile_id ? profile : null;
    },
    async listProfiles(
      _limit: number,
      _offset: number,
      _filters?: { author_id?: string; visibility?: ProfileVisibility }
    ): Promise<ProfileListItem[]> {
      return [];
    },
    async exportProfile(): Promise<ProfileExportPayload | null> {
      return null;
    },
    async importProfile(_input: ProfileImportInput): Promise<ProfileRecord> {
      return profile;
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
        started_at: '2026-03-01T00:00:00Z',
        completed_at: null,
        plans: []
      };
      runs.set(runId, run);
      return run;
    },
    async getInstallRun(runId: string): Promise<ProfileInstallRunRecord | null> {
      return runs.get(runId) ?? null;
    },
    async addInstallRunPlan(): Promise<void> {
      // legacy helper is not used by createProfileRouteService
    },
    async addInstallRunPlanByPlanId(
      runId: string,
      planId: string,
      packageId: string,
      installOrder: number,
      status?: ProfileInstallRunPlanStatus
    ): Promise<void> {
      const run = runs.get(runId);
      if (!run) {
        return;
      }

      run.plans.push({
        plan_id: planId,
        package_id: packageId,
        install_order: installOrder,
        status: status ?? 'pending'
      });
      run.total_packages = run.plans.length;
    },
    async updateInstallRunPlanStatus(): Promise<void> {
      // legacy helper is not used by createProfileRouteService
    },
    async updateInstallRunPlanStatusByPlanId(
      runId: string,
      planId: string,
      status: ProfileInstallRunPlanStatus
    ): Promise<void> {
      const run = runs.get(runId);
      const plan = run?.plans.find((entry) => entry.plan_id === planId);
      if (plan) {
        plan.status = status;
      }
    },
    async completeInstallRun(
      runId: string,
      status: ProfileInstallRunStatus,
      counts: { succeeded: number; failed: number; skipped: number }
    ): Promise<void> {
      const run = runs.get(runId);
      if (!run) {
        return;
      }

      run.status = status;
      run.succeeded_count = counts.succeeded;
      run.failed_count = counts.failed;
      run.skipped_count = counts.skipped;
      run.completed_at = '2026-03-01T00:05:00Z';
    }
  };
}

describe('profile route service install orchestration', () => {
  it('passes catalog-declared permissions into plan creation', async () => {
    const createPlan = vi.fn(async (input: { package_id: string; requested_permissions: string[] }) => ({
      status: 'planned' as const,
      replayed: false,
      plan_id: 'plan-1',
      package_id: input.package_id,
      package_slug: 'acme/forge-addon',
      policy_outcome: 'allowed' as const,
      policy_reason_code: null,
      security_state: 'none',
      action_count: 1
    }));

    const service = createProfileRouteService({
      profileAdapters: createInMemoryProfileAdapters(BASE_PROFILE),
      installLifecycle: {
        createPlan,
        async getPlan() {
          return null;
        },
        async applyPlan() {
          throw new Error('not_used');
        },
        async updatePlan() {
          throw new Error('not_used');
        },
        async removePlan() {
          throw new Error('not_used');
        },
        async rollbackPlan() {
          throw new Error('not_used');
        },
        async verifyPlan() {
          throw new Error('not_used');
        }
      },
      catalogAdapters: {
        async getPackage() {
          return {
            package_id: BASE_PROFILE.packages[0]!.package_id,
            package_slug: 'acme/forge-addon',
            canonical_repo: 'github.com/acme/forge-addon',
            updated_at: '2026-03-01T00:00:00Z',
            aliases: [],
            lineage_summary: [],
            declared_permissions: ['read:config', 'write:settings']
          };
        }
      },
      idFactory: () => 'run-1'
    });

    const result = await service.installProfile(BASE_PROFILE.profile_id, {
      org_id: 'org-1',
      mode: 'plan_only',
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [BASE_PROFILE.packages[0]!.package_id],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 5,
          disallowedPermissions: []
        }
      }
    });

    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: BASE_PROFILE.packages[0]!.package_id,
        requested_permissions: ['read:config', 'write:settings']
      }),
      expect.any(String)
    );
    expect(result.run?.status).toBe('succeeded');
    expect(result.plan_results).toEqual([
      {
        package_id: BASE_PROFILE.packages[0]!.package_id,
        install_order: 0,
        plan_id: 'plan-1',
        status: 'planned'
      }
    ]);
  });

  it('fails closed when catalog permissions are missing', async () => {
    const createPlan = vi.fn();

    const service = createProfileRouteService({
      profileAdapters: createInMemoryProfileAdapters(BASE_PROFILE),
      installLifecycle: {
        createPlan,
        async getPlan() {
          return null;
        },
        async applyPlan() {
          throw new Error('not_used');
        },
        async updatePlan() {
          throw new Error('not_used');
        },
        async removePlan() {
          throw new Error('not_used');
        },
        async rollbackPlan() {
          throw new Error('not_used');
        },
        async verifyPlan() {
          throw new Error('not_used');
        }
      },
      catalogAdapters: {
        async getPackage() {
          return {
            package_id: BASE_PROFILE.packages[0]!.package_id,
            package_slug: 'acme/forge-addon',
            canonical_repo: 'github.com/acme/forge-addon',
            updated_at: '2026-03-01T00:00:00Z',
            aliases: [],
            lineage_summary: [],
            declared_permissions: null
          };
        }
      },
      idFactory: () => 'run-2'
    });

    const result = await service.installProfile(BASE_PROFILE.profile_id, {
      org_id: 'org-1',
      mode: 'plan_only',
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [BASE_PROFILE.packages[0]!.package_id],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 5,
          disallowedPermissions: []
        }
      }
    });

    expect(createPlan).not.toHaveBeenCalled();
    expect(result.run?.status).toBe('failed');
    expect(result.plan_results).toEqual([
      {
        package_id: BASE_PROFILE.packages[0]!.package_id,
        install_order: 0,
        plan_id: null,
        status: 'failed',
        error: 'package_permissions_missing'
      }
    ]);
  });
});
