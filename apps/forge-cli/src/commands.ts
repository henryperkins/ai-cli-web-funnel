import { readFileSync, writeFileSync } from 'node:fs';
import {
  createForgeClient,
  type CreatePlanInput,
  type ForgeClient,
  type ProfileDetailResponse,
  type ProfileExportResponse,
  type ProfileImportInput,
  type ProfileImportResponse,
  type ProfileInstallResponse,
  type VerifyResponse,
} from './client.js';
import {
  formatError,
  formatJson,
  formatKeyValue,
  formatTable,
} from './format.js';
import {
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_SOLO_ORG_POLICY,
  defaultOrgId,
  loadOrgPolicyFile,
  loadUserConfig,
  resolveConfigPath,
  validateControlPlaneUrl,
  writeUserConfig,
  type DefaultOrgPolicy,
  type ForgeUserConfigField,
  type ForgeUserConfig,
  type LoadedForgeUserConfig,
} from './config.js';

// ── Arg parsing helpers ────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
  readonly booleans: ReadonlySet<string>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const booleans = new Set<string>();

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next);
        i += 2;
      } else {
        booleans.add(name);
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { positional, flags, booleans };
}

function getFlag(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name);
}

function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.booleans.has(name);
}

function loadConfigFromArgs(
  args: ParsedArgs,
  fields?: readonly ForgeUserConfigField[]
): LoadedForgeUserConfig {
  const configPath = resolveConfigPath({ explicitPath: getFlag(args, 'path') });
  return fields === undefined ? loadUserConfig(configPath) : loadUserConfig(configPath, { fields });
}

function reportError(message: string): void {
  output(message);
  process.exitCode = 1;
}

