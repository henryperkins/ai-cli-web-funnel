import { describe, expect, it } from 'vitest';
import { createLocalSupervisorHooks } from '../src/local-supervisor.js';

function buildRequest() {
  return {
    package_id: 'pkg-1',
    package_slug: 'acme/pkg-1',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'trusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [],
    policy_input: {
      org_id: 'org-1',
      package_id: 'pkg-1',
      requested_permissions: ['read:config'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: ['pkg-1'],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 3,
          disallowedPermissions: []
        }
      },
      enforcement: {
        package_id: 'pkg-1',
        state: 'none',
        reason_code: null,
        policy_blocked: false,
        source: 'none',
        updated_at: '2026-02-27T00:00:00Z'
      }
    }
  };
}

describe('local runtime supervisor hooks', () => {
  it('restarts with deterministic backoff and succeeds on later attempt', async () => {
    const events: string[] = [];
    const sleeps: number[] = [];

    const hooks = createLocalSupervisorHooks(
      {
        async launch(_request, attempt) {
          return {
            async healthCheck() {
              return true;
            },
            async waitForExit() {
              return {
                code: attempt === 1 ? 1 : 0,
                signal: null
              };
            }
          };
        }
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        emitEvent: (event) => {
          events.push(event.event_name);
        },
        now: () => new Date('2026-02-27T12:00:00Z')
      }
    );

    const request = buildRequest();
    expect(await hooks.preflight_checks(request)).toEqual({
      ok: true,
      details: ['local_stdio_preflight_ok']
    });
    expect(await hooks.start_or_connect(request)).toEqual({
      ok: true,
      details: ['local_stdio_start_ready']
    });

    const result = await hooks.supervise(request);
    expect(result).toEqual({
      ok: true,
      details: ['supervise_ok_attempt_2']
    });
    expect(sleeps).toEqual([100]);
    expect(events).toEqual([
      'server.policy_check',
      'server.start',
      'server.health_transition',
      'server.crash',
      'server.start',
      'server.health_transition'
    ]);
  });

  it('fails when max restart threshold is exceeded', async () => {
    const hooks = createLocalSupervisorHooks(
      {
        async launch() {
          return {
            async healthCheck() {
              return false;
            },
            async waitForExit() {
              return {
                code: 1,
                signal: null
              };
            }
          };
        }
      },
      {
        maxRestarts: 0,
        sleep: async () => {}
      }
    );

    const result = await hooks.supervise(buildRequest());
    expect(result.ok).toBe(false);
    expect(result.details[0]).toBe('supervise_failed_after_1_attempts');
  });
});
