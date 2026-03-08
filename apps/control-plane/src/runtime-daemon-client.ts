import type { RuntimePipelineResult, RuntimeStartRequest } from '@forge/runtime-daemon';
import type { InstallRuntimeVerifier } from './install-lifecycle.js';

export interface RuntimeDaemonClientOptions {
  daemonUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function syntheticFailure(details: string): RuntimePipelineResult {
  return {
    ready: false,
    failure_reason_code: 'health_validate_failed',
    final_trust_state: 'untrusted',
    policy: {
      outcome: 'allowed',
      install_allowed: false,
      runtime_allowed: false,
      reason_code: null,
      warnings: [],
      policy_blocked: false,
      blocked_by: 'none'
    },
    scope_resolution: {
      ordered_writable_scopes: [],
      blocked_scopes: []
    },
    stages: [
      {
        stage: 'health_validate',
        ok: false,
        details: [details]
      }
    ]
  };
}

function buildVerifyUrl(daemonUrl: string): string {
  return new URL('/v1/runtime/verify', daemonUrl).toString();
}

export function createRuntimeDaemonClient(
  options: RuntimeDaemonClientOptions
): Pick<InstallRuntimeVerifier, 'run'> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async run(request: RuntimeStartRequest): Promise<RuntimePipelineResult> {
      const url = buildVerifyUrl(options.daemonUrl);

      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          return syntheticFailure(`daemon_unreachable:status=${response.status}`);
        }

        return (await response.json()) as RuntimePipelineResult;
      } catch (error) {
        return syntheticFailure(
          `daemon_unreachable:${error instanceof Error ? error.message : 'unknown'}`
        );
      }
    }
  };
}
