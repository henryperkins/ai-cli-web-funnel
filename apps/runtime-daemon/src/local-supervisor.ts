import type { RuntimeLifecycleHooks, RuntimeStartRequest } from './index.js';

export interface LocalSupervisorProcessHandle {
  waitForExit(): Promise<{ code: number | null; signal: string | null }>;
  healthCheck(): Promise<boolean>;
}

export interface LocalSupervisorProcessLauncher {
  launch(request: RuntimeStartRequest, attempt: number): Promise<LocalSupervisorProcessHandle>;
}

export interface RuntimeSupervisorEvent {
  event_name:
    | 'server.start'
    | 'server.crash'
    | 'server.health_transition'
    | 'server.policy_check';
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface LocalSupervisorOptions {
  maxRestarts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  emitEvent?: (event: RuntimeSupervisorEvent) => void | Promise<void>;
}

const DEFAULT_MAX_RESTARTS = 2;
const DEFAULT_INITIAL_BACKOFF_MS = 100;
const DEFAULT_MAX_BACKOFF_MS = 1_000;

function jitterFreeExponentialBackoff(
  attempt: number,
  initialBackoffMs: number,
  maxBackoffMs: number
): number {
  return Math.min(maxBackoffMs, initialBackoffMs * 2 ** Math.max(0, attempt - 1));
}

async function emit(
  now: () => Date,
  emitEvent: LocalSupervisorOptions['emitEvent'],
  event_name: RuntimeSupervisorEvent['event_name'],
  payload: Record<string, unknown>
) {
  if (!emitEvent) {
    return;
  }

  await emitEvent({
    event_name,
    occurred_at: now().toISOString(),
    payload
  });
}

export function createLocalSupervisorHooks(
  launcher: LocalSupervisorProcessLauncher,
  options: LocalSupervisorOptions = {}
): RuntimeLifecycleHooks {
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    async preflight_checks(request) {
      const ok = request.mode === 'local' && request.transport === 'stdio';
      await emit(
        now,
        options.emitEvent,
        'server.policy_check',
        {
          package_id: request.package_id,
          mode: request.mode,
          transport: request.transport,
          outcome: ok ? 'allowed' : 'blocked'
        }
      );

      return ok
        ? { ok: true, details: ['local_stdio_preflight_ok'] }
        : { ok: false, details: ['local_stdio_preflight_failed'] };
    },

    async start_or_connect(request) {
      if (request.mode !== 'local' || request.transport !== 'stdio') {
        return {
          ok: false,
          details: ['local_stdio_start_requires_local_mode']
        };
      }

      return {
        ok: true,
        details: ['local_stdio_start_ready']
      };
    },

    async health_validate() {
      return {
        ok: true,
        details: ['health_check_deferred_to_supervisor']
      };
    },

    async supervise(request) {
      for (let attempt = 1; attempt <= maxRestarts + 1; attempt += 1) {
        const handle = await launcher.launch(request, attempt);
        await emit(
          now,
          options.emitEvent,
          'server.start',
          {
            package_id: request.package_id,
            attempt,
            transport: request.transport
          }
        );

        const healthy = await handle.healthCheck();
        await emit(
          now,
          options.emitEvent,
          'server.health_transition',
          {
            package_id: request.package_id,
            attempt,
            state: healthy ? 'healthy' : 'unhealthy'
          }
        );

        const exit = await handle.waitForExit();

        if (exit.code === 0 && healthy) {
          return {
            ok: true,
            details: [`supervise_ok_attempt_${attempt}`]
          };
        }

        await emit(
          now,
          options.emitEvent,
          'server.crash',
          {
            package_id: request.package_id,
            attempt,
            exit_code: exit.code,
            signal: exit.signal
          }
        );

        if (attempt > maxRestarts) {
          return {
            ok: false,
            details: [`supervise_failed_after_${attempt}_attempts`]
          };
        }

        const backoffMs = jitterFreeExponentialBackoff(
          attempt,
          initialBackoffMs,
          maxBackoffMs
        );
        await sleep(backoffMs);
      }

      return {
        ok: false,
        details: ['supervise_failed']
      };
    }
  };
}
