import process from 'node:process';
import {
  resolveFeatureFlags,
  type DeepPartial,
  type ForgeFeatureFlags
} from '@forge/shared-contracts';

export interface RuntimeFeatureFlagResolutionOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: DeepPartial<ForgeFeatureFlags>;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseOptionalBooleanEnv(
  key: string,
  env: NodeJS.ProcessEnv
): boolean | undefined {
  const raw = env[key];
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(
    `runtime_feature_flag_invalid:${key} expected one of 1,true,yes,on,0,false,no,off`
  );
}

function mergeFeatureFlagOverrides(
  base: DeepPartial<ForgeFeatureFlags> | undefined,
  runtime: DeepPartial<ForgeFeatureFlags['runtime']>
): DeepPartial<ForgeFeatureFlags> {
  return {
    ...(base ?? {}),
    runtime: {
      ...(base?.runtime ?? {}),
      ...runtime
    }
  };
}

export function resolveRuntimeFeatureFlagsFromEnv(
  options: RuntimeFeatureFlagResolutionOptions = {}
): ForgeFeatureFlags {
  const env = options.env ?? process.env;

  const runtimeOverrides: DeepPartial<ForgeFeatureFlags['runtime']> = {};

  const hardcodedPath = parseOptionalBooleanEnv(
    'FORGE_RUNTIME_HARDCODED_VSCODE_PROFILE_PATH',
    env
  );
  if (hardcodedPath !== undefined) {
    runtimeOverrides.hardcodedVsCodeProfilePath = hardcodedPath;
  }

  const localSupervisor = parseOptionalBooleanEnv(
    'FORGE_RUNTIME_LOCAL_SUPERVISOR_ENABLED',
    env
  );
  if (localSupervisor !== undefined) {
    runtimeOverrides.localSupervisorEnabled = localSupervisor;
  }

  const remoteSse = parseOptionalBooleanEnv('FORGE_RUNTIME_REMOTE_SSE_ENABLED', env);
  if (remoteSse !== undefined) {
    runtimeOverrides.remoteSseEnabled = remoteSse;
  }

  const remoteStreamableHttp = parseOptionalBooleanEnv(
    'FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED',
    env
  );
  if (remoteStreamableHttp !== undefined) {
    runtimeOverrides.remoteStreamableHttpEnabled = remoteStreamableHttp;
  }

  const scopeSidecar = parseOptionalBooleanEnv(
    'FORGE_RUNTIME_SCOPE_SIDECAR_OWNERSHIP_ENABLED',
    env
  );
  if (scopeSidecar !== undefined) {
    runtimeOverrides.scopeSidecarOwnershipEnabled = scopeSidecar;
  }

  return resolveFeatureFlags(mergeFeatureFlagOverrides(options.overrides, runtimeOverrides));
}
