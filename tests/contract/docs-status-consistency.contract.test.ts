import { describe, expect, it } from 'vitest';
import {
  verifyDocStatusConsistency
} from '../../scripts/verify-doc-status-consistency.mjs';

describe('contract: docs status consistency', () => {
  it('keeps the canonical current-state docs in sync', () => {
    const result = verifyDocStatusConsistency();

    expect(result.ok, result.errors.join('\n')).toBe(true);
  });
});
