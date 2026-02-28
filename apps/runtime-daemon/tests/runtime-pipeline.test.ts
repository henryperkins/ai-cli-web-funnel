import { describe, expect, it } from 'vitest';
import {
  createRuntimeStartPipeline,
  evaluateTrustTransition,
  resolveRuntimeScopeWriteOrder
} from '../src/index.js';

function buildRequest() {
  return {
    package_id: 'pkg-1',
    package_slug: 'acme/pkg-1',
    mode: 'local' as const,
    transport: 'stdio' as const,
    trust_state: 'untrusted' as const,
    trust_reset_trigger: 'none' as const,
    scope_candidates: [
      {
        scope: 'user_profile' as const,
        scope_path: '/user',
        writable: true,
        approved: true,
        daemon_owned: true
      },
      {
        scope: 'workspace' as const,
        scope_path: '/ws',
        writable: true,
        approved: true,
        daemon_owned: true
      }
    ],
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

describe('runtime daemon contracts', () => {
  it('orders writable scopes workspace -> user_profile -> daemon_default', () => {
    const resolution = resolveRuntimeScopeWriteOrder([
      {
        scope: 'daemon_default',
        scope_path: '/daemon',
        writable: true,
        approved: true,
        daemon_owned: true
      },
      {
        scope: 'workspace',
        scope_path: '/workspace',
        writable: true,
        approved: true,
        daemon_owned: true
      },
      {
        scope: 'user_profile',
        scope_path: '/user',
        writable: true,
        approved: true,
        daemon_owned: true
      }
    ]);

    expect(resolution.ordered_writable_scopes.map((scope) => scope.scope)).toEqual([
      'workspace',
      'user_profile',
      'daemon_default'
    ]);
  });

  it('short-circuits pipeline when policy preflight blocks', async () => {
    const request = buildRequest();

    const pipeline = createRuntimeStartPipeline(
      {
        async preflight() {
          return {
            outcome: 'policy_blocked',
            install_allowed: false,
            runtime_allowed: false,
            reason_code: 'mcp_disabled_for_org',
            warnings: [],
            policy_blocked: true,
            blocked_by: 'org_policy'
          };
        }
      },
      {
        async preflight_checks() {
          throw new Error('should not execute');
        },
        async start_or_connect() {
          throw new Error('should not execute');
        },
        async health_validate() {
          throw new Error('should not execute');
        },
        async supervise() {
          throw new Error('should not execute');
        }
      }
    );

    const result = await pipeline.run(request);

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('policy_preflight_blocked');
    expect(result.final_trust_state).toBe('policy_blocked');
    expect(result.stages.map((stage) => stage.stage)).toEqual(['policy_preflight', 'trust_gate']);
  });

  it('evaluates trust transitions deterministically', () => {
    const blocked = evaluateTrustTransition('trusted', 'none', {
      outcome: 'policy_blocked',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: 'mcp_disabled_for_org',
      warnings: [],
      policy_blocked: true,
      blocked_by: 'org_policy'
    });

    const reset = evaluateTrustTransition('trusted', 'permission_escalation', {
      outcome: 'allowed',
      install_allowed: true,
      runtime_allowed: true,
      reason_code: null,
      warnings: [],
      policy_blocked: false,
      blocked_by: 'none'
    });

    expect(blocked).toBe('policy_blocked');
    expect(reset).toBe('trust_expired');
  });

  it('treats failed remote probes as not ready and records stage outcome', async () => {
    const request = {
      ...buildRequest(),
      mode: 'remote' as const,
      transport: 'sse' as const,
      trust_state: 'trusted' as const
    };

    const pipeline = createRuntimeStartPipeline(
      {
        async preflight() {
          return {
            outcome: 'allowed',
            install_allowed: true,
            runtime_allowed: true,
            reason_code: null,
            warnings: [],
            policy_blocked: false,
            blocked_by: 'none'
          };
        }
      },
      {
        async preflight_checks() {
          return { ok: true, details: ['preflight-ok'] };
        },
        async start_or_connect() {
          return { ok: true, details: ['start-ok'] };
        },
        async health_validate() {
          throw new Error('health check should not execute after failed remote probe');
        },
        async supervise() {
          throw new Error('supervise should not execute after failed remote probe');
        }
      },
      {
        async connect_sse() {
          return {
            ok: false,
            details: ['remote_probe_failed']
          };
        }
      }
    );

    const result = await pipeline.run(request);

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('remote_sse_probe_failed');
    expect(result.stages.map((stage) => stage.stage)).toEqual([
      'policy_preflight',
      'trust_gate',
      'preflight_checks',
      'start_or_connect',
      'remote_connect'
    ]);
    expect(result.stages[result.stages.length - 1]).toMatchObject({
      stage: 'remote_connect',
      ok: false,
      details: ['remote_probe_failed']
    });
  });

  it('maps missing remote hook to deterministic failure reason code', async () => {
    const request = {
      ...buildRequest(),
      mode: 'remote' as const,
      transport: 'streamable-http' as const,
      trust_state: 'trusted' as const
    };

    const pipeline = createRuntimeStartPipeline(
      {
        async preflight() {
          return {
            outcome: 'allowed',
            install_allowed: true,
            runtime_allowed: true,
            reason_code: null,
            warnings: [],
            policy_blocked: false,
            blocked_by: 'none'
          };
        }
      },
      {
        async preflight_checks() {
          return { ok: true, details: ['preflight-ok'] };
        },
        async start_or_connect() {
          return { ok: true, details: ['start-ok'] };
        },
        async health_validate() {
          throw new Error('health check should not execute with missing remote hook');
        },
        async supervise() {
          throw new Error('supervise should not execute with missing remote hook');
        }
      }
    );

    const result = await pipeline.run(request);

    expect(result.ready).toBe(false);
    expect(result.failure_reason_code).toBe('remote_streamable_http_hook_missing');
    expect(result.stages[result.stages.length - 1]).toMatchObject({
      stage: 'remote_connect',
      ok: false
    });
  });
});
