export type JobRunMode = 'dry-run' | 'shadow' | 'production';

export interface ReporterScoreJobExecutor {
  preview(nowIso: string): Promise<number>;
  execute(nowIso: string): Promise<number>;
}

export interface ReporterScoreJobResult {
  mode: JobRunMode;
  recomputed_count: number;
  committed: boolean;
}

export function createReporterScoreRecomputeJob(
  executor: ReporterScoreJobExecutor
) {
  return {
    async run(mode: JobRunMode, nowIso: string): Promise<ReporterScoreJobResult> {
      if (mode === 'production') {
        const recomputedCount = await executor.execute(nowIso);
        return {
          mode,
          recomputed_count: recomputedCount,
          committed: true
        };
      }

      const previewCount = await executor.preview(nowIso);
      return {
        mode,
        recomputed_count: previewCount,
        committed: false
      };
    }
  };
}

export interface EnforcementExpiryJobExecutor {
  preview(nowIso: string): Promise<string[]>;
  execute(nowIso: string): Promise<string[]>;
}

export interface EnforcementExpiryJobResult {
  mode: JobRunMode;
  reconciled_package_ids: string[];
  committed: boolean;
}

export function createEnforcementExpiryReconcileJob(
  executor: EnforcementExpiryJobExecutor
) {
  return {
    async run(mode: JobRunMode, nowIso: string): Promise<EnforcementExpiryJobResult> {
      if (mode === 'production') {
        return {
          mode,
          reconciled_package_ids: await executor.execute(nowIso),
          committed: true
        };
      }

      return {
        mode,
        reconciled_package_ids: await executor.preview(nowIso),
        committed: false
      };
    }
  };
}

export interface OutboxJob {
  id: string;
  dedupe_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

export interface OutboxJobStore {
  claimPending(limit: number, nowIso: string): Promise<OutboxJob[]>;
  markCompleted(id: string, nowIso: string): Promise<void>;
  markFailed(id: string, error: string, nowIso: string): Promise<void>;
  isProcessed(dedupeKey: string): Promise<boolean>;
  markProcessed(dedupeKey: string, nowIso: string): Promise<void>;
  releaseClaim(id: string, nowIso: string): Promise<void>;
}

export interface OutboxJobDispatcher {
  dispatch(job: OutboxJob): Promise<void>;
}

export interface OutboxProcessorRunResult {
  mode: JobRunMode;
  claimed: number;
  dispatched: number;
  completed: number;
  failed: number;
  skipped_duplicates: number;
}

export type OutboxFailureClass = 'transient' | 'permanent' | 'unknown';

export interface OutboxProcessorLogEvent {
  event_name: 'outbox.claim_failed' | 'outbox.dispatch_failed';
  occurred_at: string;
  payload: {
    mode: JobRunMode;
    error_message: string;
    failure_class: OutboxFailureClass;
    job_id?: string;
    dedupe_key?: string;
    event_type?: string;
  };
}

export interface OutboxProcessorLogger {
  log(event: OutboxProcessorLogEvent): void | Promise<void>;
}

export interface OutboxProcessorOptions {
  logger?: OutboxProcessorLogger;
}

function classifyOutboxFailure(error: unknown): OutboxFailureClass {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('timeout') ||
    message.includes('tempor') ||
    message.includes('transient') ||
    message.includes('rate')
  ) {
    return 'transient';
  }
  if (message.length > 0) {
    return 'permanent';
  }
  return 'unknown';
}

export function createOutboxProcessorJob(
  store: OutboxJobStore,
  dispatcher: OutboxJobDispatcher,
  options: OutboxProcessorOptions = {}
) {
  return {
    async run(
      mode: JobRunMode,
      nowIso: string,
      limit = 100
    ): Promise<OutboxProcessorRunResult> {
      let claimedJobs: OutboxJob[] = [];
      try {
        claimedJobs = await store.claimPending(limit, nowIso);
      } catch (error) {
        if (options.logger) {
          await options.logger.log({
            event_name: 'outbox.claim_failed',
            occurred_at: nowIso,
            payload: {
              mode,
              error_message: error instanceof Error ? error.message : 'unknown_error',
              failure_class: classifyOutboxFailure(error)
            }
          });
        }
        throw error;
      }
      let dispatched = 0;
      let completed = 0;
      let failed = 0;
      let skippedDuplicates = 0;

      for (const job of claimedJobs) {
        if (await store.isProcessed(job.dedupe_key)) {
          skippedDuplicates += 1;
          if (mode === 'production') {
            await store.markCompleted(job.id, nowIso);
            completed += 1;
          } else {
            await store.releaseClaim(job.id, nowIso);
          }
          continue;
        }

        if (mode === 'dry-run') {
          await store.releaseClaim(job.id, nowIso);
          continue;
        }

        try {
          await dispatcher.dispatch(job);
          dispatched += 1;

          if (mode === 'production') {
            await store.markProcessed(job.dedupe_key, nowIso);
            await store.markCompleted(job.id, nowIso);
            completed += 1;
          }
        } catch (error) {
          failed += 1;
          if (options.logger) {
            await options.logger.log({
              event_name: 'outbox.dispatch_failed',
              occurred_at: nowIso,
              payload: {
                mode,
                job_id: job.id,
                dedupe_key: job.dedupe_key,
                event_type: job.event_type,
                error_message: error instanceof Error ? error.message : 'unknown_error',
                failure_class: classifyOutboxFailure(error)
              }
            });
          }
          if (mode === 'production') {
            const message = error instanceof Error ? error.message : 'unknown_error';
            await store.markFailed(job.id, message, nowIso);
          }
        } finally {
          if (mode === 'shadow') {
            await store.releaseClaim(job.id, nowIso);
          }
        }
      }

      return {
        mode,
        claimed: claimedJobs.length,
        dispatched,
        completed,
        failed,
        skipped_duplicates: skippedDuplicates
      };
    }
  };
}
