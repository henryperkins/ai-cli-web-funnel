import {
  EVENT_SCHEMA_VERSION_V1,
  type AnyTelemetryEventEnvelope,
  type FraudOutcome,
  type EventValidationIssue,
  validateTelemetryEventEnvelope
} from '@forge/shared-contracts';

export interface IngestionRequest {
  method: 'POST';
  path: '/v1/events';
  headers: Record<string, string | undefined>;
  body: unknown;
  received_at?: string;
}

export interface IngestionContext {
  request_id: string;
  received_at: string;
}

export interface IdempotencyRecord {
  scope: string;
  idempotency_key: string;
  request_hash: string;
  response_code: number;
  response_body: IngestionResult;
  stored_at: string;
}

export interface IdempotencyAdapter {
  get(scope: string, idempotencyKey: string): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord): Promise<void>;
}

export interface RawEventPersistenceResult {
  raw_event_id: string;
  persisted_at: string;
}

export interface IngestionPersistenceAdapter {
  appendRawEvent(event: AnyTelemetryEventEnvelope, context: IngestionContext): Promise<RawEventPersistenceResult>;
}

export interface FraudFlagEvaluation {
  outcome: FraudOutcome;
  rule_code: string;
  reason_code: string;
  metadata: Record<string, unknown>;
}

export interface FraudFlagPipelineAdapter {
  evaluate(event: AnyTelemetryEventEnvelope): Promise<FraudFlagEvaluation[]>;
  recordEvaluations?(
    rawEventId: string,
    event: AnyTelemetryEventEnvelope,
    evaluations: FraudFlagEvaluation[],
    persistedAt: string
  ): Promise<void>;
}

export interface IngestionDependencies {
  idempotency: IdempotencyAdapter;
  persistence: IngestionPersistenceAdapter;
  fraudPipeline?: FraudFlagPipelineAdapter;
  outboxPublisher?: IngestionOutboxPublisher;
}

export interface IngestionOutboxEnvelope {
  event_type:
    | 'fraud.reconcile.requested'
    | 'ranking.sync.requested'
    | 'metrics.aggregate.requested';
  dedupe_key: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface IngestionOutboxPublisher {
  publish(envelope: IngestionOutboxEnvelope): Promise<void>;
}

export interface IngestionAcceptedResult {
  status: 'accepted';
  event_id: string;
  raw_event_id: string;
  idempotency_key: string;
  fraud_evaluations: FraudFlagEvaluation[];
}

export interface IngestionReplayResult {
  status: 'replayed';
  event_id: string;
  idempotency_key: string;
  previous_response_code: number;
  previous_response_body: IngestionResult;
}

export interface IngestionConflictResult {
  status: 'conflict';
  event_id: string;
  idempotency_key: string;
  reason: 'idempotency_key_reused_with_different_payload';
}

export interface IngestionRejectedResult {
  status: 'rejected';
  reason: 'invalid_request' | 'invalid_event';
  issues: EventValidationIssue[];
}

export type IngestionResult =
  | IngestionAcceptedResult
  | IngestionReplayResult
  | IngestionConflictResult
  | IngestionRejectedResult;

const EVENT_INGESTION_SCOPE = 'POST:/v1/events';

function normalizeHeaders(
  headers: Record<string, string | undefined>
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[key.toLowerCase()] = value;
    }
  }

  return normalized;
}

function normalizeBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>) };
  }

  return null;
}

function getPackageIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const packageId = (payload as Record<string, unknown>).package_id;
  return typeof packageId === 'string' ? packageId : null;
}

function getRequestHash(event: AnyTelemetryEventEnvelope): string {
  return [
    event.event_id,
    event.idempotency_key,
    event.event_occurred_at,
    event.event_name,
    event.request_id
  ].join(':');
}

