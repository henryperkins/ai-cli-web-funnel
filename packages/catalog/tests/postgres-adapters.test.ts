import { describe, expect, it } from 'vitest';
import {
  createCatalogPostgresAdapters,
  type CatalogPackageDetail,
  type CatalogPackageListItem,
  type PostgresQueryExecutor
} from '../src/postgres-adapters.js';
import { createCatalogIngestService } from '../src/index.js';

class FakeDb implements PostgresQueryExecutor {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('INSERT INTO package_merge_runs')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO registry.packages')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO package_aliases')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO package_field_lineage')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('FROM registry.packages p') && sql.includes('LIMIT $1 OFFSET $2')) {
      return {
        rows: [
          {
            package_id: '8fb39ece-2024-4f50-aa89-e78758e65e74',
            package_slug: 'acme/forge',
            canonical_repo: 'github.com/acme/forge',
            updated_at: '2026-03-01T00:00:00Z'
          }
        ] as Row[],
        rowCount: 1
      };
    }

    if (sql.includes('WHERE p.id = $1::uuid')) {
      return {
        rows: [
          {
            package_id: '8fb39ece-2024-4f50-aa89-e78758e65e74',
            package_slug: 'acme/forge',
            canonical_repo: 'github.com/acme/forge',
            updated_at: '2026-03-01T00:00:00Z'
          }
        ] as Row[],
        rowCount: 1
      };
    }

    if (sql.includes('FROM package_aliases')) {
      return {
        rows: [
          {
            alias_type: 'url_alias',
            alias_value: 'github.com/acme/forge',
            source_name: 'github',
            active: true
          }
        ] as Row[],
        rowCount: 1
      };
    }

    if (sql.includes('FROM package_field_lineage')) {
      return {
        rows: [
          {
            field_name: 'name',
            field_source: 'smithery',
            field_source_updated_at: '2026-03-01T00:00:00Z',
            merge_run_id: 'merge-run-1'
          }
        ] as Row[],
        rowCount: 1
      };
    }

    if (sql.includes('WHERE\n            p.package_slug ILIKE $1')) {
      return {
        rows: [
          {
            package_id: '8fb39ece-2024-4f50-aa89-e78758e65e74',
            package_slug: 'acme/forge',
            canonical_repo: 'github.com/acme/forge',
            updated_at: '2026-03-01T00:00:00Z'
          }
        ] as Row[],
        rowCount: 1
      };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

describe('catalog postgres adapters', () => {
  it('persists merge output in an explicit transaction boundary', async () => {
    const db = new FakeDb();
    const adapters = createCatalogPostgresAdapters({ db });

    const ingest = createCatalogIngestService().ingest({
      merge_run_id: 'merge-run-1',
      occurred_at: '2026-03-01T00:00:00Z',
      candidates: [
        {
          source_name: 'github',
          source_updated_at: '2026-03-01T00:00:00Z',
          github_repo_id: 101,
          github_repo_locator: 'https://github.com/acme/forge',
          tool_kind: 'mcp',
          package_slug: 'acme/forge',
          fields: {
            name: 'Forge'
          }
        }
      ]
    });

    await adapters.persistIngestResult(ingest);

    expect(db.calls[0]?.sql).toBe('BEGIN');
    expect(db.calls[db.calls.length - 1]?.sql).toBe('COMMIT');
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO registry.packages'))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO package_field_lineage'))).toBe(
      true
    );
  });

  it('returns package list, detail, and search read models', async () => {
    const db = new FakeDb();
    const adapters = createCatalogPostgresAdapters({ db });

    const list = await adapters.listPackages(10, 0);
    expect(list).toHaveLength(1);
    expect((list[0] as CatalogPackageListItem).package_slug).toBe('acme/forge');

    const detail = (await adapters.getPackage(
      '8fb39ece-2024-4f50-aa89-e78758e65e74'
    )) as CatalogPackageDetail;
    expect(detail.aliases).toHaveLength(1);
    expect(detail.lineage_summary).toHaveLength(1);

    const search = await adapters.searchPackages('forge', 5);
    expect(search).toHaveLength(1);
  });
});
