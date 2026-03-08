import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
  type FileHandle
} from 'node:fs/promises';
import type { PolicyPreflightInput, PolicyPreflightResult } from '@forge/policy-engine';

export type AdapterScope = 'workspace' | 'user_profile' | 'daemon_default';
export type AdapterTrustState =
  | 'untrusted'
  | 'trusted'
  | 'trust_expired'
  | 'denied'
  | 'policy_blocked';

export interface CopilotScopeDescriptor {
  scope: AdapterScope;
  scope_path: string;
  writable: boolean;
  approved: boolean;
  daemon_owned: boolean;
}

export interface CopilotServerEntry {
  package_id: string;
  package_slug: string;
  mode: 'local' | 'remote';
  transport: 'stdio' | 'sse' | 'streamable-http';
  trust_state: AdapterTrustState;
}

export interface CopilotPolicyPreflightClient {
  preflight(input: PolicyPreflightInput): Promise<PolicyPreflightResult>;
}

export interface CopilotLifecycleHooks {
  on_before_write(entry: CopilotServerEntry, scope: CopilotScopeDescriptor): Promise<void>;
  on_after_write(entry: CopilotServerEntry, scope: CopilotScopeDescriptor): Promise<void>;
  on_lifecycle(event: 'start' | 'stop' | 'restart', entry: CopilotServerEntry): Promise<void>;
  on_health_check(entry: CopilotServerEntry): Promise<{ healthy: boolean; details: string[] }>;
}

export interface CopilotRemoteModeHooks {
  remote_sse_probe?(endpoint: string): Promise<{ ok: boolean; details: string[] }>;
  remote_streamable_http_probe?(endpoint: string): Promise<{ ok: boolean; details: string[] }>;
}

export interface CopilotAdapterContract {
  discover_scopes(): Promise<CopilotScopeDescriptor[]>;
  read_entry(scope: CopilotScopeDescriptor, packageId: string): Promise<CopilotServerEntry | null>;
  write_entry(scope: CopilotScopeDescriptor, entry: CopilotServerEntry): Promise<void>;
  remove_entry(scope: CopilotScopeDescriptor, packageId: string): Promise<void>;
  policy_preflight(input: PolicyPreflightInput): Promise<PolicyPreflightResult>;
  lifecycle_hooks: CopilotLifecycleHooks;
  remote_hooks: CopilotRemoteModeHooks;
}

export type CopilotFilesystemErrorCode =
  | 'scope_not_daemon_owned'
  | 'scope_read_invalid_json'
  | 'scope_write_failed'
  | 'scope_write_rolled_back';

export class CopilotFilesystemAdapterError extends Error {
  constructor(
    public readonly code: CopilotFilesystemErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'CopilotFilesystemAdapterError';
  }
}

export interface CopilotAdapterFilesystemOptions {
  workspaceRoot?: string;
  userProfilePath?: string;
  daemonDefaultPath?: string;
  now?: () => Date;
  fs?: {
    access(path: string): Promise<void>;
    mkdir(path: string, options: { recursive: boolean }): Promise<void>;
    readFile(path: string, encoding: BufferEncoding): Promise<string>;
    writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
    open(path: string, flags: string, mode?: number): Promise<FileHandle>;
    rename(from: string, to: string): Promise<void>;
    rm(path: string, options?: { force?: boolean }): Promise<void>;
  };
}

interface CopilotScopeFile {
  schema_version: '1';
  managed_by: 'forge';
  updated_at: string;
  sidecar: {
    ownership_updated_at: string;
  };
  servers: CopilotServerEntry[];
}

interface ResolvedScopePath {
  scope: AdapterScope;
  scope_path: string;
}

interface CopilotScopeFileState {
  state: 'missing' | 'recoverable_empty' | 'forge_managed' | 'foreign';
  exists: boolean;
  daemon_owned: boolean;
  updated_at: string;
  ownership_updated_at: string;
  servers: CopilotServerEntry[];
}

const SCOPE_ORDER: AdapterScope[] = ['workspace', 'user_profile', 'daemon_default'];