function normalizeIncomingEvent(request: IngestionRequest): Record<string, unknown> | null {
  const body = normalizeBody(request.body);
  if (!body) {
    return null;
  }

  const headers = normalizeHeaders(request.headers);
  const normalized: Record<string, unknown> = {
    ...body,
    schema_version: body.schema_version ?? EVENT_SCHEMA_VERSION_V1,
    event_received_at:
      body.event_received_at ??
      request.received_at ??
      headers['x-event-received-at'] ??
      new Date().toISOString()
  };

  if (!normalized.request_id && headers['x-request-id']) {
    normalized.request_id = headers['x-request-id'];
  }

  return normalized;
}

export function createEventIngestionEntrypoint(dependencies: IngestionDependencies) {
  return {
    async ingest(request: IngestionRequest): Promise<IngestionResult> {
      if (request.method !== 'POST' || request.path !== '/v1/events') {
        return {
          status: 'rejected',
          reason: 'invalid_request',
          issues: [
            {
              field: 'request',
              code: 'invalid',
              message: 'Only POST /v1/events is supported by this ingestion entrypoint.'
            }
          ]
        };
      }

      const normalizedBody = normalizeIncomingEvent(request);
      if (!normalizedBody) {
        return {
          status: 'rejected',
          reason: 'invalid_request',
          issues: [
            {
              field: 'body',
              code: 'invalid',
              message: 'Request body must be a JSON object.'
            }
          ]
        };
      }

      const validation = validateTelemetryEventEnvelope(normalizedBody);
      if (!validation.ok) {
        return {
          status: 'rejected',
          reason: 'invalid_event',
          issues: validation.issues
        };
      }

      const event = validation.value;
      const requestHash = getRequestHash(event);
      const existing = await dependencies.idempotency.get(EVENT_INGESTION_SCOPE, event.idempotency_key);

      if (existing) {
        if (existing.request_hash !== requestHash) {
          return {
            status: 'conflict',
            event_id: event.event_id,
            idempotency_key: event.idempotency_key,
            reason: 'idempotency_key_reused_with_different_payload'
          };
        }

        return {
          status: 'replayed',
          event_id: event.event_id,
          idempotency_key: event.idempotency_key,
          previous_response_code: existing.response_code,
          previous_response_body: existing.response_body
        };
      }

      const context: IngestionContext = {
        request_id: event.request_id,
        received_at: event.event_received_at
      };

      const persisted = await dependencies.persistence.appendRawEvent(event, context);

      const accepted: IngestionAcceptedResult = {
        status: 'accepted',
        event_id: event.event_id,
        raw_event_id: persisted.raw_event_id,
        idempotency_key: event.idempotency_key,
        fraud_evaluations: dependencies.fraudPipeline
          ? await dependencies.fraudPipeline.evaluate(event)
          : []
      };

      if (dependencies.fraudPipeline?.recordEvaluations) {
        await dependencies.fraudPipeline.recordEvaluations(
          persisted.raw_event_id,
          event,
          accepted.fraud_evaluations,
          persisted.persisted_at
        );
      }

      await dependencies.idempotency.put({
        scope: EVENT_INGESTION_SCOPE,
        idempotency_key: event.idempotency_key,
        request_hash: requestHash,
        response_code: 202,
        response_body: accepted,
        stored_at: persisted.persisted_at
      });

      if (dependencies.outboxPublisher) {
        const dedupeBase = `${event.event_id}:${event.idempotency_key}`;
        await dependencies.outboxPublisher.publish({
          event_type: 'fraud.reconcile.requested',
          dedupe_key: `${dedupeBase}:fraud`,
          payload: {
            event_id: event.event_id,
            raw_event_id: accepted.raw_event_id,
            package_id: getPackageIdFromPayload(event.payload)
          },
          occurred_at: persisted.persisted_at
        });

        await dependencies.outboxPublisher.publish({
          event_type: 'ranking.sync.requested',
          dedupe_key: `${dedupeBase}:ranking`,
          payload: {
            event_id: event.event_id,
            raw_event_id: accepted.raw_event_id
          },
          occurred_at: persisted.persisted_at
        });
      }

      return accepted;
    }
  };
}

export * from './http-app.js';
export * from './catalog-routes.js';
export * from './install-lifecycle.js';
export * from './server.js';
