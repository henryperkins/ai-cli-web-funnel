#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function verifyDr018Migration(root = process.cwd()) {
  const files = {
    cutover: resolve(root, 'infra/postgres/migrations/005_registry_packages_cutover.sql'),
    runtime: resolve(root, 'infra/postgres/migrations/006_security_reporter_runtime.sql')
  };

  const cutoverSql = readFileSync(files.cutover, 'utf8');
  const runtimeSql = readFileSync(files.runtime, 'utf8');

  const checks = [
    {
      name: 'compatibility view bridge for public.registry_packages',
      pass: /CREATE OR REPLACE VIEW\s+public\.registry_packages/si.test(cutoverSql)
    },
    {
      name: 'canonical table relation registry.packages',
      pass:
        /CREATE TABLE IF NOT EXISTS\s+registry\.packages/si.test(cutoverSql) &&
        /ALTER TABLE\s+public\.registry_packages\s+SET SCHEMA\s+registry/si.test(cutoverSql)
    },
    {
      name: 'FK integrity guard does not allow FKs to compatibility view',
      pass: /Foreign keys must not target public\.registry_packages compatibility view/si.test(cutoverSql)
    },
    {
      name: 'idempotent rerun guardrails present in cutover migration',
      pass:
        /to_regclass\('registry\.packages'\) IS NULL/si.test(cutoverSql) &&
        /CREATE OR REPLACE VIEW\s+public\.registry_packages/si.test(cutoverSql)
    },
    {
      name: 'new governance relations target canonical registry.packages FK',
      pass: /REFERENCES\s+registry\.packages\(id\)/si.test(runtimeSql)
    },
    {
      name: 'reporter score recompute path asserts metrics readiness guard',
      pass: /PERFORM\s+assert_security_reporter_metrics_ready\(\)/si.test(runtimeSql)
    }
  ];

  const failed = checks.filter((check) => !check.pass);

  return {
    checks,
    failed,
    ok: failed.length === 0
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyDr018Migration();

  if (!result.ok) {
    for (const check of result.failed) {
      console.error(`FAILED: ${check.name}`);
    }
    process.exit(1);
  }

  for (const check of result.checks) {
    console.log(`OK: ${check.name}`);
  }
}
