import type { Bm25Retriever, RetrievalDocument } from './hybrid-retrieval.js';

export interface PostgresQueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface PostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresBm25RetrieverOptions {
  db: PostgresQueryExecutor;
}

interface PostgresBm25Row {
  package_id: string;
  document_text: string;
  rank_score: number;
}

function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 512);
}

function normalizeScore(value: number, maxScore: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxScore) || maxScore <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, value / maxScore));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toDocument(row: PostgresBm25Row, maxScore: number): RetrievalDocument & { bm25_score: number } {
  const normalized = roundScore(normalizeScore(row.rank_score, maxScore));
  return {
    id: row.package_id,
    text: row.document_text,
    metadata: {
      package_id: row.package_id
    },
    bm25_score: normalized
  };
}

export function createPostgresBm25Retriever(
  options: PostgresBm25RetrieverOptions
): Bm25Retriever {
  return {
    async search(query: string, limit: number): Promise<Array<RetrievalDocument & { bm25_score: number }>> {
      const normalizedQuery = normalizeQuery(query);
      if (normalizedQuery.length === 0) {
        return [];
      }

      const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
      const result = await options.db.query<PostgresBm25Row>(
        `
          WITH latest_lineage AS (
            SELECT DISTINCT ON (pfl.package_id, pfl.field_name)
              pfl.package_id,
              pfl.field_name,
              CASE
                WHEN jsonb_typeof(pfl.field_value_json) = 'string' THEN pfl.field_value_json #>> '{}'
                ELSE pfl.field_value_json::text
              END AS field_value
            FROM package_field_lineage pfl
            WHERE pfl.field_name IN ('name', 'description', 'tags')
            ORDER BY pfl.package_id, pfl.field_name, pfl.resolved_at DESC
          ),
          package_docs AS (
            SELECT
              p.id::text AS package_id,
              concat_ws(
                ' ',
                COALESCE(p.package_slug, ''),
                COALESCE(p.canonical_repo, ''),
                COALESCE(MAX(CASE WHEN ll.field_name = 'name' THEN ll.field_value END), ''),
                COALESCE(MAX(CASE WHEN ll.field_name = 'description' THEN ll.field_value END), ''),
                COALESCE(MAX(CASE WHEN ll.field_name = 'tags' THEN ll.field_value END), '')
              ) AS document_text
            FROM registry.packages p
            LEFT JOIN latest_lineage ll
              ON ll.package_id = p.id
            GROUP BY p.id, p.package_slug, p.canonical_repo
          ),
          ranked AS (
            SELECT
              d.package_id,
              d.document_text,
              ts_rank_cd(
                to_tsvector('simple', d.document_text),
                websearch_to_tsquery('simple', $1)
              ) AS rank_score
            FROM package_docs d
            WHERE to_tsvector('simple', d.document_text) @@ websearch_to_tsquery('simple', $1)
          )
          SELECT
            package_id,
            document_text,
            rank_score
          FROM ranked
          ORDER BY rank_score DESC, package_id ASC
          LIMIT $2
        `,
        [normalizedQuery, safeLimit]
      );

      const maxScore = result.rows[0]?.rank_score ?? 0;
      return result.rows.map((row) => toDocument(row, maxScore));
    }
  };
}
