import { randomUUID } from 'node:crypto';
import type {
  ProfileCreateInput,
  ProfileInstallInput,
  ProfileInstallMode,
  ProfileInstallRunPlanStatus,
  ProfileImportInput,
  ProfileTargetSdk,
  ProfileVisibility
} from '@forge/shared-contracts';
import type { ProfilePostgresAdapters, ProfileListItem } from './profile-postgres-adapters.js';

type InstallLifecycleService = ReturnType<typeof import('./install-lifecycle.js').createInstallLifecycleService>;

export interface ProfileRouteServiceDependencies {
  profileAdapters: ProfilePostgresAdapters;
  installLifecycle?: InstallLifecycleService;
  idFactory?: () => string;
}

export interface ProfileRouteService {
  createProfile(input: ProfileCreateInput): Promise<{
    profile: ReturnType<ProfilePostgresAdapters['createProfile']> extends Promise<infer T> ? T : never;
  }>;
  getProfile(profileId: string): Promise<{
    profile: Awaited<ReturnType<ProfilePostgresAdapters['getProfile']>>;
  }>;
  listProfiles(options?: {
    limit?: number;
    offset?: number;
    author_id?: string;
    visibility?: ProfileVisibility;
  }): Promise<{
    profiles: ProfileListItem[];
  }>;
  exportProfile(profileId: string): Promise<{
    export: Awaited<ReturnType<ProfilePostgresAdapters['exportProfile']>>;
  }>;
  importProfile(input: ProfileImportInput): Promise<{
    profile: Awaited<ReturnType<ProfilePostgresAdapters['importProfile']>>;
  }>;
  installProfile(profileId: string, input: ProfileInstallInput): Promise<{
    run: Awaited<ReturnType<ProfilePostgresAdapters['getInstallRun']>>;
    plan_results: Array<{
      package_id: string;
      install_order: number;
      plan_id: string | null;
      status: 'planned' | 'applied' | 'verified' | 'failed' | 'skipped';
      error?: string;
    }>;
  }>;
  getInstallRun(runId: string): Promise<{
    run: Awaited<ReturnType<ProfilePostgresAdapters['getInstallRun']>>;
  }>;
}

type InstallProfilePlanResult = {
  package_id: string;
  install_order: number;
  plan_id: string | null;
  status: 'planned' | 'applied' | 'verified' | 'failed' | 'skipped';
  error?: string;
};

const MAX_PROFILE_PACKAGES = 200;
const MAX_TAGS = 32;

const PROFILE_VISIBILITY = new Set<ProfileVisibility>(['public', 'private', 'team']);
const PROFILE_TARGET_SDK = new Set<ProfileTargetSdk>(['claude_code', 'codex', 'both']);
const PROFILE_INSTALL_MODES = new Set<ProfileInstallMode>(['plan_only', 'apply_verify']);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(reason: string): never {
  throw new Error(reason);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return null;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return null;
    }
    output.push(trimmed);
  }

  return output;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function assertUuid(value: string, reason: string): void {
  if (!UUID_RE.test(value)) {
    fail(reason);
  }
}

