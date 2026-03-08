import { describe, expect, it } from 'vitest';
import { createProcessRegistry } from '../src/daemon-main.js';

describe('process registry', () => {
  it('tracks and stops supervised processes', async () => {
    const registry = createProcessRegistry();

    const killed: string[] = [];
    registry.register('pkg-1', {
      kill() {
        killed.push('pkg-1');
      }
    });
    registry.register('pkg-2', {
      kill() {
        killed.push('pkg-2');
      }
    });

    expect(registry.getStatus('pkg-1')).toMatchObject({
      package_id: 'pkg-1',
      state: 'running'
    });
    expect(registry.getStatus('unknown')).toBeNull();

    await registry.stop('pkg-1');
    expect(killed).toEqual(['pkg-1']);
    expect(registry.getStatus('pkg-1')).toBeNull();

    await registry.shutdownAll();
    expect(killed).toEqual(['pkg-1', 'pkg-2']);
  });
});
