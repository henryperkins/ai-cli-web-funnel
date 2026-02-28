import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave9 operational slo rollup migration', () => {
  it('defines additive SLO rollup tables with lock and rollback notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/013_operational_slo_rollup_foundations.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('Rollback playbook');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS operational_slo_rollup_runs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS operational_slo_snapshots');
    expect(sql).toContain("CHECK (mode IN ('dry-run', 'production'))");
    expect(sql).toContain("CHECK (status IN ('running', 'completed', 'failed'))");
    expect(sql).toContain('UNIQUE(run_internal_id, metric_key)');
  });
});