function normalizeProfilePackages(
  packages: unknown,
  source: 'create' | 'import'
): ProfileCreateInput['packages'] {
  if (!Array.isArray(packages) || packages.length === 0) {
    fail(`${source}_packages_required`);
  }
  if (packages.length > MAX_PROFILE_PACKAGES) {
    fail(`${source}_packages_too_many`);
  }

  const normalized: ProfileCreateInput['packages'] = [];
  const seenOrder = new Set<number>();

  for (const [index, pkg] of packages.entries()) {
    const record = asObject(pkg);
    if (!record) {
      fail(`${source}_package_object_required`);
    }

    const packageId = asNonEmptyString(record.package_id);
    if (!packageId) {
      fail(`${source}_package_id_required`);
    }
    assertUuid(packageId, `${source}_package_id_invalid_uuid`);

    const installOrderRaw = record.install_order;
    if (!Number.isInteger(installOrderRaw) || Number(installOrderRaw) < 0) {
      fail(`${source}_install_order_invalid`);
    }
    const installOrder = Number(installOrderRaw);
    if (seenOrder.has(installOrder)) {
      fail(`${source}_install_order_duplicate`);
    }
    seenOrder.add(installOrder);

    const required =
      typeof record.required === 'boolean'
        ? record.required
        : record.required === undefined
          ? true
          : fail(`${source}_required_must_be_boolean`);

    const packageSlug =
      record.package_slug === undefined || record.package_slug === null
        ? undefined
        : asNonEmptyString(record.package_slug) ?? fail(`${source}_package_slug_invalid`);

    const versionPinned =
      record.version_pinned === undefined || record.version_pinned === null
        ? undefined
        : asNonEmptyString(record.version_pinned) ?? fail(`${source}_version_pinned_invalid`);

    const configOverrides =
      record.config_overrides === undefined
        ? undefined
        : asObject(record.config_overrides) ?? fail(`${source}_config_overrides_object_required`);

    normalized.push({
      package_id: packageId,
      install_order: installOrder,
      required,
      ...(packageSlug !== undefined ? { package_slug: packageSlug } : {}),
      ...(versionPinned !== undefined ? { version_pinned: versionPinned } : {}),
      ...(configOverrides !== undefined ? { config_overrides: configOverrides } : {})
    });

    if (index >= MAX_PROFILE_PACKAGES) {
      fail(`${source}_packages_too_many`);
    }
  }

  return normalized.sort((left, right) => left.install_order - right.install_order);
}

function normalizeCreateInput(input: ProfileCreateInput): ProfileCreateInput {
  const name = asNonEmptyString(input.name);
  if (!name) {
    fail('create_name_required');
  }

  const authorId = asNonEmptyString(input.author_id);
  if (!authorId) {
    fail('create_author_id_required');
  }

  const visibility =
    input.visibility === undefined
      ? undefined
      : PROFILE_VISIBILITY.has(input.visibility)
        ? input.visibility
        : fail('create_visibility_invalid');

  const targetSdk =
    input.target_sdk === undefined
      ? undefined
      : PROFILE_TARGET_SDK.has(input.target_sdk)
        ? input.target_sdk
        : fail('create_target_sdk_invalid');

  const tags =
    input.tags === undefined
      ? undefined
      : (() => {
          const parsed = asStringArray(input.tags);
          if (!parsed) {
            fail('create_tags_invalid');
          }
          const unique = Array.from(new Set(parsed));
          if (unique.length > MAX_TAGS) {
            fail('create_tags_too_many');
          }
          return unique;
        })();

  const description =
    input.description === undefined
      ? undefined
      : input.description.trim();

  const normalizedPackages = normalizeProfilePackages(input.packages, 'create');

  return {
    name,
    author_id: authorId,
    packages: normalizedPackages,
    ...(description !== undefined ? { description } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    ...(targetSdk !== undefined ? { target_sdk: targetSdk } : {}),
    ...(tags !== undefined ? { tags } : {})
  };
}

function normalizeImportInput(input: ProfileImportInput): ProfileImportInput {
  if (input.format_version !== '1.0.0') {
    fail('import_format_version_invalid');
  }

  const profileObject = asObject(input.profile);
  if (!profileObject) {
    fail('import_profile_required');
  }

  const createInput = normalizeCreateInput({
    name: String(profileObject.name ?? ''),
    author_id: String(profileObject.author_id ?? ''),
    packages: (profileObject.packages ?? []) as ProfileCreateInput['packages'],
    ...(typeof profileObject.description === 'string'
      ? { description: profileObject.description }
      : {}),
    ...(typeof profileObject.visibility === 'string'
      ? { visibility: profileObject.visibility as ProfileVisibility }
      : {}),
    ...(typeof profileObject.target_sdk === 'string'
      ? { target_sdk: profileObject.target_sdk as ProfileTargetSdk }
      : {}),
    ...(Array.isArray(profileObject.tags)
      ? { tags: profileObject.tags as string[] }
      : {})
  });

  return {
    format_version: '1.0.0',
    profile: {
      name: createInput.name,
      author_id: createInput.author_id,
      packages: createInput.packages.map((pkg) => ({
        package_id: pkg.package_id,
        install_order: pkg.install_order,
        ...(pkg.package_slug !== undefined ? { package_slug: pkg.package_slug } : {}),
        ...(pkg.version_pinned !== undefined ? { version_pinned: pkg.version_pinned } : {}),
        ...(pkg.required !== undefined ? { required: pkg.required } : {}),
        ...(pkg.config_overrides !== undefined
          ? { config_overrides: pkg.config_overrides }
          : {})
      })),
      ...(createInput.description !== undefined ? { description: createInput.description } : {}),
      ...(createInput.visibility !== undefined ? { visibility: createInput.visibility } : {}),
      ...(createInput.target_sdk !== undefined ? { target_sdk: createInput.target_sdk } : {}),
      ...(createInput.tags !== undefined ? { tags: createInput.tags } : {}),
      ...(typeof profileObject.version === 'string' ? { version: profileObject.version } : {})
    }
  };
}

function normalizeListOptions(options?: {
  limit?: number;
  offset?: number;
  author_id?: string;
  visibility?: ProfileVisibility;
}): {
  limit: number;
  offset: number;
  author_id?: string;
  visibility?: ProfileVisibility;
} {
  const limit = options?.limit ?? 25;
  const offset = options?.offset ?? 0;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail('list_limit_out_of_range');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    fail('list_offset_out_of_range');
  }

  const output: {
    limit: number;
    offset: number;
    author_id?: string;
    visibility?: ProfileVisibility;
  } = {
    limit,
    offset
  };

  if (options?.author_id !== undefined) {
    const authorId = asNonEmptyString(options.author_id);
    if (!authorId) {
      fail('list_author_id_invalid');
    }
    output.author_id = authorId;
  }

  if (options?.visibility !== undefined) {
    if (!PROFILE_VISIBILITY.has(options.visibility)) {
      fail('list_visibility_invalid');
    }
    output.visibility = options.visibility;
  }

  return output;
}

