import { describe, expect, it } from 'vitest';
import { formatTable, formatKeyValue, formatError, formatJson } from '../src/format.js';

describe('formatTable', () => {
  it('aligns columns correctly', () => {
    const result = formatTable(
      ['NAME', 'VALUE'],
      [
        ['short', '1'],
        ['longer-name', '22'],
      ]
    );

    const lines = result.split('\n').map((l) => l.trimEnd());
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toMatch(/^NAME\s+VALUE$/);
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[2]).toMatch(/^short\s+1$/);
    expect(lines[3]).toMatch(/^longer-name\s+22$/);
  });

  it('handles empty rows', () => {
    const result = formatTable(['A', 'B'], []);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2); // header + separator only
  });

  it('handles empty headers', () => {
    const result = formatTable([], []);
    expect(result).toBe('');
  });

  it('handles single column', () => {
    const result = formatTable(['ID'], [['abc'], ['def']]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('abc');
    expect(lines[3]).toBe('def');
  });
});

describe('formatKeyValue', () => {
  it('formats key-value pairs with aligned keys', () => {
    const result = formatKeyValue([
      ['name', 'test'],
      ['id', '123'],
    ]);

    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    // "name" is padded to match "name" (4 chars, same as longest key)
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('test');
    expect(lines[1]).toContain('id');
    expect(lines[1]).toContain('123');
  });

  it('handles empty pairs', () => {
    expect(formatKeyValue([])).toBe('');
  });

  it('aligns keys by longest key', () => {
    const result = formatKeyValue([
      ['a', '1'],
      ['longer_key', '2'],
    ]);

    const lines = result.split('\n');
    // "a" should be padded to length of "longer_key"
    expect(lines[0]!.indexOf('1')).toBe(lines[1]!.indexOf('2'));
  });
});

describe('formatError', () => {
  it('extracts message from API error', () => {
    const result = formatError(400, { message: 'bad request' });
    expect(result).toContain('Error (HTTP 400)');
    expect(result).toContain('bad request');
  });

  it('extracts issues array', () => {
    const result = formatError(422, {
      message: 'validation failed',
      issues: ['field_a is required', 'field_b is invalid'],
    });
    expect(result).toContain('Error (HTTP 422)');
    expect(result).toContain('validation failed');
    expect(result).toContain('- field_a is required');
    expect(result).toContain('- field_b is invalid');
  });

  it('handles issues with object entries', () => {
    const result = formatError(422, {
      issues: [{ message: 'bad value' }],
    });
    expect(result).toContain('- bad value');
  });

  it('falls back to JSON for unrecognized shapes', () => {
    const result = formatError(500, 'plain string');
    expect(result).toContain('Error (HTTP 500)');
    expect(result).toContain('"plain string"');
  });

  it('handles null data', () => {
    const result = formatError(500, null);
    expect(result).toContain('Error (HTTP 500)');
    expect(result).toContain('null');
  });
});

describe('formatJson', () => {
  it('pretty prints JSON', () => {
    const result = formatJson({ a: 1, b: [2, 3] });
    expect(result).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });
});
