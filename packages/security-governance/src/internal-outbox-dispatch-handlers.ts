import { createHash } from 'node:crypto';
import type { OutboxJob } from './jobs.js';
import type { PostgresQueryExecutor } from './postgres-adapters.js';
import type {
  DeterministicOutboxDispatchHandlers,
  DeterministicOutboxEventType
} from './outbox-dispatcher.js';

export interface InternalOutboxDispatchLogEvent {
  event_name:
    | 'outbox.internal_handler.processed'
    | 'outbox.internal_handler.replayed';
  occurred_at: string;
  payload: {
    outbox_job_id: string;
    event_type: DeterministicOutboxEventType;
    dedupe_key: string;
    handler_key: string;
  };
}

export interface InternalOutboxDispatchLogger {
  log(event: InternalOutboxDispatchLogEvent): void | Promise<void>;
}

export interface PostgresInternalOutboxDispatchHandlersOptions {
  db: PostgresQueryExecutor;
  logger?: InternalOutboxDispatchLogger;
  now?: () => Date;
  rankingSyncExecutor?: {
    sync(input: {
      package_ids: string[];
      outbox_job_id: string;
      dedupe_key: string;
      correlation_id: string | null;
      trigger: string;
    }): Promise<{
      candidate_count: number;
      upserted_count: number;
      unchanged_count: number;
      persisted_state_count: number;
    }>;
  };
}

function stableJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value.normalize('NFC'));
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key.normalize('NFC'))}:${stableJson(entryValue)}`)
      .join(',')}}`;
  }

  return 'null';
}

function toPayloadSha256(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

function resolveCorrelationId(payload: Record<string, unknown>): string | null {
  const correlation = payload.correlation_id;
  if (typeof correlation !== 'string') {
    return null;
  }

  const trimmed = correlation.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toHandlerKey(eventType: DeterministicOutboxEventType): string {
  return eventType.replace(/\./g, '_');
}

async function persistEffect(
  options: PostgresInternalOutboxDispatchHandlersOptions,
  eventType: DeterministicOutboxEventType,
  job: OutboxJob,
  effectCode: string,
  effectPayload: Record<string, unknown>
): Promise<void> {
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  await options.db.query(
    `
      INSERT INTO outbox_internal_dispatch_effects (
        outbox_job_id,
        dedupe_key,
        event_type,
        effect_code,
        effect_payload,
        processed_at
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6::timestamptz
      )
      ON CONFLICT (outbox_job_id, effect_code) DO NOTHING
    `,
    [job.id, job.dedupe_key, eventType, effectCode, JSON.stringify(effectPayload), nowIso]
  );
}

async function effectExists(
  options: PostgresInternalOutboxDispatchHandlersOptions,
  outboxJobId: string,
  effectCode: string
): Promise<boolean> {
  const result = await options.db.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM outbox_internal_dispatch_effects
        WHERE outbox_job_id = $1::uuid
          AND effect_code = $2
      ) AS exists
    `,
    [outboxJobId, effectCode]
  );

  return Boolean(result.rows[0]?.exists);
}

async function resolvePackageIdForRankingSync(
  options: PostgresInternalOutboxDispatchHandlersOptions,
  payload: Record<string, unknown>
): Promise<string | null> {
  const directPackageId = payload.package_id;
  if (typeof directPackageId === 'string' && isUuid(directPackageId)) {
    return directPackageId;
  }

  const rawEventId = payload.raw_event_id;
  if (typeof rawEventId !== 'string' || !isUuid(rawEventId)) {
    return null;
  }

  const result = await options.db.query<{ package_id: string | null }>(
    `
      SELECT package_id::text AS package_id
      FROM raw_events
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [rawEventId]
  );

  const packageId = result.rows[0]?.package_id;
  return typeof packageId === 'string' && isUuid(packageId) ? packageId : null;
}

async function persistDispatch(
  options: PostgresInternalOutboxDispatchHandlersOptions,
  eventType: DeterministicOutboxEventType,
  job: OutboxJob
): Promise<void> {
  const handlerKey = toHandlerKey(eventType);
  const nowIso = (options.now ?? (() => new Date()))().toISOString();

  const insertResult = await options.db.query(
    `
      INSERT INTO outbox_internal_dispatch_runs (
        outbox_job_id,
        dedupe_key,
        event_type,
        handler_key,
        source_service,
        payload_sha256,
        correlation_id,
        processed_at
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        COALESCE(($5::jsonb ->> 'source_service'), 'unknown_source'),
        $6,
        $7,
        $8::timestamptz
      )
      ON CONFLICT (outbox_job_id) DO NOTHING
      RETURNING outbox_job_id::text AS outbox_job_id
    `,
    [
      job.id,
      job.dedupe_key,
      eventType,
      handlerKey,
      JSON.stringify(job.payload),
      toPayloadSha256(job.payload),
      resolveCorrelationId(job.payload),
      nowIso
    ]
  );

  if (!options.logger) {
    return;
  }

  const eventName = insertResult.rowCount && insertResult.rowCount > 0
    ? 'outbox.internal_handler.processed'
    : 'outbox.internal_handler.replayed';

  await options.logger.log({
    event_name: eventName,
    occurred_at: nowIso,
    payload: {
      outbox_job_id: job.id,
      event_type: eventType,
      dedupe_key: job.dedupe_key,
      handler_key: handlerKey
    }
  });
}

