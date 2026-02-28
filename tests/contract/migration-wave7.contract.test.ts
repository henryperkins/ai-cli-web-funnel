import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave7 retrieval sync and dead-letter operations migration', () => {
  it('defines additive operational tables with lock and rollback notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/011_retrieval_sync_and_dead_letter_ops.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('Rollback playbook');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS retrieval_sync_documents');
    expect(sql).toContain('payload_sha256 TEXT NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outbox_internal_dispatch_effects');
    expect(sql).toContain('UNIQUE(outbox_job_id, effect_code)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outbox_dead_letter_replay_audit');
  });
});
