export interface ForgeFeatureFlags {
  product: {
    installNowEnabled: boolean;
    dualActionLocked: boolean;
  };
  ingest: {
    fullCatalogEnabled: boolean;
  };
  data: {
    useRegistryPackagesTable: boolean;
  };
  fraud: {
    strictThresholdsApproved: boolean;
  };
  security: {
    autoBlockAggressive: boolean;
    strictSignatureCanonicalization: boolean;
  };
  runtime: {
    hardcodedVsCodeProfilePath: boolean;
    localSupervisorEnabled: boolean;
    remoteSseEnabled: boolean;
    remoteStreamableHttpEnabled: boolean;
    scopeSidecarOwnershipEnabled: boolean;
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const defaultFeatureFlags: ForgeFeatureFlags = {
  product: {
    installNowEnabled: false,
    dualActionLocked: false
  },
  ingest: {
    fullCatalogEnabled: false
  },
  data: {
    useRegistryPackagesTable: true
  },
  fraud: {
    strictThresholdsApproved: false
  },
  security: {
    autoBlockAggressive: false,
    strictSignatureCanonicalization: true
  },
  runtime: {
    hardcodedVsCodeProfilePath: false,
    localSupervisorEnabled: false,
    remoteSseEnabled: false,
    remoteStreamableHttpEnabled: false,
    scopeSidecarOwnershipEnabled: false
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, overrides: DeepPartial<T>): T {
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = output[key];

    if (isObject(baseValue) && isObject(overrideValue)) {
      output[key] = mergeDeep(baseValue, overrideValue);
      continue;
    }

    if (overrideValue !== undefined) {
      output[key] = overrideValue;
    }
  }

  return output as T;
}

export function resolveFeatureFlags(overrides: DeepPartial<ForgeFeatureFlags> = {}): ForgeFeatureFlags {
  return mergeDeep(defaultFeatureFlags, overrides);
}