export function createPostgresInternalOutboxDispatchHandlers(
  options: PostgresInternalOutboxDispatchHandlersOptions
): DeterministicOutboxDispatchHandlers {
  return {
    async fraud_reconcile_requested(job) {
      await persistEffect(options, 'fraud.reconcile.requested', job, 'fraud_reconcile_recorded', {
        event_id: typeof job.payload.event_id === 'string' ? job.payload.event_id : null,
        raw_event_id: typeof job.payload.raw_event_id === 'string' ? job.payload.raw_event_id : null,
        package_id: typeof job.payload.package_id === 'string' ? job.payload.package_id : null
      });
      await persistDispatch(options, 'fraud.reconcile.requested', job);
    },

    async ranking_sync_requested(job) {
      const packageId = await resolvePackageIdForRankingSync(options, job.payload);
      if (!packageId) {
        await persistEffect(
          options,
          'ranking.sync.requested',
          job,
          'ranking_sync_skipped_no_package',
          {
            raw_event_id: typeof job.payload.raw_event_id === 'string' ? job.payload.raw_event_id : null
          }
        );
        await persistDispatch(options, 'ranking.sync.requested', job);
        return;
      }

      if (!options.rankingSyncExecutor) {
        throw new Error('ranking_sync_executor_not_configured');
      }

      const effectCode = 'ranking_sync_executed';
      if (!(await effectExists(options, job.id, effectCode))) {
        const syncResult = await options.rankingSyncExecutor.sync({
          package_ids: [packageId],
          outbox_job_id: job.id,
          dedupe_key: job.dedupe_key,
          correlation_id: resolveCorrelationId(job.payload),
          trigger: 'outbox.ranking.sync.requested'
        });

        await persistEffect(options, 'ranking.sync.requested', job, effectCode, {
          package_ids: [packageId],
          ...syncResult
        });
      }

      await persistDispatch(options, 'ranking.sync.requested', job);
    },

    async security_report_accepted(job) {
      await persistEffect(
        options,
        'security.report.accepted',
        job,
        'security_report_accepted_recorded',
        {
          report_id: typeof job.payload.report_id === 'string' ? job.payload.report_id : null,
          package_id: typeof job.payload.package_id === 'string' ? job.payload.package_id : null,
          reason_code: typeof job.payload.reason_code === 'string' ? job.payload.reason_code : null
        }
      );
      await persistDispatch(options, 'security.report.accepted', job);
    },

    async security_enforcement_recompute_requested(job) {
      await persistEffect(
        options,
        'security.enforcement.recompute.requested',
        job,
        'security_enforcement_recompute_recorded',
        {
          report_id: typeof job.payload.report_id === 'string' ? job.payload.report_id : null,
          package_id: typeof job.payload.package_id === 'string' ? job.payload.package_id : null,
          projected_state:
            typeof job.payload.projected_state === 'string' ? job.payload.projected_state : null
        }
      );
      await persistDispatch(options, 'security.enforcement.recompute.requested', job);
    },

    async install_plan_created(job) {
      await persistEffect(options, 'install.plan.created', job, 'install_plan_created_recorded', {
        plan_id: typeof job.payload.plan_id === 'string' ? job.payload.plan_id : null
      });
      await persistDispatch(options, 'install.plan.created', job);
    },

    async install_apply_succeeded(job) {
      await persistEffect(
        options,
        'install.apply.succeeded',
        job,
        'install_apply_succeeded_recorded',
        {
          plan_id: typeof job.payload.plan_id === 'string' ? job.payload.plan_id : null,
          attempt_number:
            typeof job.payload.attempt_number === 'number' ? job.payload.attempt_number : null
        }
      );
      await persistDispatch(options, 'install.apply.succeeded', job);
    },

    async install_apply_failed(job) {
      await persistEffect(options, 'install.apply.failed', job, 'install_apply_failed_recorded', {
        plan_id: typeof job.payload.plan_id === 'string' ? job.payload.plan_id : null,
        reason_code: typeof job.payload.reason_code === 'string' ? job.payload.reason_code : null
      });
      await persistDispatch(options, 'install.apply.failed', job);
    },

    async install_verify_succeeded(job) {
      await persistEffect(
        options,
        'install.verify.succeeded',
        job,
        'install_verify_succeeded_recorded',
        {
          plan_id: typeof job.payload.plan_id === 'string' ? job.payload.plan_id : null,
          readiness: typeof job.payload.readiness === 'boolean' ? job.payload.readiness : null
        }
      );
      await persistDispatch(options, 'install.verify.succeeded', job);
    },

    async install_verify_failed(job) {
      await persistEffect(options, 'install.verify.failed', job, 'install_verify_failed_recorded', {
        plan_id: typeof job.payload.plan_id === 'string' ? job.payload.plan_id : null,
        reason_code: typeof job.payload.reason_code === 'string' ? job.payload.reason_code : null
      });
      await persistDispatch(options, 'install.verify.failed', job);
    }
  };
}
