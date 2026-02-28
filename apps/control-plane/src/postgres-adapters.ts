import type { AnyTelemetryEventEnvelope } from '@forge/shared-contracts';
import type {
  FraudFlagEvaluation,
  FraudFlagPipelineAdapter,
  IdempotencyAdapter,
  IdempotencyRecord,
  IngestionPersistenceAdapter,
  IngestionOutboxPublisher,
  IngestionOutboxEnvelope,
  IngestionResult
} from './index.js';

export interface PostgresQueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface PostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresIdempotencyAdapterOptions {
  db: PostgresQueryExecutor;
}

export interface PostgresIngestionPersistenceAdapterOptions {
  db: PostgresQueryExecutor;
}

export interface FraudEvaluationEngine {
  evaluate(event: AnyTelemetryEventEnvelope): Promise<FraudFlagEvaluation[]>;
}

export interface PostgresFraudFlagPipelineOptions {
  db: PostgresQueryExecutor;
  evaluator?: FraudEvaluationEngine;
  flagSource?: 'rt_fraud' | 'daily_fraud' | 'security_governance' | 'manual_review';
}

export interface PostgresOutboxPublisherOptions {
  db: PostgresQueryExecutor;
  sourceService?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIngestionResult(value: unknown): value is IngestionResult {
  if (!isObject(value)) {
    return false;
  }

  const status = value.status;
  return (
    status === 'accepted' ||
    status === 'replayed' ||
    status === 'conflict' ||
    status === 'rejected'
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function getPackageIdFromPayload(event: AnyTelemetryEventEnvelope): string | null {
  const packageId = isObject(event.payload) ? event.payload.package_id : undefined;
  return typeof packageId === 'string' && isUuid(packageId) ? packageId : null;
}

function parseResponseBody(value: unknown): IngestionResult {
  if (isIngestionResult(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isIngestionResult(parsed)) {
        return parsed;
      }
    } catch {
      return {
        status: 'rejected',
        reason: 'invalid_request',
        issues: [
          {
            field: 'idempotency',
            code: 'invalid',
            message: 'Stored idempotency response payload is invalid JSON.'
          }
        ]
      };
    }
  }

  return {
    status: 'rejected',
    reason: 'invalid_request',
    issues: [
      {
        field: 'idempotency',
        code: 'invalid',
        message: 'Stored idempotency response payload is not an object.'
      }
    ]
  };
}

export function createPostgresIdempotencyAdapter(
  options: PostgresIdempotencyAdapterOptions
): IdempotencyAdapter {
  return {
    async get(scope, idempotencyKey) {
      const result = await options.db.query<{
        scope: string;
        idempotency_key: string;
        request_hash: string;
        response_code: number;
        response_body: unknown;
        stored_at: string;
      }>(
        `
          SELECT
            scope,
            idempotency_key,
            request_hash,
            response_code,
            response_body,
            stored_at::text AS stored_at
          FROM ingestion_idempotency_records
          WHERE scope = $1 AND idempotency_key = $2
          LIMIT 1
        `,
        [scope, idempotencyKey]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      const parsed = parseResponseBody(row.response_body);

      return {
        scope: row.scope,
        idempotency_key: row.idempotency_key,
        request_hash: row.request_hash,
        response_code: row.response_code,
        response_body: parsed,
        stored_at: row.stored_at
      } satisfies IdempotencyRecord;
    },

    async put(record) {
      const result = await options.db.query<{ request_hash: string }>(
        `
          INSERT INTO ingestion_idempotency_records (
            scope,
            idempotency_key,
            request_hash,
            response_code,
            response_body,
            stored_at
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
          ON CONFLICT (scope, idempotency_key) DO UPDATE
          SET
            request_hash = EXCLUDED.request_hash,
            response_code = EXCLUDED.response_code,
            response_body = EXCLUDED.response_body,
            stored_at = EXCLUDED.stored_at
          WHERE ingestion_idempotency_records.request_hash = EXCLUDED.request_hash
          RETURNING request_hash
        `,
        [
          record.scope,
          record.idempotency_key,
          record.request_hash,
          record.response_code,
          JSON.stringify(record.response_body),
          record.stored_at
        ]
      );

      if ((result.rowCount ?? result.rows.length) === 0) {
        throw new Error(
          'idempotency_conflict: same key reused with different request hash'
        );
      }
    }
  };
}

export function createPostgresIngestionPersistenceAdapter(
  options: PostgresIngestionPersistenceAdapterOptions
): IngestionPersistenceAdapter {
  return {
    async appendRawEvent(event, context) {
      const packageId = getPackageIdFromPayload(event);

      const result = await options.db.query<{
        raw_event_id: string;
        persisted_at: string;
      }>(
        `
          INSERT INTO raw_events (
            event_id,
            event_name,
            schema_version,
            event_occurred_at,
            event_received_at,
            idempotency_scope,
            idempotency_key,
            request_id,
            session_id,
            actor_id,
            actor_type,
            consent_state,
            region,
            client_app,
            client_app_version,
            user_agent_family,
            device_class,
            referrer_domain,
            package_id,
            payload,
            created_at
          )
          VALUES (
            $1::uuid,
            $2::telemetry_event_name,
            $3,
            $4::timestamptz,
            $5::timestamptz,
            $6,
            $7,
            $8::uuid,
            $9::uuid,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19::uuid,
            $20::jsonb,
            $21::timestamptz
          )
          RETURNING id::text AS raw_event_id, created_at::text AS persisted_at
        `,
        [
          event.event_id,
          event.event_name,
          event.schema_version,
          event.event_occurred_at,
          event.event_received_at,
          'POST:/v1/events',
          event.idempotency_key,
          context.request_id,
          event.session_id,
          event.actor.actor_id,
          event.actor.actor_type,
          event.privacy.consent_state,
          event.privacy.region ?? null,
          event.client.app,
          event.client.app_version,
          event.client.user_agent_family,
          event.client.device_class,
          event.client.referrer_domain,
          packageId,
          JSON.stringify(event.payload),
          context.received_at
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error('raw event insert did not return id');
      }

      return row;
    }
  };
}

export function createPostgresFraudFlagPipeline(
  options: PostgresFraudFlagPipelineOptions
): FraudFlagPipelineAdapter {
  const flagSource = options.flagSource ?? 'rt_fraud';

  return {
    async evaluate(event) {
      if (!options.evaluator) {
        return [];
      }

      return options.evaluator.evaluate(event);
    },

    async recordEvaluations(rawEventId, event, evaluations, persistedAt) {
      if (evaluations.length === 0) {
        return;
      }

      const packageId = getPackageIdFromPayload(event);

      for (const evaluation of evaluations) {
        await options.db.query(
          `
            INSERT INTO event_flags (
              raw_event_id,
              package_id,
              outcome,
              flag_source,
              rule_code,
              reason_code,
              metadata,
              created_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::fraud_outcome,
              $4::event_flag_source,
              $5,
              $6,
              $7::jsonb,
              $8::timestamptz
            )
            ON CONFLICT (raw_event_id, rule_code) DO UPDATE
            SET
              outcome = EXCLUDED.outcome,
              reason_code = EXCLUDED.reason_code,
              metadata = EXCLUDED.metadata
          `,
          [
            rawEventId,
            packageId,
            evaluation.outcome,
            flagSource,
            evaluation.rule_code,
            evaluation.reason_code,
            JSON.stringify(evaluation.metadata),
            persistedAt
          ]
        );
      }
    }
  };
}

export function createPostgresOutboxPublisher(
  options: PostgresOutboxPublisherOptions
): IngestionOutboxPublisher {
  const sourceService = options.sourceService ?? 'control-plane';

  return {
    async publish(envelope: IngestionOutboxEnvelope) {
      await options.db.query(
        `
          INSERT INTO ingestion_outbox (
            event_type,
            dedupe_key,
            payload,
            source_service,
            occurred_at
          )
          VALUES (
            $1,
            $2,
            $3::jsonb,
            $4,
            $5::timestamptz
          )
          ON CONFLICT (dedupe_key) DO NOTHING
        `,
        [
          envelope.event_type,
          envelope.dedupe_key,
          JSON.stringify(envelope.payload),
          sourceService,
          envelope.occurred_at
        ]
      );
    }
  };
}
