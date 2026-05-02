import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface DefaultOrgPolicy {
  mcp_enabled: boolean;
  server_allowlist: string[];
  block_flagged: boolean;
  permission_caps: {
    maxPermissions: number;
    disallowedPermissions: string[];
  };
}

export interface ForgeUserConfig {
  readonly org_id?: string;
  readonly control_plane_url?: string;
  readonly org_policy?: DefaultOrgPolicy;
}

export interface LoadedForgeUserConfig {
  readonly path: string;
  readonly exists: boolean;
  readonly config: ForgeUserConfig | null;
}

export type ForgeUserConfigField = keyof ForgeUserConfig;

export interface LoadUserConfigOptions {
  readonly fields?: readonly ForgeUserConfigField[];
}

export interface ConfigPathOptions {
  readonly explicitPath?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly homeDir?: string | undefined;
}

export interface WriteUserConfigOptions {
  readonly force?: boolean;
}

export const DEFAULT_CONTROL_PLANE_URL = 'http://localhost:8787';

export const DEFAULT_SOLO_ORG_POLICY: DefaultOrgPolicy = {
  mcp_enabled: true,
  server_allowlist: [],
  block_flagged: true,
  permission_caps: {
    maxPermissions: 10,
    disallowedPermissions: [],
  },
};

const SOLO_ORG_NAMESPACE = '5bf3e6ab-93d6-4f53-a0d8-4c3b9f9a7a90';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }

  const compact = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const hash = createHash('sha1').update(namespaceBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  const byte6 = bytes.at(6);
  const byte8 = bytes.at(8);
  if (byte6 === undefined || byte8 === undefined) {
    throw new Error('Failed to construct UUIDv5 bytes.');
  }
  bytes[6] = (byte6 & 0x0f) | 0x50;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return null;
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return null;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function configError(configPath: string, message: string): Error {
  return new Error(`Invalid Forge config at ${configPath}: ${message}`);
}

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  const explicitPath = nonEmptyString(options.explicitPath);
  if (explicitPath) {
    return explicitPath;
  }

  const forgeConfig = nonEmptyString(env['FORGE_CONFIG']);
  if (forgeConfig) {
    return forgeConfig;
  }

  const xdgConfigHome = nonEmptyString(env['XDG_CONFIG_HOME']);
  if (xdgConfigHome) {
    return join(xdgConfigHome, 'forge', 'config.json');
  }

  return join(options.homeDir ?? homedir(), '.forge', 'config.json');
}

export function defaultOrgId(homeDir = homedir()): string {
  const stableInput = nonEmptyString(homeDir) ?? 'unknown-home';
  return uuidv5(`forge-cli:solo-org:${stableInput}`, SOLO_ORG_NAMESPACE);
}

export function validateControlPlaneUrl(value: string, label = 'control_plane_url'): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty URL.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must be an absolute http(s) URL.`);
  }

  return trimmed;
}

export function normalizeOrgPolicy(value: unknown): DefaultOrgPolicy | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const permissionCaps = asRecord(record['permission_caps']);
  if (
    typeof record['mcp_enabled'] !== 'boolean' ||
    !Array.isArray(record['server_allowlist']) ||
    typeof record['block_flagged'] !== 'boolean' ||
    !permissionCaps ||
    !Number.isInteger(permissionCaps['maxPermissions']) ||
    Number(permissionCaps['maxPermissions']) < 0
  ) {
    return null;
  }

  const serverAllowlist = asStringArray(record['server_allowlist']);
  const disallowedPermissions = asStringArray(permissionCaps['disallowedPermissions']);
  if (!serverAllowlist || !disallowedPermissions) {
    return null;
  }

  return {
    mcp_enabled: record['mcp_enabled'],
    server_allowlist: serverAllowlist,
    block_flagged: record['block_flagged'],
    permission_caps: {
      maxPermissions: Number(permissionCaps['maxPermissions']),
      disallowedPermissions,
    },
  };
}

function shouldNormalizeField(
  fields: readonly ForgeUserConfigField[] | undefined,
  field: ForgeUserConfigField
): boolean {
  return fields === undefined || fields.includes(field);
}

export function loadOrgPolicyFile(filePath: string): DefaultOrgPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    throw new Error(`Failed to read org policy file: ${filePath}`);
  }

  const orgPolicy = normalizeOrgPolicy(parsed);
  if (!orgPolicy) {
    throw new Error(`Invalid org policy file: ${filePath}`);
  }

  return orgPolicy;
}

export function normalizeUserConfig(
  value: unknown,
  configPath: string,
  fields?: readonly ForgeUserConfigField[]
): ForgeUserConfig {
  const record = asRecord(value);
  if (!record) {
    throw configError(configPath, 'expected a JSON object.');
  }

  const config: {
    org_id?: string;
    control_plane_url?: string;
    org_policy?: DefaultOrgPolicy;
  } = {};

  if (shouldNormalizeField(fields, 'org_id') && Object.hasOwn(record, 'org_id')) {
    if (typeof record['org_id'] !== 'string') {
      throw configError(configPath, 'org_id must be a non-empty string.');
    }

    const orgId = record['org_id'].trim();
    if (orgId.length === 0) {
      throw configError(configPath, 'org_id must be a non-empty string.');
    }
    config.org_id = orgId;
  }

  if (shouldNormalizeField(fields, 'control_plane_url') && Object.hasOwn(record, 'control_plane_url')) {
    if (typeof record['control_plane_url'] !== 'string') {
      throw configError(configPath, 'control_plane_url must be a non-empty URL.');
    }

    try {
      config.control_plane_url = validateControlPlaneUrl(record['control_plane_url']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw configError(configPath, message);
    }
  }

  if (shouldNormalizeField(fields, 'org_policy') && Object.hasOwn(record, 'org_policy')) {
    const orgPolicy = normalizeOrgPolicy(record['org_policy']);
    if (!orgPolicy) {
      throw configError(configPath, 'org_policy is invalid.');
    }
    config.org_policy = orgPolicy;
  }

  return config;
}

export function loadUserConfig(
  configPath = resolveConfigPath(),
  options: LoadUserConfigOptions = {}
): LoadedForgeUserConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
    if (code === 'ENOENT') {
      return { path: configPath, exists: false, config: null };
    }

    throw new Error(`Failed to read Forge config at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw configError(configPath, 'expected valid JSON.');
  }

  return { path: configPath, exists: true, config: normalizeUserConfig(parsed, configPath, options.fields) };
}

export function writeUserConfig(
  configPath: string,
  config: ForgeUserConfig,
  options: WriteUserConfigOptions = {}
): void {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const serialized = JSON.stringify(config, null, 2) + '\n';

  try {
    writeFileSync(configPath, serialized, {
      encoding: 'utf-8',
      mode: 0o600,
      flag: options.force ? 'w' : 'wx',
    });
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
    if (code === 'EEXIST') {
      throw new Error(`Forge config already exists at ${configPath}. Re-run with --force to overwrite.`);
    }

    throw new Error(`Failed to write Forge config at ${configPath}`);
  }

  try {
    chmodSync(configPath, 0o600);
  } catch {
    // Best effort: chmod may be unavailable on some filesystems.
  }
}
