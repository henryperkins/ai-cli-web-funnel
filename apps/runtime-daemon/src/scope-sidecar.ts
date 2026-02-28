import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ScopeSidecarRecord {
  managed_by: string;
  client: string;
  scope_path: string;
  entry_keys: string[];
  checksum: string;
  last_applied_at: string;
}

export interface ScopeSidecarWriteOptions {
  baseDir?: string;
  owner?: string;
  allowMerge?: boolean;
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? join(homedir(), '.forge', 'runtime', 'scopes');
}

export function getScopeSidecarPath(scopeHash: string, baseDir?: string): string {
  return join(resolveBaseDir(baseDir), `${scopeHash}.json`);
}

export async function readScopeSidecar(
  scopeHash: string,
  baseDir?: string
): Promise<ScopeSidecarRecord | null> {
  const path = getScopeSidecarPath(scopeHash, baseDir);

  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as ScopeSidecarRecord;
  } catch {
    return null;
  }
}

export async function writeScopeSidecar(
  scopeHash: string,
  record: ScopeSidecarRecord,
  options: ScopeSidecarWriteOptions = {}
): Promise<{ path: string; written: boolean; merged: boolean }> {
  const path = getScopeSidecarPath(scopeHash, options.baseDir);
  const expectedOwner = options.owner ?? 'runtime-daemon';
  const existing = await readScopeSidecar(scopeHash, options.baseDir);

  if (existing && existing.managed_by !== expectedOwner && !options.allowMerge) {
    throw new Error('sidecar_ownership_conflict');
  }

  const payload: ScopeSidecarRecord =
    existing && options.allowMerge
      ? {
          ...existing,
          ...record,
          entry_keys: [...new Set([...(existing.entry_keys ?? []), ...record.entry_keys])]
        }
      : record;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  return {
    path,
    written: true,
    merged: Boolean(existing && options.allowMerge)
  };
}
