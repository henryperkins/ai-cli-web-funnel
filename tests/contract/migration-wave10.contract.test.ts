import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: wave10 security appeals and trust gates migration', () => {
  it('defines additive rollout/appeals controls with lock and rollback notes', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'infra/postgres/migrations/016_security_appeals_and_trust_gates.sql'
      ),
      'utf8'
    );

    expect(sql).toContain('LOCK RISK');
    expect(sql).toContain('Rollback playbook');
    expect(sql).toContain('CREATE TYPE security_appeal_priority');
    expect(sql).toContain('CREATE TYPE security_appeal_resolution');
    expect(sql).toContain('CREATE TYPE security_rollout_mode');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS security_enforcement_rollout_state');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS security_enforcement_promotion_decisions');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION security_validate_perm_block_requirements');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION security_promote_policy_block_perm');
  });
});
