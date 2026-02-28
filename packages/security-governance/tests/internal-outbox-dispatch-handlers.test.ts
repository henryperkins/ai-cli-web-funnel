import { describe, expect, it } from 'vitest';
import { createPostgresInternalOutboxDispatchHandlers } from '../src/internal-outbox-dispatch-handlers.js';

class FakeDb {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  private replayDispatch = false;

  setReplay() {
    this.replayDispatch = true;
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });
    const isDispatchInsert = sql.includes('outbox_internal_dispatch_runs');
    const rowCount = isDispatchInsert && this.replayDispatch ? 0 : 1;
    if (isDispatchInsert) {
      this.replayDispatch = false;
    }

    return {
      rows: [] as Row[],
      rowCount
    };
  }
}

describe('postgres internal outbox dispatch handlers', () => {
  it('persists deterministic handler execution with payload hash', async () => {
    const db = new FakeDb();
    const handlers = createPostgresInternalOutboxDispatchHandlers({ db });

    await handlers.install_plan_created?.({
      id: '11111111-1111-4111-8111-111111111111',
      dedupe_key: 'plan-1:install.plan.created',
      event_type: 'install.plan.created',
      payload: {
        plan_id: 'plan-1',
        source_service: 'control-plane',
        correlation_id: 'corr-1'
      },
      attempt_count: 1
    });

    const dispatchCall = db.calls.find((entry) =>
      entry.sql.includes('outbox_internal_dispatch_runs')
    );
    const params = dispatchCall?.params ?? [];
    expect(params[0]).toBe('11111111-1111-4111-8111-111111111111');
    expect(params[1]).toBe('plan-1:install.plan.created');
    expect(params[2]).toBe('install.plan.created');
    expect(params[3]).toBe('install_plan_created');
    expect(typeof params[5]).toBe('string');
    expect((params[5] as string).length).toBe(64);
    expect(params[6]).toBe('corr-1');
  });

  it('emits processed vs replayed logger events based on insert rowCount', async () => {
    const db = new FakeDb();
    const events: string[] = [];

    const handlers = createPostgresInternalOutboxDispatchHandlers({
      db,
      logger: {
        log(event) {
          events.push(event.event_name);
        }
      }
    });

    await handlers.install_verify_failed?.({
      id: '22222222-2222-4222-8222-222222222222',
      dedupe_key: 'plan-2:verify:1:install.verify.failed',
      event_type: 'install.verify.failed',
      payload: {},
      attempt_count: 1
    });

    db.setReplay();
    await handlers.install_verify_failed?.({
      id: '22222222-2222-4222-8222-222222222222',
      dedupe_key: 'plan-2:verify:1:install.verify.failed',
      event_type: 'install.verify.failed',
      payload: {},
      attempt_count: 2
    });

    expect(events).toEqual([
      'outbox.internal_handler.processed',
      'outbox.internal_handler.replayed'
    ]);
  });
});
