import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract: migration ordering policy', () => {
  it('keeps one migration file per numeric prefix', () => {
    const migrationsDir = join(process.cwd(), 'infra/postgres/migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const prefixCounts = new Map<string, number>();
    for (const file of migrationFiles) {
      const prefix = file.split('_', 1)[0] ?? '';
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }

    const duplicatePrefixes = [...prefixCounts.entries()].filter(([, count]) => count > 1);
    expect(duplicatePrefixes).toEqual([]);
  });

  it('applies Wave 10 catalog/trust-gate migrations in deterministic sequence', () => {
    const migrationsDir = join(process.cwd(), 'infra/postgres/migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const catalogMigration = '015_catalog_source_freshness_and_reconciliation.sql';
    const trustGateMigration = '016_security_appeals_and_trust_gates.sql';

    expect(migrationFiles).toContain(catalogMigration);
    expect(migrationFiles).toContain(trustGateMigration);
    expect(migrationFiles.indexOf(catalogMigration)).toBeLessThan(
      migrationFiles.indexOf(trustGateMigration)
    );
  });
});