export function orderCopilotScopeWrites(
  scopes: CopilotScopeDescriptor[]
): {
  ordered_writable: CopilotScopeDescriptor[];
  blocked: CopilotScopeDescriptor[];
} {
  const ordered = [...scopes].sort(
    (left, right) => SCOPE_ORDER.indexOf(left.scope) - SCOPE_ORDER.indexOf(right.scope)
  );

  return {
    ordered_writable: ordered.filter(
      (scope) => scope.writable && scope.approved && scope.daemon_owned
    ),
    blocked: ordered.filter(
      (scope) => !scope.writable || !scope.approved || !scope.daemon_owned
    )
  };
}

export function resolveAdapterTrustTransition(
  current: AdapterTrustState,
  policy: PolicyPreflightResult
): AdapterTrustState {
  if (policy.outcome === 'policy_blocked') {
    return 'policy_blocked';
  }

  if (current === 'denied') {
    return 'denied';
  }

  if (current === 'untrusted' || current === 'trust_expired') {
    return 'trusted';
  }

  return current;
}

function resolveScopePaths(options: CopilotAdapterFilesystemOptions): ResolvedScopePath[] {
  const resolved: ResolvedScopePath[] = [];

  if (options.workspaceRoot) {
    resolved.push({
      scope: 'workspace',
      scope_path: resolve(options.workspaceRoot, '.vscode/mcp.json')
    });
  }

  if (options.userProfilePath) {
    resolved.push({
      scope: 'user_profile',
      scope_path: resolve(options.userProfilePath)
    });
  }

  if (options.daemonDefaultPath) {
    resolved.push({
      scope: 'daemon_default',
      scope_path: resolve(options.daemonDefaultPath)
    });
  }

  return resolved;
}

function assertMutableScopeOwnership(
  scope: CopilotScopeDescriptor,
  state?: CopilotScopeFileState
): void {
  if (!scope.daemon_owned || state?.daemon_owned === false) {
    throw new CopilotFilesystemAdapterError(
      'scope_not_daemon_owned',
      `Scope ${scope.scope} is not daemon-owned and cannot be mutated.`
    );
  }
}

async function fileExists(fsOps: Required<CopilotAdapterFilesystemOptions>['fs'], path: string): Promise<boolean> {
  try {
    await fsOps.access(path);
    return true;
  } catch {
    return false;
  }
}

function isForgeManagedScopeRecord(record: Record<string, unknown>): boolean {
  if (record.managed_by !== 'forge' || record.schema_version !== '1') {
    return false;
  }

  if (typeof record.sidecar !== 'object' || record.sidecar === null) {
    return false;
  }

  const sidecar = record.sidecar as Record<string, unknown>;
  return (
    typeof sidecar.ownership_updated_at === 'string' &&
    sidecar.ownership_updated_at.trim().length > 0
  );
}

