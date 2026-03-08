export interface DaemonEnvValidationResult {
  ok: boolean;
  errors: string[];
  port: number;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function validateDaemonStartupEnv(
  env: Record<string, string | undefined>
): DaemonEnvValidationResult {
  const errors: string[] = [];

  const rawPort = env.FORGE_DAEMON_PORT ?? '4100';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65_535) {
    errors.push('FORGE_DAEMON_PORT must be a valid port number (1-65535)');
  }

  const remoteSseEnabled = parseBoolean(env.FORGE_RUNTIME_REMOTE_SSE_ENABLED);
  if (remoteSseEnabled === null && env.FORGE_RUNTIME_REMOTE_SSE_ENABLED !== undefined) {
    errors.push('FORGE_RUNTIME_REMOTE_SSE_ENABLED must be one of 1,true,yes,on,0,false,no,off');
  }
  if (remoteSseEnabled && !hasValue(env.FORGE_RUNTIME_REMOTE_SSE_URL)) {
    errors.push('FORGE_RUNTIME_REMOTE_SSE_URL is required when remote SSE is enabled');
  }

  const remoteHttpEnabled = parseBoolean(env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED);
  if (
    remoteHttpEnabled === null &&
    env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED !== undefined
  ) {
    errors.push(
      'FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_ENABLED must be one of 1,true,yes,on,0,false,no,off'
    );
  }
  if (remoteHttpEnabled && !hasValue(env.FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL)) {
    errors.push(
      'FORGE_RUNTIME_REMOTE_STREAMABLE_HTTP_URL is required when remote streamable-HTTP is enabled'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    port: Number.isFinite(port) ? port : 4100
  };
}
