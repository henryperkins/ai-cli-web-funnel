import {
  BEHAVIORAL_EVENT_NAMES,
  EVENT_SCHEMA_VERSION_V1,
  PACKAGE_ACTION_TYPES,
  RUNTIME_EVENT_NAMES,
  RUNTIME_SCOPES,
  RUNTIME_TRANSPORTS,
  TELEMETRY_EVENT_NAMES,
  type TelemetryEventName,
  type TelemetryEventPayloadByName
} from './event-types.js';
import {
  TELEMETRY_ACTOR_TYPES,
  TELEMETRY_CONSENT_STATES,
  TELEMETRY_DEVICE_CLASSES,
  TELEMETRY_USER_AGENT_FAMILIES,
  type AnyTelemetryEventEnvelope,
  type TelemetryEventEnvelope
} from './telemetry-envelope.js';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_UTC_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'ip',
  'ip_address',
  'client_ip',
  'fingerprint',
  'fingerprint_hash',
  'user_agent',
  'raw_user_agent',
  'install_command'
]);

export interface EventValidationIssue {
  field: string;
  code: 'missing' | 'invalid' | 'forbidden';
  message: string;
}

export interface EventValidationOptions {
  allowBehavioralEventsWhenConsentDenied?: boolean;
}

export interface EventValidationSuccess<TName extends TelemetryEventName> {
  ok: true;
  value: TelemetryEventEnvelope<TName>;
  issues: [];
}

export interface EventValidationFailure {
  ok: false;
  issues: EventValidationIssue[];
}

export type EventValidationResult<TName extends TelemetryEventName = TelemetryEventName> =
  | EventValidationSuccess<TName>
  | EventValidationFailure;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInSet<T extends string>(value: unknown, set: readonly T[]): value is T {
  return isString(value) && set.includes(value as T);
}

