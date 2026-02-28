import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave5 install lifecycle migration', () => {
  it('defines install lifecycle persistence tables with lock/rollback notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/009_install_lifecycle_foundations.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('Rollback playbook');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS install_plans');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS install_plan_actions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS install_plan_audit');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS install_apply_attempts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS install_verify_attempts');
  });
});
