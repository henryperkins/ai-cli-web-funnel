import type {
  ProfileExportPayload,
  ProfileImportInput as SharedProfileImportInput,
  ProfileInstallInput as SharedProfileInstallInput,
  ProfileInstallRunRecord,
  ProfileRecord,
} from '@forge/shared-contracts';

// ── Response types ──────────────────────────────────────────────────

export interface SearchResponse {
  readonly query: string;
  readonly semantic_fallback: boolean;
  readonly results: ReadonlyArray<{
    readonly package_id: string;
    readonly package_slug: string | null;
    readonly score: number;
  }>;
}

export interface ListPackagesResponse {
  readonly packages: ReadonlyArray<{
    readonly package_id: string;
    readonly package_slug: string | null;
    readonly canonical_repo: string | null;
    readonly updated_at: string;
  }>;
}

export interface ResolvedPackageResponse {
  readonly package_id: string;
  readonly package_slug: string | null;
  readonly canonical_repo: string | null;
  readonly updated_at: string;
}

export interface PackageDetailResponse {
  readonly package_id: string;
  readonly package_slug: string | null;
  readonly canonical_repo: string | null;
  readonly updated_at: string;
  readonly aliases: readonly unknown[];
  readonly lineage_summary: readonly unknown[];
  readonly declared_permissions: readonly string[] | null;
  readonly freshness: unknown;
}

export interface FreshnessResponse {
  readonly generated_at: string;
  readonly sources: ReadonlyArray<{
    readonly source_name: string;
    readonly status: string;
    readonly stale: boolean;
    readonly last_attempt_at: string;
  }>;
}

// ── Install lifecycle types ────────────────────────────────────────

export interface CreatePlanInput {
  readonly package_id: string;
  readonly org_id: string;
  readonly requested_permissions: readonly string[];
  readonly org_policy: {
    readonly mcp_enabled: boolean;
    readonly server_allowlist: readonly string[];
    readonly block_flagged: boolean;
    readonly permission_caps: {
      readonly maxPermissions: number;
      readonly disallowedPermissions: readonly string[];
    };
  };
}

export interface PlanResponse {
  readonly status: string;
  readonly plan_id: string;
  readonly package_id: string;
  readonly package_slug: string;
  readonly policy_outcome: string;
  readonly replayed: boolean;
}

export interface PlanDetailResponse {
  readonly plan_id: string;
  readonly package_id: string;
  readonly package_slug: string;
  readonly status: string;
  readonly policy_outcome: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly actions: ReadonlyArray<{
    readonly action_order: number;
    readonly action_type: string;
    readonly scope: string;
    readonly status: string;
  }>;
}

export interface LifecycleActionResponse {
  readonly status: string;
  readonly plan_id: string;
  readonly replayed: boolean;
  readonly attempt_number: number;
  readonly reason_code: string | null;
}

export interface VerifyResponse extends LifecycleActionResponse {
  readonly readiness: boolean;
  readonly stages: ReadonlyArray<{
    readonly stage: string;
    readonly ok: boolean;
    readonly details: readonly string[];
  }>;
}

// ── Profile types ──────────────────────────────────────────────────

export interface ListProfilesResponse {
  readonly profiles: ReadonlyArray<{
    readonly profile_id: string;
    readonly name: string;
    readonly author_id: string;
    readonly visibility: string;
    readonly target_sdk: string;
    readonly package_count: number;
    readonly version: string;
    readonly created_at: string;
    readonly updated_at: string;
  }>;
}

export interface ProfileDetailResponse {
  readonly profile: ProfileRecord;
}

export interface ProfileExportResponse {
  readonly export: ProfileExportPayload;
}

export type ProfileImportInput = SharedProfileImportInput;

export interface ProfileImportResponse {
  readonly profile: ProfileRecord;
}

export type ProfileInstallInput = SharedProfileInstallInput;

export interface ProfileInstallResponse {
  readonly run: ProfileInstallRunRecord;
  readonly plan_results: ReadonlyArray<{
    readonly plan_id: string | null;
    readonly package_id: string;
    readonly install_order: number;
    readonly status: string;
    readonly error?: string;
  }>;
}

