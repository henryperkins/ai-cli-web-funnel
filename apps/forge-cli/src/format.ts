/**
 * Simple column-aligned table formatter (no external dependencies).
 */
export function formatTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return '';

  const widths: number[] = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < headers.length; i++) {
      const cell = row[i];
      if (cell !== undefined && cell.length > (widths[i] ?? 0)) {
        widths[i] = cell.length;
      }
    }
  }

  function padRow(cells: string[]): string {
    return cells
      .map((cell, i) => {
        const w = widths[i] ?? cell.length;
        return cell.padEnd(w);
      })
      .join('  ');
  }

  const headerLine = padRow(headers);
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const dataLines = rows.map((row) => padRow(row));

  return [headerLine, separator, ...dataLines].join('\n');
}

/**
 * Format key-value pairs as aligned output.
 */
export function formatKeyValue(pairs: Array<[string, string]>): string {
  if (pairs.length === 0) return '';

  const maxKeyLen = Math.max(...pairs.map(([key]) => key.length));

  return pairs
    .map(([key, value]) => `${key.padEnd(maxKeyLen)}  ${value}`)
    .join('\n');
}

/**
 * Extract a human-readable error message from an API error response.
 */
export function formatError(status: number, data: unknown): string {
  const lines: string[] = [`Error (HTTP ${status})`];

  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record['message'] === 'string') {
      lines.push(record['message']);
    }
    if (Array.isArray(record['issues'])) {
      for (const issue of record['issues']) {
        if (typeof issue === 'string') {
          lines.push(`  - ${issue}`);
        } else if (typeof issue === 'object' && issue !== null) {
          const issueRecord = issue as Record<string, unknown>;
          const msg = issueRecord['message'] ?? issueRecord['detail'] ?? JSON.stringify(issue);
          lines.push(`  - ${String(msg)}`);
        }
      }
    }
  }

  if (lines.length === 1) {
    lines.push(JSON.stringify(data));
  }

  return lines.join('\n');
}

/**
 * Pretty-print JSON.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