async function readScopeFile(
  fsOps: Required<CopilotAdapterFilesystemOptions>['fs'],
  scopePath: string,
  nowIso: string
): Promise<CopilotScopeFileState> {
  const exists = await fileExists(fsOps, scopePath);
  if (!exists) {
    return {
      state: 'missing',
      exists: false,
      daemon_owned: true,
      updated_at: nowIso,
      ownership_updated_at: nowIso,
      servers: []
    };
  }

  const content = await fsOps.readFile(scopePath, 'utf8');
  if (content.trim().length === 0) {
    return {
      state: 'recoverable_empty',
      exists: true,
      daemon_owned: true,
      updated_at: nowIso,
      ownership_updated_at: nowIso,
      servers: []
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new CopilotFilesystemAdapterError(
      'scope_read_invalid_json',
      `Scope file ${scopePath} contains invalid JSON.`,
      { cause: error }
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CopilotFilesystemAdapterError(
      'scope_read_invalid_json',
      `Scope file ${scopePath} must contain a JSON object.`
    );
  }

  const record = parsed as Record<string, unknown>;
  const daemonOwned = isForgeManagedScopeRecord(record);
  const servers = Array.isArray(record.servers)
    ? record.servers.filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          !Array.isArray(entry) &&
          typeof (entry as Record<string, unknown>).package_id === 'string'
      )
    : [];

  return {
    state: daemonOwned ? 'forge_managed' : 'foreign',
    exists: true,
    daemon_owned: daemonOwned,
    updated_at:
      typeof record.updated_at === 'string' && record.updated_at.trim().length > 0
        ? record.updated_at
        : nowIso,
    ownership_updated_at:
      daemonOwned &&
      typeof record.sidecar === 'object' &&
      record.sidecar !== null &&
      typeof (record.sidecar as Record<string, unknown>).ownership_updated_at === 'string'
        ? String((record.sidecar as Record<string, unknown>).ownership_updated_at)
        : nowIso,
    servers: servers as CopilotServerEntry[]
  };
}

async function writeFileAtomically(
  fsOps: Required<CopilotAdapterFilesystemOptions>['fs'],
  scopePath: string,
  payload: string
): Promise<void> {
  const directory = dirname(scopePath);
  const tempPath = `${scopePath}.tmp-${randomUUID()}`;
  const backupPath = `${scopePath}.bak-${randomUUID()}`;

  await fsOps.mkdir(directory, { recursive: true });

  const scopeExists = await fileExists(fsOps, scopePath);
  if (scopeExists) {
    const existing = await fsOps.readFile(scopePath, 'utf8');
    await fsOps.writeFile(backupPath, existing, 'utf8');
  }

  let tempHandle: FileHandle | null = null;

  try {
    tempHandle = await fsOps.open(tempPath, 'w', 0o644);
    await tempHandle.writeFile(payload, 'utf8');
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;

    await fsOps.rename(tempPath, scopePath);

    if (scopeExists) {
      await fsOps.rm(backupPath, { force: true });
    }
  } catch (error) {
    if (tempHandle) {
      await tempHandle.close().catch(() => undefined);
      tempHandle = null;
    }

    await fsOps.rm(tempPath, { force: true }).catch(() => undefined);

    if (scopeExists && (await fileExists(fsOps, backupPath))) {
      try {
        await fsOps.rename(backupPath, scopePath);
        throw new CopilotFilesystemAdapterError(
          'scope_write_rolled_back',
          `Write failed for ${scopePath}; previous file restored from backup.`,
          { cause: error }
        );
      } catch (rollbackError) {
        throw new CopilotFilesystemAdapterError(
          'scope_write_failed',
          `Write failed for ${scopePath} and rollback did not complete cleanly.`,
          { cause: rollbackError }
        );
      }
    }

    throw new CopilotFilesystemAdapterError(
      'scope_write_failed',
      `Write failed for ${scopePath}.`,
      { cause: error }
    );
  }
}

function toJson(payload: CopilotScopeFile): string {
  return JSON.stringify(payload, null, 2) + '\n';
}

function createScopeFilePayload(nowIso: string, servers: CopilotServerEntry[]): CopilotScopeFile {
  return {
    schema_version: '1',
    managed_by: 'forge',
    updated_at: nowIso,
    sidecar: {
      ownership_updated_at: nowIso
    },
    servers
  };
}

export function createCopilotVscodeAdapterContract(
  policyClient: CopilotPolicyPreflightClient,
  lifecycleHooks: CopilotLifecycleHooks,
  remoteHooks: CopilotRemoteModeHooks = {},
  options: CopilotAdapterFilesystemOptions = {}
): CopilotAdapterContract {
  const now = options.now ?? (() => new Date());
  const scopeLocks = new Map<string, Promise<void>>();
  const fsOps = {
    async access(path: string): Promise<void> {
      if (options.fs?.access) {
        await options.fs.access(path);
        return;
      }
      await access(path);
    },
    async mkdir(path: string, mkdirOptions: { recursive: boolean }): Promise<void> {
      if (options.fs?.mkdir) {
        await options.fs.mkdir(path, mkdirOptions);
        return;
      }
      await mkdir(path, { recursive: mkdirOptions.recursive });
    },
    async readFile(path: string, encoding: BufferEncoding): Promise<string> {
      if (options.fs?.readFile) {
        return options.fs.readFile(path, encoding);
      }
      return readFile(path, encoding);
    },
    async writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void> {
      if (options.fs?.writeFile) {
        await options.fs.writeFile(path, data, encoding);
        return;
      }
      await writeFile(path, data, encoding);
    },
    async open(path: string, flags: string, mode?: number): Promise<FileHandle> {
      if (options.fs?.open) {
        return options.fs.open(path, flags, mode);
      }
      return open(path, flags, mode);
    },
    async rename(from: string, to: string): Promise<void> {
      if (options.fs?.rename) {
        await options.fs.rename(from, to);
        return;
      }
      await rename(from, to);
    },
    async rm(path: string, optionsRm?: { force?: boolean }): Promise<void> {
      if (options.fs?.rm) {
        await options.fs.rm(path, optionsRm);
        return;
      }
      await rm(path, optionsRm);
    }
  } satisfies Required<CopilotAdapterFilesystemOptions>['fs'];

  const scopePaths = resolveScopePaths(options);

  async function withScopeLock<T>(scopePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = scopeLocks.get(scopePath) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const next = previous.catch(() => undefined).then(() => current);
    scopeLocks.set(scopePath, next);

    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release?.();
      if (scopeLocks.get(scopePath) === next) {
        scopeLocks.delete(scopePath);
      }
    }
  }

  return {
    async discover_scopes() {
      const nowIso = now().toISOString();
      const discovered: CopilotScopeDescriptor[] = [];

      for (const scopePath of scopePaths) {
        try {
          const state = await readScopeFile(fsOps, scopePath.scope_path, nowIso);
          discovered.push({
            scope: scopePath.scope,
            scope_path: scopePath.scope_path,
            writable: true,
            approved: true,
            daemon_owned: state.daemon_owned
          });
        } catch (error) {
          if (
            error instanceof CopilotFilesystemAdapterError &&
            error.code === 'scope_read_invalid_json'
          ) {
            discovered.push({
              scope: scopePath.scope,
              scope_path: scopePath.scope_path,
              writable: true,
              approved: true,
              daemon_owned: false
            });
            continue;
          }

          throw error;
        }
      }

      return discovered;
    },

    async read_entry(scope, packageId) {
      const nowIso = now().toISOString();
      const record = await readScopeFile(fsOps, scope.scope_path, nowIso);

      const entry = record.servers.find((candidate) => candidate.package_id === packageId);
      return entry ?? null;
    },

    async write_entry(scope, entry) {
      assertMutableScopeOwnership(scope);
      await lifecycleHooks.on_before_write(entry, scope);

      await withScopeLock(scope.scope_path, async () => {
        const nowIso = now().toISOString();
        const record = await readScopeFile(fsOps, scope.scope_path, nowIso);
        assertMutableScopeOwnership(scope, record);

        const existingWithoutTarget = record.servers.filter(
          (candidate) => candidate.package_id !== entry.package_id
        );

        const next = createScopeFilePayload(
          nowIso,
          [...existingWithoutTarget, entry].sort((left, right) =>
            left.package_id.localeCompare(right.package_id)
          )
        );

        await writeFileAtomically(fsOps, scope.scope_path, toJson(next));
      });
      await lifecycleHooks.on_after_write(entry, scope);
    },

    async remove_entry(scope, packageId) {
      assertMutableScopeOwnership(scope);

      await withScopeLock(scope.scope_path, async () => {
        const nowIso = now().toISOString();
        const record = await readScopeFile(fsOps, scope.scope_path, nowIso);
        if (!record.exists) {
          return;
        }

        assertMutableScopeOwnership(scope, record);

        const remaining = record.servers
          .filter((candidate) => candidate.package_id !== packageId)
          .sort((left, right) => left.package_id.localeCompare(right.package_id));

        if (remaining.length === record.servers.length) {
          return;
        }

        const next = createScopeFilePayload(nowIso, remaining);
        await writeFileAtomically(fsOps, scope.scope_path, toJson(next));
      });
    },

    async policy_preflight(input) {
      return policyClient.preflight(input);
    },

    lifecycle_hooks: lifecycleHooks,
    remote_hooks: remoteHooks
  };
}
