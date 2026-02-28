import { describe, expect, it } from 'vitest';
import { verifyDr018Migration } from '../../scripts/verify-dr018-migration.mjs';

describe('contract: DR-018 migration verification', () => {
  it('passes compatibility/FK/idempotency verification script', () => {
    const result = verifyDr018Migration(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.name === 'compatibility view bridge for public.registry_packages')?.pass).toBe(true);
    expect(result.checks.find((check) => check.name === 'canonical table relation registry.packages')?.pass).toBe(true);
    expect(result.checks.find((check) => check.name === 'idempotent rerun guardrails present in cutover migration')?.pass).toBe(true);
  });
});
