export const EVENT_SCHEMA_VERSION_V1 = '1.0.0' as const;

export const BEHAVIORAL_EVENT_NAMES = [
  'search.query',
  'package.impression',
  'package.click',
  'package.action',
  'promoted.interaction'
] as const;

export const RUNTIME_EVENT_NAMES = [
  'server.start',
  'server.crash',
  'server.health_transition',
  'server.policy_check'
] as const;

export const TELEMETRY_EVENT_NAMES = [...BEHAVIORAL_EVENT_NAMES, ...RUNTIME_EVENT_NAMES] as const;

export type BehavioralEventName = (typeof BEHAVIORAL_EVENT_NAMES)[number];
export type RuntimeEventName = (typeof RUNTIME_EVENT_NAMES)[number];
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

export const PACKAGE_ACTION_TYPES = ['view_github', 'copy_install', 'bookmark', 'share'] as const;
export type PackageActionType = (typeof PACKAGE_ACTION_TYPES)[number];

export const PROMOTED_INTERACTION_TYPES = ['impression', 'click', 'action'] as const;
export type PromotedInteractionType = (typeof PROMOTED_INTERACTION_TYPES)[number];

export const RUNTIME_MODES = ['local', 'remote'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export const RUNTIME_TRANSPORTS = ['stdio', 'sse', 'streamable-http'] as const;
export type RuntimeTransport = (typeof RUNTIME_TRANSPORTS)[number];

export const RUNTIME_SCOPES = ['workspace', 'user_profile', 'daemon_default'] as const;
export type RuntimeScope = (typeof RUNTIME_SCOPES)[number];

export interface SearchQueryEventPayload {
  query: string;
  result_count?: number;
  promoted_result_count?: number;
  filters_applied?: string[];
}

export interface PackageImpressionEventPayload {
  package_id: string;
  position: number;
  is_promoted: boolean;
  organic_position?: number;
  final_position?: number;
}

export interface PackageClickEventPayload {
  package_id: string;
  position: number;
  is_promoted: boolean;
  organic_position?: number;
  final_position?: number;
}

export interface PackageActionEventPayload {
  package_id: string;
  action: PackageActionType;
  is_promoted: boolean;
  command_template_id?: string;
}

export interface PromotedInteractionEventPayload {
  package_id: string;
  interaction: PromotedInteractionType;
  campaign_id?: string;
  placement_id?: string;
  action?: PackageActionType;
}

export interface RuntimeBaseEventPayload {
  mode: RuntimeMode;
  adapter: string;
  scope: RuntimeScope;
  outcome: string;
  duration_ms: number;
  attempt: number;
  policy_block_reason?: string;
}

export interface ServerStartEventPayload extends RuntimeBaseEventPayload {
  transport: RuntimeTransport;
}

export interface ServerCrashEventPayload extends RuntimeBaseEventPayload {
  crash_signature_hash?: string;
  restart_scheduled: boolean;
}

export interface ServerHealthTransitionEventPayload extends RuntimeBaseEventPayload {
  previous_state: 'healthy' | 'degraded' | 'unhealthy';
  next_state: 'healthy' | 'degraded' | 'unhealthy';
}

export interface ServerPolicyCheckEventPayload extends RuntimeBaseEventPayload {
  policy_source: 'org_policy' | 'security_enforcement' | 'combined';
  blocked: boolean;
}

export interface TelemetryEventPayloadByName {
  'search.query': SearchQueryEventPayload;
  'package.impression': PackageImpressionEventPayload;
  'package.click': PackageClickEventPayload;
  'package.action': PackageActionEventPayload;
  'promoted.interaction': PromotedInteractionEventPayload;
  'server.start': ServerStartEventPayload;
  'server.crash': ServerCrashEventPayload;
  'server.health_transition': ServerHealthTransitionEventPayload;
  'server.policy_check': ServerPolicyCheckEventPayload;
}