function normalizeInstallInput(input: ProfileInstallInput): Required<Pick<ProfileInstallInput, 'org_id' | 'org_policy'>> & {
  mode: ProfileInstallMode;
  correlation_id: string | null;
} {
  const orgId = asNonEmptyString(input.org_id);
  if (!orgId) {
    fail('install_org_id_required');
  }

  const orgPolicy = asObject(input.org_policy);
  if (!orgPolicy) {
    fail('install_org_policy_required');
  }

  if (typeof orgPolicy.mcp_enabled !== 'boolean') {
    fail('install_org_policy_mcp_enabled_invalid');
  }

  const serverAllowlist = asStringArray(orgPolicy.server_allowlist);
  if (!serverAllowlist) {
    fail('install_org_policy_server_allowlist_invalid');
  }

  if (typeof orgPolicy.block_flagged !== 'boolean') {
    fail('install_org_policy_block_flagged_invalid');
  }

  const permissionCaps = asObject(orgPolicy.permission_caps);
  if (!permissionCaps) {
    fail('install_org_policy_permission_caps_required');
  }

  if (
    !Number.isInteger(permissionCaps.maxPermissions) ||
    Number(permissionCaps.maxPermissions) < 0
  ) {
    fail('install_org_policy_max_permissions_invalid');
  }

  const disallowedPermissions = asStringArray(permissionCaps.disallowedPermissions);
  if (!disallowedPermissions) {
    fail('install_org_policy_disallowed_permissions_invalid');
  }

  const mode =
    input.mode === undefined
      ? 'plan_only'
      : PROFILE_INSTALL_MODES.has(input.mode)
        ? input.mode
        : fail('install_mode_invalid');

  const correlationIdRaw = input.correlation_id;
  const correlationId =
    correlationIdRaw === undefined || correlationIdRaw === null
      ? null
      : asNonEmptyString(correlationIdRaw) ?? fail('install_correlation_id_invalid');

  return {
    org_id: orgId,
    org_policy: {
      mcp_enabled: orgPolicy.mcp_enabled,
      server_allowlist: serverAllowlist,
      block_flagged: orgPolicy.block_flagged,
      permission_caps: {
        maxPermissions: Number(permissionCaps.maxPermissions),
        disallowedPermissions
      }
    },
    mode,
    correlation_id: correlationId
  };
}

