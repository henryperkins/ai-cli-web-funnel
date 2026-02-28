import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readScopeSidecar,
  writeScopeSidecar
} from '../src/scope-sidecar.js';

describe('scope sidecar ownership metadata', () => {
  it('writes and reads sidecar metadata under scope hash path', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'forge-sidecar-'));

    await writeScopeSidecar(
      'scope-hash-1',
      {
        managed_by: 'runtime-daemon',
        client: 'vscode',
        scope_path: '/workspace/.forge',
        entry_keys: ['a', 'b'],
        checksum: 'checksum-1',
        last_applied_at: '2026-02-27T12:00:00Z'
      },
      {
        baseDir
      }
    );

    const read = await readScopeSidecar('scope-hash-1', baseDir);
    expect(read).toEqual({
      managed_by: 'runtime-daemon',
      client: 'vscode',
      scope_path: '/workspace/.forge',
      entry_keys: ['a', 'b'],
      checksum: 'checksum-1',
      last_applied_at: '2026-02-27T12:00:00Z'
    });
  });

  it('rejects overwrite when existing sidecar is not daemon-owned', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'forge-sidecar-'));

    await writeScopeSidecar(
      'scope-hash-2',
      {
        managed_by: 'manual',
        client: 'cli',
        scope_path: '/workspace/.forge',
        entry_keys: ['manual-entry'],
        checksum: 'checksum-manual',
        last_applied_at: '2026-02-27T11:00:00Z'
      },
      {
        baseDir,
        owner: 'manual'
      }
    );

    await expect(
      writeScopeSidecar(
        'scope-hash-2',
        {
          managed_by: 'runtime-daemon',
          client: 'vscode',
          scope_path: '/workspace/.forge',
          entry_keys: ['daemon-entry'],
          checksum: 'checksum-daemon',
          last_applied_at: '2026-02-27T12:00:00Z'
        },
        {
          baseDir,
          owner: 'runtime-daemon'
        }
      )
    ).rejects.toThrow('sidecar_ownership_conflict');
  });
});