// ── Health ──────────────────────────────────────────────────────────

export interface HealthResponse {
  readonly status: string;
  readonly version?: string;
}

// ── Client ─────────────────────────────────────────────────────────

export interface ForgeClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ForgeResponse<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
}

export function createForgeClient(options: ForgeClientOptions) {
  const baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
  const fetchFn = options.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<ForgeResponse<T>> {
    const url = new URL(path.startsWith('/') ? path.slice(1) : path, baseUrl).toString();
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json' },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await fetchFn(url, init);
    const data = await res.json() as T;
    return { ok: res.ok, status: res.status, data };
  }

  return {
    // Catalog
    async search(query: string, limit?: number) {
      return request<SearchResponse>('POST', '/v1/packages/search', { query, limit });
    },
    async listPackages() {
      return request<ListPackagesResponse>('GET', '/v1/packages');
    },
    async resolvePackageSlug(slug: string) {
      const qs = new URLSearchParams({ slug });
      return request<ResolvedPackageResponse>('GET', `/v1/packages/resolve?${qs.toString()}`);
    },
    async getPackage(packageId: string) {
      return request<PackageDetailResponse>('GET', `/v1/packages/${encodeURIComponent(packageId)}`);
    },
    async getFreshness() {
      return request<FreshnessResponse>('GET', '/v1/packages/freshness');
    },
    // Install lifecycle
    async createPlan(input: CreatePlanInput) {
      return request<PlanResponse>('POST', '/v1/install/plans', input);
    },
    async getPlan(planId: string) {
      return request<PlanDetailResponse>('GET', `/v1/install/plans/${encodeURIComponent(planId)}`);
    },
    async applyPlan(planId: string) {
      return request<LifecycleActionResponse>('POST', `/v1/install/plans/${encodeURIComponent(planId)}/apply`);
    },
    async verifyPlan(planId: string) {
      return request<VerifyResponse>('POST', `/v1/install/plans/${encodeURIComponent(planId)}/verify`);
    },
    async updatePlan(planId: string, targetVersion?: string) {
      return request<LifecycleActionResponse>('POST', `/v1/install/plans/${encodeURIComponent(planId)}/update`, targetVersion !== undefined ? { target_version: targetVersion } : {});
    },
    async removePlan(planId: string) {
      return request<LifecycleActionResponse>('POST', `/v1/install/plans/${encodeURIComponent(planId)}/remove`);
    },
    async rollbackPlan(planId: string) {
      return request<LifecycleActionResponse>('POST', `/v1/install/plans/${encodeURIComponent(planId)}/rollback`);
    },
    // Profiles
    async listProfiles(opts?: { limit?: number; offset?: number; author_id?: string; visibility?: string }) {
      const params = new URLSearchParams();
      if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
      if (opts?.author_id !== undefined) params.set('author_id', opts.author_id);
      if (opts?.visibility !== undefined) params.set('visibility', opts.visibility);
      const qs = params.toString();
      return request<ListProfilesResponse>('GET', `/v1/profiles${qs ? `?${qs}` : ''}`);
    },
    async getProfile(profileId: string) {
      return request<ProfileDetailResponse>('GET', `/v1/profiles/${encodeURIComponent(profileId)}`);
    },
    async exportProfile(profileId: string) {
      return request<ProfileExportResponse>('GET', `/v1/profiles/${encodeURIComponent(profileId)}/export`);
    },
    async importProfile(payload: ProfileImportInput) {
      return request<ProfileImportResponse>('POST', '/v1/profiles/import', payload);
    },
    async installProfile(profileId: string, input: ProfileInstallInput) {
      return request<ProfileInstallResponse>('POST', `/v1/profiles/${encodeURIComponent(profileId)}/install`, input);
    },
    // Health
    async health() {
      return request<HealthResponse>('GET', '/health');
    },
  };
}

export type ForgeClient = ReturnType<typeof createForgeClient>;
