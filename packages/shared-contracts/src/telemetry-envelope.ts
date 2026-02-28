import {
  EVENT_SCHEMA_VERSION_V1,
  type TelemetryEventName,
  type TelemetryEventPayloadByName
} from './event-types.js';

export const TELEMETRY_ACTOR_TYPES = ['anonymous', 'authenticated', 'verified_creator', 'sponsor'] as const;
export type TelemetryActorType = (typeof TELEMETRY_ACTOR_TYPES)[number];

export const TELEMETRY_CONSENT_STATES = ['granted', 'denied', 'not_required'] as const;
export type TelemetryConsentState = (typeof TELEMETRY_CONSENT_STATES)[number];

export const TELEMETRY_USER_AGENT_FAMILIES = ['chromium', 'webkit', 'gecko', 'other'] as const;
export type TelemetryUserAgentFamily = (typeof TELEMETRY_USER_AGENT_FAMILIES)[number];

export const TELEMETRY_DEVICE_CLASSES = ['desktop', 'tablet', 'mobile'] as const;
export type TelemetryDeviceClass = (typeof TELEMETRY_DEVICE_CLASSES)[number];

export interface TelemetryActor {
  actor_id: string;
  actor_type: TelemetryActorType;
}

export interface TelemetryPrivacyContext {
  consent_state: TelemetryConsentState;
  region: string | null;
}

export interface TelemetryClientContext {
  app: 'web' | 'runtime' | 'adapter';
  app_version: string;
  user_agent_family: TelemetryUserAgentFamily;
  device_class: TelemetryDeviceClass;
  referrer_domain: string | null;
}

export interface TelemetryEventEnvelope<TName extends TelemetryEventName = TelemetryEventName> {
  schema_version: typeof EVENT_SCHEMA_VERSION_V1;
  event_id: string;
  event_name: TName;
  event_occurred_at: string;
  event_received_at: string;
  idempotency_key: string;
  request_id: string;
  session_id: string;
  actor: TelemetryActor;
  privacy: TelemetryPrivacyContext;
  client: TelemetryClientContext;
  payload: TelemetryEventPayloadByName[TName];
}

export type AnyTelemetryEventEnvelope = TelemetryEventEnvelope<TelemetryEventName>;
