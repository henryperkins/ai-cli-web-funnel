import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave8 profile bundle foundations migration', () => {
  it('defines additive profile/install/audit tables with lock and rollback notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/012_profile_bundle_foundations.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('Rollback playbook');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS profiles');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS profile_packages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS profile_install_runs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS profile_install_run_plans');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS profile_audit');
    expect(sql).toContain("CHECK (status IN ('pending', 'planned', 'applied', 'verified', 'failed', 'skipped'))");
  });
});

