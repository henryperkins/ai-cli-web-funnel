import type { OutboxJob, OutboxJobDispatcher } from './jobs.js';

export type DeterministicOutboxEventType =
  | 'fraud.reconcile.requested'
  | 'ranking.sync.requested'
  | 'security.report.accepted'
  | 'security.enforcement.recompute.requested'
  | 'install.plan.created'
  | 'install.apply.succeeded'
  | 'install.apply.failed'
  | 'install.verify.succeeded'
  | 'install.verify.failed';

export interface DeterministicOutboxDispatchHandlers {
  fraud_reconcile_requested?: (job: OutboxJob) => Promise<void>;
  ranking_sync_requested?: (job: OutboxJob) => Promise<void>;
  security_report_accepted?: (job: OutboxJob) => Promise<void>;
  security_enforcement_recompute_requested?: (job: OutboxJob) => Promise<void>;
  install_plan_created?: (job: OutboxJob) => Promise<void>;
  install_apply_succeeded?: (job: OutboxJob) => Promise<void>;
  install_apply_failed?: (job: OutboxJob) => Promise<void>;
  install_verify_succeeded?: (job: OutboxJob) => Promise<void>;
  install_verify_failed?: (job: OutboxJob) => Promise<void>;
}

function isDeterministicOutboxEventType(
  eventType: string
): eventType is DeterministicOutboxEventType {
  return (
    eventType === 'fraud.reconcile.requested' ||
    eventType === 'ranking.sync.requested' ||
    eventType === 'security.report.accepted' ||
    eventType === 'security.enforcement.recompute.requested' ||
    eventType === 'install.plan.created' ||
    eventType === 'install.apply.succeeded' ||
    eventType === 'install.apply.failed' ||
    eventType === 'install.verify.succeeded' ||
    eventType === 'install.verify.failed'
  );
}

export function createDeterministicOutboxDispatcher(
  handlers: DeterministicOutboxDispatchHandlers = {}
): OutboxJobDispatcher {
  return {
    async dispatch(job: OutboxJob): Promise<void> {
      if (!isDeterministicOutboxEventType(job.event_type)) {
        throw new Error(`unsupported_event_type:${job.event_type}`);
      }

      switch (job.event_type) {
        case 'fraud.reconcile.requested':
          await handlers.fraud_reconcile_requested?.(job);
          return;
        case 'ranking.sync.requested':
          await handlers.ranking_sync_requested?.(job);
          return;
        case 'security.report.accepted':
          await handlers.security_report_accepted?.(job);
          return;
        case 'security.enforcement.recompute.requested':
          await handlers.security_enforcement_recompute_requested?.(job);
          return;
        case 'install.plan.created':
          await handlers.install_plan_created?.(job);
          return;
        case 'install.apply.succeeded':
          await handlers.install_apply_succeeded?.(job);
          return;
        case 'install.apply.failed':
          await handlers.install_apply_failed?.(job);
          return;
        case 'install.verify.succeeded':
          await handlers.install_verify_succeeded?.(job);
          return;
        case 'install.verify.failed':
          await handlers.install_verify_failed?.(job);
          return;
        default:
          throw new Error(`unsupported_event_type:${job.event_type}`);
      }
    }
  };
}
