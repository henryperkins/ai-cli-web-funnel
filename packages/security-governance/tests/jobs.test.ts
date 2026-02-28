import { describe, expect, it } from 'vitest';
import {
  createEnforcementExpiryReconcileJob,
  createOutboxProcessorJob,
  createReporterScoreRecomputeJob,
  type OutboxJob,
  type OutboxJobStore
} from '../src/jobs.js';

describe('operational jobs', () => {
  it('supports dry-run/shadow/production reporter score recompute modes', async () => {
    const calls: string[] = [];
    const job = createReporterScoreRecomputeJob({
      async preview() {
        calls.push('preview');
        return 3;
      },
      async execute() {
        calls.push('execute');
        return 5;
      }
    });

    expect(await job.run('dry-run', '2026-02-27T12:00:00Z')).toEqual({
      mode: 'dry-run',
      recomputed_count: 3,
      committed: false
    });
    expect(await job.run('shadow', '2026-02-27T12:00:00Z')).toEqual({
      mode: 'shadow',
      recomputed_count: 3,
      committed: false
    });
    expect(await job.run('production', '2026-02-27T12:00:00Z')).toEqual({
      mode: 'production',
      recomputed_count: 5,
      committed: true
    });

    expect(calls).toEqual(['preview', 'preview', 'execute']);
  });

  it('supports enforcement expiry reconcile modes', async () => {
    const job = createEnforcementExpiryReconcileJob({
      async preview() {
        return ['pkg-1'];
      },
      async execute() {
        return ['pkg-1', 'pkg-2'];
      }
    });

    expect(await job.run('dry-run', '2026-02-27T12:00:00Z')).toEqual({
      mode: 'dry-run',
      reconciled_package_ids: ['pkg-1'],
      committed: false
    });
    expect(await job.run('production', '2026-02-27T12:00:00Z')).toEqual({
      mode: 'production',
      reconciled_package_ids: ['pkg-1', 'pkg-2'],
      committed: true
    });
  });

  it('handles duplicate and partial-failure outbox reruns safely', async () => {
    const queue: OutboxJob[] = [
      {
        id: 'job-1',
        dedupe_key: 'dedupe-1',
        event_type: 'security.report.accepted',
        payload: {},
        attempt_count: 0
      },
      {
        id: 'job-2',
        dedupe_key: 'dedupe-2',
        event_type: 'security.enforcement.recompute.requested',
        payload: {},
        attempt_count: 0
      }
    ];

    const processed = new Set<string>(['dedupe-1']);
    const completed = new Set<string>();
    const failed = new Set<string>();
    const released = new Set<string>();
    const store: OutboxJobStore = {
      async claimPending() {
        return [...queue];
      },
      async markCompleted(id) {
        completed.add(id);
      },
      async markFailed(id) {
        failed.add(id);
      },
      async isProcessed(dedupeKey) {
        return processed.has(dedupeKey);
      },
      async markProcessed(dedupeKey) {
        processed.add(dedupeKey);
      },
      async releaseClaim(id) {
        released.add(id);
      }
    };

    let failJob2 = true;
    const dispatched: string[] = [];
    const logged: Array<{ event_name: string; payload: Record<string, unknown> }> = [];
    const job = createOutboxProcessorJob(
      store,
      {
        async dispatch(entry) {
          dispatched.push(entry.id);
          if (entry.id === 'job-2' && failJob2) {
            failJob2 = false;
            throw new Error('transient_failure');
          }
        }
      },
      {
        logger: {
          log(event) {
            logged.push(event);
          }
        }
      }
    );

    const dryRun = await job.run('dry-run', '2026-02-27T12:00:00Z', 10);
    const firstProd = await job.run('production', '2026-02-27T12:01:00Z', 10);
    const rerun = await job.run('production', '2026-02-27T12:02:00Z', 10);

    expect(dryRun).toEqual({
      mode: 'dry-run',
      claimed: 2,
      dispatched: 0,
      completed: 0,
      failed: 0,
      skipped_duplicates: 1
    });

    expect(firstProd).toEqual({
      mode: 'production',
      claimed: 2,
      dispatched: 0,
      completed: 1,
      failed: 1,
      skipped_duplicates: 1
    });

    expect(rerun).toEqual({
      mode: 'production',
      claimed: 2,
      dispatched: 1,
      completed: 2,
      failed: 0,
      skipped_duplicates: 1
    });

    expect(dispatched).toEqual(['job-2', 'job-2']);
    expect(completed).toEqual(new Set(['job-1', 'job-2']));
    expect(failed).toEqual(new Set(['job-2']));
    expect(released).toEqual(new Set(['job-1', 'job-2']));
    expect(logged).toContainEqual(
      expect.objectContaining({
        event_name: 'outbox.dispatch_failed',
        payload: expect.objectContaining({
          mode: 'production',
          failure_class: 'transient',
          job_id: 'job-2'
        })
      })
    );
  });

  it('logs claim failures before bubbling the error', async () => {
    const logged: Array<{ event_name: string; payload: Record<string, unknown> }> = [];
    const store: OutboxJobStore = {
      async claimPending() {
        throw new Error('database_timeout');
      },
      async markCompleted() {},
      async markFailed() {},
      async isProcessed() {
        return false;
      },
      async markProcessed() {},
      async releaseClaim() {}
    };

    const job = createOutboxProcessorJob(
      store,
      {
        async dispatch() {}
      },
      {
        logger: {
          log(event) {
            logged.push(event);
          }
        }
      }
    );

    await expect(job.run('production', '2026-02-27T12:10:00Z', 10)).rejects.toThrow(
      'database_timeout'
    );
    expect(logged[0]).toMatchObject({
      event_name: 'outbox.claim_failed',
      payload: {
        mode: 'production',
        failure_class: 'transient'
      }
    });
  });
});
