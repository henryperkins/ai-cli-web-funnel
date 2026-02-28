import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave3 migration foundations', () => {
  it('defines idempotency, outbox, and projection snapshot tables with lock notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/007_async_boundaries_and_projection_snapshots.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ingestion_idempotency_records');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ingestion_outbox');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS security_enforcement_projections');
  });
});