function toPlanResultStatus(status: ProfileInstallRunPlanStatus):
  | 'planned'
  | 'applied'
  | 'verified'
  | 'failed'
  | 'skipped' {
  if (
    status === 'planned' ||
    status === 'applied' ||
    status === 'verified' ||
    status === 'failed' ||
    status === 'skipped'
  ) {
    return status;
  }

  return 'failed';
}

export function createProfileRouteService(
  deps: ProfileRouteServiceDependencies
): ProfileRouteService {
  const makeId = deps.idFactory ?? (() => randomUUID());

  return {
    async createProfile(input) {
      const profileId = makeId();
      const normalizedInput = normalizeCreateInput(input);
      const profile = await deps.profileAdapters.createProfile(normalizedInput, profileId);
      return { profile };
    },

    async getProfile(profileId) {
      const profile = await deps.profileAdapters.getProfile(profileId);
      return { profile };
    },

    async listProfiles(options) {
      const normalized = normalizeListOptions(options);

      const filters: { author_id?: string; visibility?: ProfileVisibility } = {};
      if (normalized.author_id) filters.author_id = normalized.author_id;
      if (normalized.visibility) filters.visibility = normalized.visibility;

      const profiles = await deps.profileAdapters.listProfiles(
        normalized.limit,
        normalized.offset,
        filters
      );
      return { profiles };
    },

    async exportProfile(profileId) {
      const exported = await deps.profileAdapters.exportProfile(profileId);
      return { export: exported };
    },

    async importProfile(input) {
      const profileId = makeId();
      const normalizedInput = normalizeImportInput(input);
      const profile = await deps.profileAdapters.importProfile(normalizedInput, profileId);
      return { profile };
    },

    async installProfile(profileId, input) {
      if (!deps.installLifecycle) {
        throw new Error('install_lifecycle_unavailable');
      }

      const profile = await deps.profileAdapters.getProfile(profileId);
      if (!profile) {
        throw new Error('profile_not_found');
      }

      const normalizedInput = normalizeInstallInput(input);

      const runId = makeId();
      await deps.profileAdapters.createInstallRun(
        profileId,
        runId,
        normalizedInput.correlation_id
      );

      const nonPersistedResults: InstallProfilePlanResult[] = [];

      const perPlanFailure = new Map<string, string>();
      const correlationBase = normalizedInput.correlation_id ?? `profile-run:${runId}`;

      let failedWithoutPlan = 0;
      let skippedOptional = 0;

      const profilePackages = [...profile.packages].sort(
        (left, right) => left.install_order - right.install_order
      );

      for (const pkg of profilePackages) {
        if (!pkg.required) {
          skippedOptional += 1;
          nonPersistedResults.push({
            package_id: pkg.package_id,
            install_order: pkg.install_order,
            plan_id: null,
            status: 'skipped'
          });
          continue;
        }

        const planIdempotencyKey = [
          'profile-install',
          profileId,
          correlationBase,
          pkg.package_id,
          String(pkg.install_order),
          'plan'
        ].join(':');

        let planId: string | null = null;
        try {
          const planResponse = await deps.installLifecycle.createPlan(
            {
              package_id: pkg.package_id,
              ...(pkg.package_slug ? { package_slug: pkg.package_slug } : {}),
              org_id: normalizedInput.org_id,
              requested_permissions: [],
              org_policy: normalizedInput.org_policy,
              ...(normalizedInput.correlation_id
                ? { correlation_id: normalizedInput.correlation_id }
                : {})
            },
            planIdempotencyKey
          );

          planId = planResponse.plan_id;
          await deps.profileAdapters.addInstallRunPlanByPlanId(
            runId,
            planId,
            pkg.package_id,
            pkg.install_order,
            'planned'
          );

          if (normalizedInput.mode === 'plan_only') {
            continue;
          }

          const applyIdempotencyKey = [
            'profile-install',
            profileId,
            correlationBase,
            planId,
            'apply'
          ].join(':');

          const applyResponse = await deps.installLifecycle.applyPlan(
            planId,
            applyIdempotencyKey,
            normalizedInput.correlation_id
          );

          if (applyResponse.status !== 'apply_succeeded') {
            const reason = applyResponse.reason_code ?? 'apply_failed';
            perPlanFailure.set(planId, reason);
            await deps.profileAdapters.updateInstallRunPlanStatusByPlanId(runId, planId, 'failed');
            continue;
          }

          await deps.profileAdapters.updateInstallRunPlanStatusByPlanId(runId, planId, 'applied');

          const verifyIdempotencyKey = [
            'profile-install',
            profileId,
            correlationBase,
            planId,
            'verify'
          ].join(':');

          const verifyResponse = await deps.installLifecycle.verifyPlan(
            planId,
            verifyIdempotencyKey,
            normalizedInput.correlation_id
          );

          if (verifyResponse.status !== 'verify_succeeded') {
            const reason = verifyResponse.reason_code ?? 'verify_failed';
            perPlanFailure.set(planId, reason);
            await deps.profileAdapters.updateInstallRunPlanStatusByPlanId(runId, planId, 'failed');
            continue;
          }

          await deps.profileAdapters.updateInstallRunPlanStatusByPlanId(runId, planId, 'verified');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown_error';

          if (planId) {
            perPlanFailure.set(planId, message);
            await deps.profileAdapters.updateInstallRunPlanStatusByPlanId(runId, planId, 'failed');
            continue;
          }

          failedWithoutPlan += 1;
          nonPersistedResults.push({
            package_id: pkg.package_id,
            install_order: pkg.install_order,
            plan_id: null,
            status: 'failed',
            error: message
          });
        }
      }

      const persistedRun = await deps.profileAdapters.getInstallRun(runId);
      if (!persistedRun) {
        throw new Error('install_run_not_found');
      }

      const persistedResults: InstallProfilePlanResult[] = persistedRun.plans.map((plan) => {
        const planError = perPlanFailure.get(plan.plan_id);
        if (plan.status === 'failed' && planError) {
          return {
            package_id: plan.package_id,
            install_order: plan.install_order,
            plan_id: plan.plan_id,
            status: toPlanResultStatus(plan.status),
            error: planError
          };
        }

        return {
          package_id: plan.package_id,
          install_order: plan.install_order,
          plan_id: plan.plan_id,
          status: toPlanResultStatus(plan.status)
        };
      });

      const planResults = [...persistedResults, ...nonPersistedResults].sort((left, right) => {
        if (left.install_order !== right.install_order) {
          return left.install_order - right.install_order;
        }
        return left.package_id.localeCompare(right.package_id);
      });

      const succeededFromPersisted =
        normalizedInput.mode === 'apply_verify'
          ? persistedRun.plans.filter((plan) => plan.status === 'verified').length
          : persistedRun.plans.filter((plan) => plan.status === 'planned').length;

      const failedFromPersisted = persistedRun.plans.filter((plan) => plan.status === 'failed').length;
      const skippedFromPersisted = persistedRun.plans.filter((plan) => plan.status === 'skipped').length;

      const succeeded = succeededFromPersisted;
      const failed = failedFromPersisted + failedWithoutPlan;
      const skipped = skippedFromPersisted + skippedOptional;

      const finalStatus =
        failed === 0
          ? 'succeeded'
          : succeeded === 0 && skipped === 0
              ? 'failed'
              : 'partially_failed';

      await deps.profileAdapters.completeInstallRun(runId, finalStatus, {
        succeeded,
        failed,
        skipped
      });

      const completedRun = await deps.profileAdapters.getInstallRun(runId);

      return {
        run: completedRun,
        plan_results: planResults
      };
    },

    async getInstallRun(runId) {
      const run = await deps.profileAdapters.getInstallRun(runId);
      return { run };
    }
  };
}