function collectForbiddenPayloadPaths(value: unknown, prefix = 'payload'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectForbiddenPayloadPaths(entry, `${prefix}[${index}]`));
  }

  if (!isObject(value)) {
    return [];
  }

  const paths: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${prefix}.${key}`;

    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      paths.push(nextPath);
    }

    paths.push(...collectForbiddenPayloadPaths(entry, nextPath));
  }

  return paths;
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

export function isIso8601Utc(value: string): boolean {
  return ISO_8601_UTC_REGEX.test(value) && !Number.isNaN(Date.parse(value));
}

function validateRuntimePayload(
  eventName: (typeof RUNTIME_EVENT_NAMES)[number],
  payload: Record<string, unknown>,
  issues: EventValidationIssue[]
): void {
  if (!isInSet(payload.mode, ['local', 'remote'] as const)) {
    issues.push({
      field: 'payload.mode',
      code: 'invalid',
      message: `${eventName} requires mode = local|remote.`
    });
  }

  if (!isString(payload.adapter) || payload.adapter.trim().length === 0) {
    issues.push({
      field: 'payload.adapter',
      code: 'missing',
      message: `${eventName} requires a non-empty adapter.`
    });
  }

  if (!isInSet(payload.scope, RUNTIME_SCOPES)) {
    issues.push({
      field: 'payload.scope',
      code: 'invalid',
      message: `${eventName} requires scope = workspace|user_profile|daemon_default.`
    });
  }

  if (!isString(payload.outcome) || payload.outcome.trim().length === 0) {
    issues.push({
      field: 'payload.outcome',
      code: 'missing',
      message: `${eventName} requires an outcome string.`
    });
  }

  if (!isNumber(payload.duration_ms) || payload.duration_ms < 0) {
    issues.push({
      field: 'payload.duration_ms',
      code: 'invalid',
      message: `${eventName} requires duration_ms >= 0.`
    });
  }

  if (!isNumber(payload.attempt) || !Number.isInteger(payload.attempt) || payload.attempt < 1) {
    issues.push({
      field: 'payload.attempt',
      code: 'invalid',
      message: `${eventName} requires attempt as integer >= 1.`
    });
  }

  if (eventName === 'server.start' && !isInSet(payload.transport, RUNTIME_TRANSPORTS)) {
    issues.push({
      field: 'payload.transport',
      code: 'invalid',
      message: 'server.start requires transport = stdio|sse|streamable-http.'
    });
  }
}

function validatePayload(
  eventName: TelemetryEventName,
  payload: unknown,
  options: EventValidationOptions,
  privacyConsentState: string,
  issues: EventValidationIssue[]
): void {
  if (!isObject(payload)) {
    issues.push({
      field: 'payload',
      code: 'invalid',
      message: 'payload must be an object.'
    });
    return;
  }

  const forbiddenPaths = collectForbiddenPayloadPaths(payload);
  for (const path of forbiddenPaths) {
    issues.push({
      field: path,
      code: 'forbidden',
      message: 'payload contains a forbidden field under privacy constraints.'
    });
  }

  if (
    privacyConsentState === 'denied' &&
    BEHAVIORAL_EVENT_NAMES.includes(eventName as (typeof BEHAVIORAL_EVENT_NAMES)[number]) &&
    !options.allowBehavioralEventsWhenConsentDenied
  ) {
    issues.push({
      field: 'privacy.consent_state',
      code: 'forbidden',
      message: 'behavioral events are rejected when consent_state=denied by default.'
    });
  }

  if (eventName === 'package.action') {
    const action = payload.action;
    if (!isInSet(action, PACKAGE_ACTION_TYPES)) {
      issues.push({
        field: 'payload.action',
        code: 'invalid',
        message: `package.action payload requires action in ${PACKAGE_ACTION_TYPES.join(', ')}.`
      });
    }

    if (action === 'copy_install') {
      const commandTemplateId = payload.command_template_id;
      if (!isString(commandTemplateId) || commandTemplateId.trim().length === 0) {
        issues.push({
          field: 'payload.command_template_id',
          code: 'missing',
          message: 'copy_install requires command_template_id under privacy policy.'
        });
      }
    }
  }

  if (RUNTIME_EVENT_NAMES.includes(eventName as (typeof RUNTIME_EVENT_NAMES)[number])) {
    validateRuntimePayload(eventName as (typeof RUNTIME_EVENT_NAMES)[number], payload, issues);
  }
}

export function validateTelemetryEventEnvelope<TName extends TelemetryEventName>(
  input: unknown,
  options: EventValidationOptions = {}
): EventValidationResult<TName> {
  const issues: EventValidationIssue[] = [];

  if (!isObject(input)) {
    return {
      ok: false,
      issues: [
        {
          field: 'event',
          code: 'invalid',
          message: 'event envelope must be an object.'
        }
      ]
    };
  }

  const eventNameValue = input.event_name;
  const eventName = isInSet(eventNameValue, TELEMETRY_EVENT_NAMES) ? eventNameValue : null;

  if (input.schema_version !== EVENT_SCHEMA_VERSION_V1) {
    issues.push({
      field: 'schema_version',
      code: 'invalid',
      message: `schema_version must be ${EVENT_SCHEMA_VERSION_V1}.`
    });
  }

  if (!eventName) {
    issues.push({
      field: 'event_name',
      code: 'invalid',
      message: `event_name must be one of: ${TELEMETRY_EVENT_NAMES.join(', ')}.`
    });
  }

  for (const key of ['event_id', 'request_id', 'session_id'] as const) {
    const value = input[key];
    if (!isString(value) || !isUuidV4(value)) {
      issues.push({
        field: key,
        code: 'invalid',
        message: `${key} must be a UUIDv4 string.`
      });
    }
  }

  for (const key of ['event_occurred_at', 'event_received_at'] as const) {
    const value = input[key];
    if (!isString(value) || !isIso8601Utc(value)) {
      issues.push({
        field: key,
        code: 'invalid',
        message: `${key} must be an ISO-8601 UTC timestamp.`
      });
    }
  }

  if (!isString(input.idempotency_key) || input.idempotency_key.trim().length < 8) {
    issues.push({
      field: 'idempotency_key',
      code: 'invalid',
      message: 'idempotency_key must be a non-empty stable string.'
    });
  }

  if (!isObject(input.actor)) {
    issues.push({
      field: 'actor',
      code: 'missing',
      message: 'actor is required.'
    });
  } else {
    if (!isString(input.actor.actor_id) || input.actor.actor_id.trim().length === 0) {
      issues.push({
        field: 'actor.actor_id',
        code: 'missing',
        message: 'actor.actor_id is required.'
      });
    }

    if (!isInSet(input.actor.actor_type, TELEMETRY_ACTOR_TYPES)) {
      issues.push({
        field: 'actor.actor_type',
        code: 'invalid',
        message: `actor.actor_type must be one of: ${TELEMETRY_ACTOR_TYPES.join(', ')}.`
      });
    }
  }

  let privacyConsentState = '';

  if (!isObject(input.privacy)) {
    issues.push({
      field: 'privacy',
      code: 'missing',
      message: 'privacy is required.'
    });
  } else {
    privacyConsentState = isString(input.privacy.consent_state) ? input.privacy.consent_state : '';

    if (!isInSet(input.privacy.consent_state, TELEMETRY_CONSENT_STATES)) {
      issues.push({
        field: 'privacy.consent_state',
        code: 'invalid',
        message: `privacy.consent_state must be one of: ${TELEMETRY_CONSENT_STATES.join(', ')}.`
      });
    }

    if (input.privacy.region !== null && !isString(input.privacy.region)) {
      issues.push({
        field: 'privacy.region',
        code: 'invalid',
        message: 'privacy.region must be string or null.'
      });
    }
  }

  if (!isObject(input.client)) {
    issues.push({
      field: 'client',
      code: 'missing',
      message: 'client is required.'
    });
  } else {
    if (!isInSet(input.client.app, ['web', 'runtime', 'adapter'] as const)) {
      issues.push({
        field: 'client.app',
        code: 'invalid',
        message: 'client.app must be web|runtime|adapter.'
      });
    }

    if (!isString(input.client.app_version) || input.client.app_version.trim().length === 0) {
      issues.push({
        field: 'client.app_version',
        code: 'missing',
        message: 'client.app_version is required.'
      });
    }

    if (!isInSet(input.client.user_agent_family, TELEMETRY_USER_AGENT_FAMILIES)) {
      issues.push({
        field: 'client.user_agent_family',
        code: 'invalid',
        message: `client.user_agent_family must be one of: ${TELEMETRY_USER_AGENT_FAMILIES.join(', ')}.`
      });
    }

    if (!isInSet(input.client.device_class, TELEMETRY_DEVICE_CLASSES)) {
      issues.push({
        field: 'client.device_class',
        code: 'invalid',
        message: `client.device_class must be one of: ${TELEMETRY_DEVICE_CLASSES.join(', ')}.`
      });
    }

    if (input.client.referrer_domain !== null && !isString(input.client.referrer_domain)) {
      issues.push({
        field: 'client.referrer_domain',
        code: 'invalid',
        message: 'client.referrer_domain must be string or null.'
      });
    }
  }

  if (eventName) {
    validatePayload(eventName, input.payload, options, privacyConsentState, issues);
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  return {
    ok: true,
    value: input as unknown as TelemetryEventEnvelope<TName>,
    issues: []
  };
}

export function assertTelemetryEventEnvelope<TName extends TelemetryEventName>(
  input: unknown,
  options: EventValidationOptions = {}
): TelemetryEventEnvelope<TName> {
  const validation = validateTelemetryEventEnvelope<TName>(input, options);
  if (!validation.ok) {
    const issueSummary = validation.issues
      .map((issue) => `${issue.field}:${issue.code}`)
      .join(', ');
    throw new Error(`Telemetry event validation failed: ${issueSummary}`);
  }

  return validation.value;
}

export function isTelemetryEventEnvelope(input: unknown): input is AnyTelemetryEventEnvelope {
  return validateTelemetryEventEnvelope(input).ok;
}

export function getEventPayload<TName extends TelemetryEventName>(
  event: TelemetryEventEnvelope<TName>
): TelemetryEventPayloadByName[TName] {
  return event.payload;
}
