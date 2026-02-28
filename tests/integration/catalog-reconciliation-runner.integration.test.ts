import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts', 'run-catalog-reconciliation.mjs');
const validFixture = join(
  process.cwd(),
  'tests',
  'integration',
  'fixtures',
  'catalog-docs-source.json'
);
const invalidFixture = join(
  process.cwd(),
  'tests',
  'integration',
  'fixtures',
  'catalog-docs-invalid-source.json'
);

describe('integration: catalog reconciliation runner', () => {
  it('runs docs reconciliation dry-run successfully with structured logs', () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--mode',
        'dry-run',
        '--source',
        'docs',
        '--input',
        validFixture,
        '--max-attempts',
        '2',
        '--retry-backoff-ms',
        '1'
      ],
      {
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('catalog_reconciliation.completed');
    expect(result.stdout).toContain('"status":"succeeded"');
  });

  it('uses bounded retries and fails explicitly when source normalization yields no candidates', () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--mode',
        'dry-run',
        '--source',
        'docs',
        '--input',
        invalidFixture,
        '--max-attempts',
        '2',
        '--retry-backoff-ms',
        '1'
      ],
      {
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('catalog_reconciliation.attempt_failed');
    expect(result.stdout).toContain('"status":"failed"');
  });
});
