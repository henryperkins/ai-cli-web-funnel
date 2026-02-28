import { describe, expect, it } from 'vitest';
import { scorePackageV0 } from '../src/index.js';

describe('ranking v0 foundation scaffold', () => {
  it('returns insufficient_signals when required relevance is missing', () => {
    const result = scorePackageV0({
      package_id: 'pkg-1',
      query: 'security scanner',
      freshness: 0.8,
      popularity: 0.6
    });

    expect(result.status).toBe('insufficient_signals');
    expect(result.score).toBe(0);
  });

  it('scores deterministically for identical inputs', () => {
    const input = {
      package_id: 'pkg-1',
      query: 'security scanner',
      query_relevance: 0.7,
      freshness: 0.8,
      popularity: 0.6,
      ctr: 0.4,
      action_rate: 0.3,
      cold_start_prior: 0.5,
      impressions_7d: 200,
      embedding_model_version: 'text-embedding-3-large',
      vector_collection_version: 'qdrant-v1',
      semantic_fallback: false
    };

    const first = scorePackageV0(input);
    const second = scorePackageV0(input);

    expect(first).toEqual(second);
    expect(first.status).toBe('scored');
    expect(first.lineage.embedding_model_version).toBe('text-embedding-3-large');
    expect(first.lineage.vector_collection_version).toBe('qdrant-v1');
    expect(first.lineage.semantic_fallback).toBe(false);
  });

  it('uses cold-start prior blend when impressions are below threshold', () => {
    const result = scorePackageV0({
      package_id: 'pkg-2',
      query: 'agent runtime',
      query_relevance: 0.5,
      freshness: 0.7,
      popularity: 0.8,
      ctr: 0.9,
      action_rate: 0.9,
      cold_start_prior: 0.4,
      impressions_7d: 25
    });

    expect(result.status).toBe('scored');
    expect(result.lineage.fallbacks_used).toContain('cold_start_prior_blend');
    expect(result.components.cold_start_blend).toBeGreaterThan(0);
  });

  it('defaults lineage metadata when semantic context is not provided', () => {
    const result = scorePackageV0({
      package_id: 'pkg-3',
      query: 'agent runtime',
      query_relevance: 0.9
    });

    expect(result.lineage.embedding_model_version).toBe('not_configured');
    expect(result.lineage.vector_collection_version).toBe('not_configured');
    expect(result.lineage.semantic_fallback).toBe(false);
  });
});
