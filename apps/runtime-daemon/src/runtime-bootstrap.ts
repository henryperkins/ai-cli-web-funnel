import type { ForgeFeatureFlags } from '@forge/shared-contracts';
import {
  createRuntimeStartPipeline,
  type RuntimeLifecycleHooks,
  type RuntimePolicyClient,
  type RuntimeStartRequest
} from './index.js';
import {
  createLocalSupervisorHooks,
  type LocalSupervisorOptions,
  type LocalSupervisorProcessLauncher
} from './local-supervisor.js';
import {
  createRemoteConnectors,
  type RemoteConnectorResolver,
  type RemoteProbeClient,
  type SecretRefResolver
} from './remote-connectors.js';
import type { OAuthClientCredentialsTokenClient } from './oauth-token-client.js';
import {
  writeScopeSidecar,
  type ScopeSidecarRecord,
  type ScopeSidecarWriteOptions
} from './scope-sidecar.js';

export interface RuntimeBootstrapLogger {
  log(event: {
    event_name: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  }): void | Promise<void>;
}

export interface RuntimeDaemonBootstrapDependencies {
  featureFlags: ForgeFeatureFlags;
  policyClient: RuntimePolicyClient;
  localSupervisorLauncher?: LocalSupervisorProcessLauncher;
  localSupervisorOptions?: LocalSupervisorOptions;
  remoteResolver?: RemoteConnectorResolver;
  secretResolver?: SecretRefResolver;
  remoteProbeClient?: RemoteProbeClient;
  oauthTokenClient?: OAuthClientCredentialsTokenClient;
  logger?: RuntimeBootstrapLogger;
}

export interface ScopeSidecarWriteGuardRequest {
  scope_hash: string;
  scope_daemon_owned: boolean;
  record: ScopeSidecarRecord;
  options?: ScopeSidecarWriteOptions;
}

export type ScopeSidecarWriteGuardResult =
  | {
      ok: true;
      reason_code: null;
      path: string;
      written: boolean;
      merged: boolean;
    }
  | {
      ok: false;
      reason_code:
        | 'runtime_scope_sidecar_ownership_disabled'
        | 'runtime_scope_not_daemon_owned';
      path: null;
      written: false;
      merged: false;
    };

function buildLifecycleHooks(
  dependencies: RuntimeDaemonBootstrapDependencies
): RuntimeLifecycleHooks {
  const runtimeFlags = dependencies.featureFlags.runtime;
  const localHooks =
    runtimeFlags.localSupervisorEnabled && dependencies.localSupervisorLauncher
      ? createLocalSupervisorHooks(
          dependencies.localSupervisorLauncher,
          dependencies.localSupervisorOptions
        )
      : null;

  return {
    async preflight_checks(request) {
      if (request.mode === 'local') {
        if (!runtimeFlags.localSupervisorEnabled) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_disabled']
          };
        }

        if (!localHooks) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_not_configured']
          };
        }

        return localHooks.preflight_checks(request);
      }

      return {
        ok: true,
        details: ['runtime_remote_preflight_ok']
      };
    },

    async start_or_connect(request) {
      if (request.mode === 'local') {
        if (!runtimeFlags.localSupervisorEnabled) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_disabled']
          };
        }

        if (!localHooks) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_not_configured']
          };
        }

        return localHooks.start_or_connect(request);
      }

      return {
        ok: true,
        details: ['runtime_remote_start_delegated']
      };
    },

    async health_validate(request) {
      if (request.mode === 'local') {
        if (!runtimeFlags.localSupervisorEnabled) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_disabled']
          };
        }

        if (!localHooks) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_not_configured']
          };
        }

        return localHooks.health_validate(request);
      }

      return {
        ok: true,
        details: ['runtime_remote_health_external']
      };
    },

    async supervise(request) {
      if (request.mode === 'local') {
        if (!runtimeFlags.localSupervisorEnabled) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_disabled']
          };
        }

        if (!localHooks) {
          return {
            ok: false,
            details: ['runtime_local_supervisor_not_configured']
          };
        }

        return localHooks.supervise(request);
      }

      return {
        ok: true,
        details: ['runtime_remote_supervision_external']
      };
    }
  };
}

export function createRuntimeDaemonBootstrap(
  dependencies: RuntimeDaemonBootstrapDependencies
) {
  const runtimeFlags = dependencies.featureFlags.runtime;
  let remoteConnectors: ReturnType<typeof createRemoteConnectors> | null = null;
  if (
    dependencies.remoteResolver &&
    dependencies.secretResolver &&
    dependencies.remoteProbeClient
  ) {
    remoteConnectors = createRemoteConnectors(
      dependencies.remoteResolver,
      dependencies.secretResolver,
      dependencies.remoteProbeClient,
      {
        ...(dependencies.oauthTokenClient
          ? { oauthTokenClient: dependencies.oauthTokenClient }
          : {}),
        ...(dependencies.logger ? { logger: dependencies.logger } : {})
      }
    );
  }

  const pipeline = createRuntimeStartPipeline(
    dependencies.policyClient,
    buildLifecycleHooks(dependencies),
    {
      async connect_sse(request) {
        if (!runtimeFlags.remoteSseEnabled) {
          return {
            ok: false,
            reason_code: 'remote_sse_hook_missing',
            details: ['runtime_remote_sse_disabled']
          };
        }

        if (!remoteConnectors?.connect_sse) {
          return {
            ok: false,
            reason_code: 'remote_sse_hook_missing',
            details: ['runtime_remote_sse_not_configured']
          };
        }

        return remoteConnectors.connect_sse(request);
      },

      async connect_streamable_http(request) {
        if (!runtimeFlags.remoteStreamableHttpEnabled) {
          return {
            ok: false,
            reason_code: 'remote_streamable_http_hook_missing',
            details: ['runtime_remote_streamable_http_disabled']
          };
        }

        if (!remoteConnectors?.connect_streamable_http) {
          return {
            ok: false,
            reason_code: 'remote_streamable_http_hook_missing',
            details: ['runtime_remote_streamable_http_not_configured']
          };
        }

        return remoteConnectors.connect_streamable_http(request);
      }
    }
  );

  return {
    async run(request: RuntimeStartRequest) {
      return pipeline.run(request);
    },

    async writeScopeSidecarGuarded(
      request: ScopeSidecarWriteGuardRequest
    ): Promise<ScopeSidecarWriteGuardResult> {
      if (!runtimeFlags.scopeSidecarOwnershipEnabled) {
        return {
          ok: false,
          reason_code: 'runtime_scope_sidecar_ownership_disabled',
          path: null,
          written: false,
          merged: false
        };
      }

      if (!request.scope_daemon_owned) {
        return {
          ok: false,
          reason_code: 'runtime_scope_not_daemon_owned',
          path: null,
          written: false,
          merged: false
        };
      }

      const result = await writeScopeSidecar(
        request.scope_hash,
        request.record,
        request.options
      );

      return {
        ok: true,
        reason_code: null,
        path: result.path,
        written: result.written,
        merged: result.merged
      };
    }
  };
}
