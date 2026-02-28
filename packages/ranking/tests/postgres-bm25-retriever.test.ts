import { describe, expect, it } from 'vitest';
import { createPostgresBm25Retriever, type PostgresQueryExecutor } from '../src/postgres-bm25-retriever.js';

class FakeDb implements PostgresQueryExecutor {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });

    return {
      rows: [
        {
          package_id: 'pkg-2',
          document_text: 'forge package two',
          rank_score: 4
        },
        {
          package_id: 'pkg-1',
          document_text: 'forge package one',
          rank_score: 2
        }
      ] as Row[],
      rowCount: 2
    };
  }
}

describe('postgres bm25 retriever', () => {
  it('returns normalized deterministic bm25 scores using ranked rows', async () => {
    const db = new FakeDb();
    const retriever = createPostgresBm25Retriever({ db });

    const result = await retriever.search('forge package', 10);

    expect(result).toEqual([
      {
        id: 'pkg-2',
        text: 'forge package two',
        metadata: {
          package_id: 'pkg-2'
        },
        bm25_score: 1
      },
      {
        id: 'pkg-1',
        text: 'forge package one',
        metadata: {
          package_id: 'pkg-1'
        },
        bm25_score: 0.5
      }
    ]);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.params).toEqual(['forge package', 10]);
  });

  it('returns empty result for empty query without touching db', async () => {
    const db = new FakeDb();
    const retriever = createPostgresBm25Retriever({ db });

    const result = await retriever.search('   ', 10);

    expect(result).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it('clamps limit bounds and trims oversized query', async () => {
    const db = new FakeDb();
    const retriever = createPostgresBm25Retriever({ db });

    const longQuery = `${'forge '.repeat(200)}package`;
    await retriever.search(longQuery, 10_000);

    const params = db.calls[0]?.params;
    expect(typeof params?.[0]).toBe('string');
    expect((params?.[0] as string).length).toBeLessThanOrEqual(512);
    expect(params?.[1]).toBe(100);
  });
});
