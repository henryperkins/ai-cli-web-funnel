import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave6 outbox internal dispatch migration', () => {
  it('defines replay-safe internal dispatch ledger with lock and rollback notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/010_outbox_internal_dispatch_runs.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('Rollback playbook');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS outbox_internal_dispatch_runs');
    expect(sql).toContain('outbox_job_id UUID NOT NULL UNIQUE REFERENCES ingestion_outbox(id)');
    expect(sql).toContain('payload_sha256 TEXT NOT NULL');
  });
});
