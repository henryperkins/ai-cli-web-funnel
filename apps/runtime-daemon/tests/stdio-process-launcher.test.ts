import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStdioProcessLauncher } from '../src/stdio-process-launcher.js';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'echo-server.mjs');

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    package_id: 'pkg-test',
    package_slug: 'acme/test',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-test',
      requested_permissions: [],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-test'],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: 'pkg-test',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-03-01T00:00:00Z'
      }
    },
    process_command: {
      command: 'node',
      args: [FIXTURE_PATH]
    },
    ...overrides
  };
}

describe('stdio process launcher', () => {
  it('launches a process and returns a healthy handle', async () => {
    const launcher = createStdioProcessLauncher();
    const handle = await launcher.launch(buildRequest(), 1);

    expect(await handle.healthCheck()).toBe(true);

    const exit = await handle.waitForExit();
    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
  });

  it('returns unhealthy handle when command does not exist', async () => {
    const launcher = createStdioProcessLauncher();
    const handle = await launcher.launch(
      buildRequest({
        process_command: {
          command: '/nonexistent/binary',
          args: []
        }
      }),
      1
    );

    expect(await handle.healthCheck()).toBe(false);

    const exit = await handle.waitForExit();
    expect(exit.code).not.toBe(0);
  });

  it('returns unhealthy handle when process_command is missing', async () => {
    const launcher = createStdioProcessLauncher();
    const handle = await launcher.launch(
      buildRequest({
        process_command: undefined
      }),
      1
    );

    expect(await handle.healthCheck()).toBe(false);
    expect(await handle.waitForExit()).toEqual({
      code: 1,
      signal: null
    });
  });

  it('health check times out against a non-responding process', async () => {
    const launcher = createStdioProcessLauncher({
      healthCheckTimeoutMs: 200
    });
    const handle = await launcher.launch(
      buildRequest({
        process_command: {
          command: 'node',
          args: ['-e', 'setTimeout(() => {}, 10000)']
        }
      }),
      1
    );

    expect(await handle.healthCheck()).toBe(false);

    handle.kill();
    const exit = await handle.waitForExit();
    expect(exit.signal ?? exit.code).toBeTruthy();
  });
});