function resolveBaseUrl(args: ParsedArgs): string | null {
  const explicitUrl = getFlag(args, 'url');
  const envUrl = process.env['FORGE_URL'];

  if (explicitUrl !== undefined || envUrl !== undefined) {
    try {
      return validateControlPlaneUrl(explicitUrl ?? envUrl ?? '', explicitUrl !== undefined ? '--url' : 'FORGE_URL');
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  let loadedConfig: LoadedForgeUserConfig;
  try {
    loadedConfig = loadConfigFromArgs(args, ['control_plane_url']);
  } catch (err) {
    reportError(err instanceof Error ? err.message : String(err));
    return null;
  }

  return loadedConfig.config?.control_plane_url ?? DEFAULT_CONTROL_PLANE_URL;
}

function makeDefaultUserConfig(args: ParsedArgs): ForgeUserConfig | null {
  const controlPlaneUrl = getFlag(args, 'url') ?? process.env['FORGE_URL'] ?? DEFAULT_CONTROL_PLANE_URL;
  const label = getFlag(args, 'url') !== undefined ? '--url' : process.env['FORGE_URL'] !== undefined ? 'FORGE_URL' : '--url';
  try {
    return {
      org_id: defaultOrgId(),
      control_plane_url: validateControlPlaneUrl(controlPlaneUrl, label),
      org_policy: DEFAULT_SOLO_ORG_POLICY,
    };
  } catch (err) {
    reportError(err instanceof Error ? err.message : String(err));
    return null;
  }
}

function isJsonMode(args: ParsedArgs): boolean {
  return hasFlag(args, 'json');
}

function output(text: string): void {
  process.stdout.write(text + '\n');
}

function createClientFromArgs(args: ParsedArgs): ForgeClient | null {
  const baseUrl = resolveBaseUrl(args);
  return baseUrl ? createForgeClient({ baseUrl }) : null;
}

function maybeDefaultPolicyHint(args: ParsedArgs, configPath: string, usingDefaultPolicy: boolean): string | null {
  if (!usingDefaultPolicy || isJsonMode(args)) {
    return null;
  }

  return `Using default solo org policy. Run \`forge init\` to write ${configPath}.`;
}

function handleResponse<T>(args: ParsedArgs, ok: boolean, status: number, data: T, formatter: (d: T) => string): boolean {
  if (isJsonMode(args)) {
    output(formatJson(data));
    if (!ok) {
      process.exitCode = 1;
      return false;
    }
    return true;
  }

  if (!ok) {
    output(formatError(status, data));
    process.exitCode = 1;
    return false;
  }

  output(formatter(data));
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function parsePermissionsFlag(value: string): string[] | null {
  if (value.trim().length === 0) {
    return [];
  }

  const normalized: string[] = [];
  for (const entry of value.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return null;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function resolveOrgContext(
  args: ParsedArgs,
  usage: string
): { orgId: string; orgPolicy: DefaultOrgPolicy; defaultPolicyHint: string | null } | null {
  const configPath = resolveConfigPath({ explicitPath: getFlag(args, 'path') });
  const orgIdFlag = getFlag(args, 'org-id')?.trim();
  const orgIdEnv = process.env['FORGE_ORG_ID']?.trim();
  const policyFile = getFlag(args, 'org-policy-file')?.trim() || process.env['FORGE_ORG_POLICY_FILE']?.trim();

  const neededConfigFields: ForgeUserConfigField[] = [];
  if (!orgIdFlag && !orgIdEnv) {
    neededConfigFields.push('org_id');
  }
  if (!policyFile) {
    neededConfigFields.push('org_policy');
  }

  let loadedConfig: LoadedForgeUserConfig = { path: configPath, exists: false, config: null };
  if (neededConfigFields.length > 0) {
    try {
      loadedConfig = loadUserConfig(configPath, { fields: neededConfigFields });
    } catch (err) {
      output(`${usage}\n\n${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return null;
    }
  }

  const orgId = orgIdFlag || orgIdEnv || loadedConfig.config?.org_id || defaultOrgId();

  try {
    const orgPolicy = policyFile
      ? loadOrgPolicyFile(policyFile)
      : loadedConfig.config?.org_policy ?? DEFAULT_SOLO_ORG_POLICY;
    const usingDefaultPolicy = !policyFile && loadedConfig.config?.org_policy === undefined;
    return {
      orgId,
      orgPolicy,
      defaultPolicyHint: maybeDefaultPolicyHint(args, loadedConfig.path, usingDefaultPolicy),
    };
  } catch (err) {
    output(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return null;
  }
}

async function resolveRequestedPermissionsForPlan(
  args: ParsedArgs,
  client: ForgeClient,
  packageId: string
): Promise<string[] | null> {
  const permissionsFlag = getFlag(args, 'permissions');
  if (permissionsFlag !== undefined) {
    const permissions = parsePermissionsFlag(permissionsFlag);
    if (!permissions) {
      output('Invalid --permissions value: expected comma-separated non-empty permissions.');
      process.exitCode = 1;
      return null;
    }

    return permissions;
  }

  const detailRes = await client.getPackage(packageId);
  if (!detailRes.ok) {
    handleResponse(args, false, detailRes.status, detailRes.data, () => '');
    return null;
  }

  if (detailRes.data.declared_permissions === null) {
    output(
      `Package ${packageId} does not publish declared permissions. Re-run with --permissions <p1,p2,...>.`
    );
    process.exitCode = 1;
    return null;
  }

  return [...detailRes.data.declared_permissions];
}

function formatProfile(profile: ProfileDetailResponse['profile'] | ProfileImportResponse['profile']): string {
  return formatKeyValue([
    ['profile_id', profile.profile_id],
    ['name', profile.name],
    ['author_id', profile.author_id],
    ['visibility', profile.visibility],
    ['target_sdk', profile.target_sdk],
    ['version', profile.version],
    ['tags', JSON.stringify(profile.tags)],
    ['description', profile.description],
    ['packages', JSON.stringify(profile.packages)],
    ['created_at', profile.created_at],
    ['updated_at', profile.updated_at],
  ]);
}

function normalizeProfileImportPayload(value: unknown): ProfileImportInput | null {
  const candidate = asRecord(value);
  if (!candidate) {
    return null;
  }

  const directProfile = asRecord(candidate['profile']);
  if (candidate['format_version'] === '1.0.0' && directProfile) {
    return {
      format_version: '1.0.0',
      profile: directProfile as ProfileImportInput['profile'],
    };
  }

  const legacyEnvelope = asRecord(candidate['export']);
  const legacyProfile = legacyEnvelope ? asRecord(legacyEnvelope['profile']) : null;
  if (legacyEnvelope?.['format_version'] === '1.0.0' && legacyProfile) {
    return {
      format_version: '1.0.0',
      profile: legacyProfile as ProfileImportInput['profile'],
    };
  }

  return null;
}

// ── Commands ───────────────────────────────────────────────────────

export async function initCommand(args: ParsedArgs): Promise<void> {
  const config = makeDefaultUserConfig(args);
  if (!config) {
    return;
  }

  const configPath = resolveConfigPath({ explicitPath: getFlag(args, 'path') });
  try {
    writeUserConfig(configPath, config, { force: hasFlag(args, 'force') });
  } catch (err) {
    reportError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (isJsonMode(args)) {
    output(formatJson({ path: configPath, config }));
    return;
  }

  output(`Forge config written to ${configPath}`);
  output(`org_id: ${config.org_id}`);
  output(`control_plane_url: ${config.control_plane_url}`);
}

export async function searchCommand(args: ParsedArgs): Promise<void> {
  const query = args.positional[0];
  if (!query) {
    output('Usage: forge search <query> [--limit <n>]');
    process.exitCode = 1;
    return;
  }

  const limitStr = getFlag(args, 'limit');
  const limit = limitStr !== undefined ? parseInt(limitStr, 10) : 10;
  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.search(query, limit);

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const rows = data.results.map((r) => [
      r.package_id,
      r.package_slug ?? '-',
      r.score.toFixed(4),
    ]);
    return formatTable(['PACKAGE_ID', 'SLUG', 'SCORE'], rows);
  });
}

export async function showCommand(args: ParsedArgs): Promise<void> {
  const packageId = args.positional[0];
  if (!packageId) {
    output('Usage: forge show <package_id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.getPackage(packageId);

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    formatKeyValue([
      ['package_id', data.package_id],
      ['slug', data.package_slug ?? '-'],
      ['canonical_repo', data.canonical_repo ?? '-'],
      ['updated_at', data.updated_at],
      ['declared_permissions', data.declared_permissions ? JSON.stringify(data.declared_permissions) : '-'],
      ['aliases', JSON.stringify(data.aliases)],
    ])
  );
}

export async function listCommand(args: ParsedArgs): Promise<void> {
  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.listPackages();

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const rows = data.packages.map((p) => [
      p.package_id,
      p.package_slug ?? '-',
      p.canonical_repo ?? '-',
      p.updated_at,
    ]);
    return formatTable(['PACKAGE_ID', 'SLUG', 'REPO', 'UPDATED'], rows);
  });
}

export async function freshnessCommand(args: ParsedArgs): Promise<void> {
  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.getFreshness();

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const rows = data.sources.map((s) => [
      s.source_name,
      s.status,
      s.stale ? 'STALE' : 'OK',
      s.last_attempt_at,
    ]);
    return formatTable(['SOURCE', 'STATUS', 'FRESHNESS', 'LAST_ATTEMPT'], rows);
  });
}

export async function planCommand(args: ParsedArgs): Promise<void> {
  const usage =
    'Usage: forge plan <package_id_or_slug> [--org-id <org>] [--org-policy-file <file>] [--permissions <p1,p2>]';
  let packageInput = args.positional[0];
  if (!packageInput) {
    output(usage);
    process.exitCode = 1;
    return;
  }

  const orgContext = resolveOrgContext(args, usage);
  if (!orgContext) {
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }

  // If input is not a UUID, resolve it as an exact package slug.
  let packageId: string;
  if (!UUID_RE.test(packageInput)) {
    const resolveRes = await client.resolvePackageSlug(packageInput);
    if (!resolveRes.ok) {
      if (resolveRes.status === 404) {
        output(
          `No package found with slug "${packageInput}". Run \`forge search "${packageInput}"\` to discover package ids.`
        );
        process.exitCode = 1;
        return;
      }

      if (resolveRes.status === 409) {
        output(
          `Slug "${packageInput}" matches multiple packages. Run \`forge search "${packageInput}"\` and retry with a package_id.`
        );
        process.exitCode = 1;
        return;
      }

      handleResponse(args, false, resolveRes.status, resolveRes.data, () => '');
      return;
    }

    packageId = resolveRes.data.package_id;
    if (!isJsonMode(args)) {
      output(`Resolved slug "${packageInput}" to package ${packageId}`);
    }
  } else {
    packageId = packageInput;
  }

  const permissions = await resolveRequestedPermissionsForPlan(args, client, packageId);
  if (permissions === null) {
    return;
  }

  const input: CreatePlanInput = {
    package_id: packageId,
    org_id: orgContext.orgId,
    requested_permissions: permissions,
    org_policy: orgContext.orgPolicy,
  };

  const res = await client.createPlan(input);

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    [
      ...(orgContext.defaultPolicyHint ? [orgContext.defaultPolicyHint, ''] : []),
      formatKeyValue([
        ['plan_id', data.plan_id],
        ['status', data.status],
        ['package_id', data.package_id],
        ['package_slug', data.package_slug],
        ['policy_outcome', data.policy_outcome],
        ['replayed', String(data.replayed)],
      ]),
    ].join('\n')
  );
}

export async function installCommand(args: ParsedArgs): Promise<void> {
  const planId = args.positional[0];
  if (!planId) {
    output('Usage: forge install <plan_id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.applyPlan(planId);

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    formatKeyValue([
      ['plan_id', data.plan_id],
      ['status', data.status],
      ['replayed', String(data.replayed)],
      ['attempt', String(data.attempt_number)],
      ['reason_code', data.reason_code ?? '-'],
    ])
  );
}

export async function verifyCommand(args: ParsedArgs): Promise<void> {
  const planId = args.positional[0];
  if (!planId) {
    output('Usage: forge verify <plan_id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.verifyPlan(planId);

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const verifyData = data as VerifyResponse;
    const lines: string[] = [];
    lines.push(formatKeyValue([
      ['plan_id', verifyData.plan_id],
      ['status', verifyData.status],
      ['readiness', String(verifyData.readiness)],
      ['replayed', String(verifyData.replayed)],
      ['attempt', String(verifyData.attempt_number)],
    ]));

    if (verifyData.stages && verifyData.stages.length > 0) {
      lines.push('');
      lines.push('Stages:');
      const stageRows = verifyData.stages.map((s) => [
        s.stage,
        s.ok ? 'PASS' : 'FAIL',
        s.details.join(', '),
      ]);
      lines.push(formatTable(['STAGE', 'RESULT', 'DETAILS'], stageRows));
    }

    return lines.join('\n');
  });
}

export async function updateCommand(args: ParsedArgs): Promise<void> {
  const planId = args.positional[0];
  if (!planId) {
    output('Usage: forge update <plan_id> [--version <v>]');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const version = getFlag(args, 'version');
  const res = await client.updatePlan(planId, version);

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    formatKeyValue([
      ['plan_id', data.plan_id],
      ['status', data.status],
      ['replayed', String(data.replayed)],
      ['attempt', String(data.attempt_number)],
      ['reason_code', data.reason_code ?? '-'],
    ])
  );
}

export async function removeCommand(args: ParsedArgs): Promise<void> {
  const planId = args.positional[0];
  if (!planId) {
    output('Usage: forge remove <plan_id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.removePlan(planId);

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    formatKeyValue([
      ['plan_id', data.plan_id],
      ['status', data.status],
      ['replayed', String(data.replayed)],
      ['attempt', String(data.attempt_number)],
      ['reason_code', data.reason_code ?? '-'],
    ])
  );
}

export async function rollbackCommand(args: ParsedArgs): Promise<void> {
  const planId = args.positional[0];
  if (!planId) {
    output('Usage: forge rollback <plan_id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.rollbackPlan(planId);

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    formatKeyValue([
      ['plan_id', data.plan_id],
      ['status', data.status],
      ['replayed', String(data.replayed)],
      ['attempt', String(data.attempt_number)],
      ['reason_code', data.reason_code ?? '-'],
    ])
  );
}

export async function statusCommand(args: ParsedArgs): Promise<void> {
  const planId = args.positional[0];
  if (!planId) {
    output('Usage: forge status <plan_id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.getPlan(planId);

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const lines: string[] = [];
    lines.push(formatKeyValue([
      ['plan_id', data.plan_id],
      ['package_id', data.package_id],
      ['package_slug', data.package_slug],
      ['status', data.status],
      ['policy_outcome', data.policy_outcome],
      ['created_at', data.created_at],
      ['updated_at', data.updated_at],
    ]));

    if (data.actions.length > 0) {
      lines.push('');
      lines.push('Actions:');
      const actionRows = data.actions.map((a) => [
        String(a.action_order),
        a.action_type,
        a.scope,
        a.status,
      ]);
      lines.push(formatTable(['ORDER', 'TYPE', 'SCOPE', 'STATUS'], actionRows));
    }

    return lines.join('\n');
  });
}

// ── Profile commands ───────────────────────────────────────────────

export async function profileListCommand(args: ParsedArgs): Promise<void> {
  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }

  const opts: { limit?: number; offset?: number; author_id?: string; visibility?: string } = {};
  const limitStr = getFlag(args, 'limit');
  if (limitStr !== undefined) opts.limit = parseInt(limitStr, 10);
  const offsetStr = getFlag(args, 'offset');
  if (offsetStr !== undefined) opts.offset = parseInt(offsetStr, 10);
  const authorId = getFlag(args, 'author-id');
  if (authorId !== undefined) opts.author_id = authorId;
  const visibility = getFlag(args, 'visibility');
  if (visibility !== undefined) opts.visibility = visibility;

  const res = await client.listProfiles(opts);

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const rows = data.profiles.map((p) => [
      p.profile_id,
      p.name,
      p.author_id,
      p.visibility,
      p.target_sdk,
      String(p.package_count),
      p.version,
      p.updated_at,
    ]);
    return formatTable(
      ['PROFILE_ID', 'NAME', 'AUTHOR', 'VISIBILITY', 'TARGET_SDK', 'PACKAGES', 'VERSION', 'UPDATED'],
      rows
    );
  });
}

export async function profileShowCommand(args: ParsedArgs): Promise<void> {
  const profileId = args.positional[0];
  if (!profileId) {
    output('Usage: forge profile show <id>');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.getProfile(profileId);

  handleResponse(args, res.ok, res.status, res.data, (data) => formatProfile(data.profile));
}

export async function profileExportCommand(args: ParsedArgs): Promise<void> {
  const profileId = args.positional[0];
  if (!profileId) {
    output('Usage: forge profile export <id> [--output <file>]');
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.exportProfile(profileId);

  if (!res.ok) {
    if (isJsonMode(args)) {
      output(formatJson(res.data));
    } else {
      output(formatError(res.status, res.data));
    }
    process.exitCode = 1;
    return;
  }

  const outputFile = getFlag(args, 'output');
  const json = formatJson((res.data as ProfileExportResponse).export);

  if (outputFile !== undefined) {
    writeFileSync(outputFile, json + '\n', 'utf-8');
    if (!isJsonMode(args)) {
      output(`Profile exported to ${outputFile}`);
    }
  } else {
    output(json);
  }
}

export async function profileImportCommand(args: ParsedArgs): Promise<void> {
  const filePath = args.positional[0];
  if (!filePath) {
    output('Usage: forge profile import <file>');
    process.exitCode = 1;
    return;
  }

  let payload: ProfileImportInput;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeProfileImportPayload(parsed);
    if (!normalized) {
      output(`Invalid profile import payload: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    payload = normalized;
  } catch (err) {
    output(`Failed to read file: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.importProfile(payload);

  handleResponse(args, res.ok, res.status, res.data, (data) => formatProfile(data.profile));
}

export async function profileInstallCommand(args: ParsedArgs): Promise<void> {
  const usage =
    'Usage: forge profile install <id> [--org-id <org>] [--org-policy-file <file>] [--mode <plan_only|apply_verify>]';
  const profileId = args.positional[0];
  if (!profileId) {
    output(usage);
    process.exitCode = 1;
    return;
  }

  const orgContext = resolveOrgContext(args, usage);
  if (!orgContext) {
    return;
  }

  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const mode = (getFlag(args, 'mode') ?? 'plan_only') as 'plan_only' | 'apply_verify';

  const res = await client.installProfile(profileId, {
    org_id: orgContext.orgId,
    org_policy: orgContext.orgPolicy,
    mode,
  });

  handleResponse(args, res.ok, res.status, res.data, (data) => {
    const response = data as ProfileInstallResponse;
    const lines: string[] = [];
    if (orgContext.defaultPolicyHint) {
      lines.push(orgContext.defaultPolicyHint);
      lines.push('');
    }
    lines.push(
      formatKeyValue([
        ['run_id', response.run.run_id],
        ['profile_id', response.run.profile_id],
        ['status', response.run.status],
        ['total_packages', String(response.run.total_packages)],
        ['succeeded_count', String(response.run.succeeded_count)],
        ['failed_count', String(response.run.failed_count)],
        ['skipped_count', String(response.run.skipped_count)],
        ['started_at', response.run.started_at],
        ['completed_at', response.run.completed_at ?? '-'],
      ])
    );

    if (response.plan_results.length > 0) {
      lines.push('');
      lines.push('Plan Results:');
      const rows = response.plan_results.map((p) => [
        p.plan_id ?? '-',
        p.package_id,
        String(p.install_order),
        p.status,
        p.error ?? '-',
      ]);
      lines.push(formatTable(['PLAN_ID', 'PACKAGE_ID', 'ORDER', 'STATUS', 'ERROR'], rows));
    }

    return lines.join('\n');
  });
}

// ── Health ──────────────────────────────────────────────────────────

export async function healthCommand(args: ParsedArgs): Promise<void> {
  const client = createClientFromArgs(args);
  if (!client) {
    return;
  }
  const res = await client.health();

  handleResponse(args, res.ok, res.status, res.data, (data) =>
    formatKeyValue([
      ['status', data.status],
      ['version', data.version ?? '-'],
    ])
  );
}
