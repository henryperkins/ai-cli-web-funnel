export interface RankingSignalInput {
  package_id: string;
  query: string;
  query_relevance?: number | null;
  freshness?: number | null;
  popularity?: number | null;
  ctr?: number | null;
  action_rate?: number | null;
  cold_start_prior?: number | null;
  impressions_7d?: number | null;
  embedding_model_version?: string | null;
  vector_collection_version?: string | null;
  semantic_fallback?: boolean | null;
}

export interface RankingFeatureGates {
  requireQueryRelevance: boolean;
  enableBehavioralSignals: boolean;
  enableColdStartPriorBlend: boolean;
  minImpressionsForBehavioralSignals: number;
}

export const defaultRankingFeatureGates: RankingFeatureGates = {
  requireQueryRelevance: true,
  enableBehavioralSignals: true,
  enableColdStartPriorBlend: true,
  minImpressionsForBehavioralSignals: 100
};

export interface RankingFeatureAvailability {
  query_relevance: boolean;
  freshness: boolean;
  popularity: boolean;
  ctr: boolean;
  action_rate: boolean;
  cold_start_prior: boolean;
}

export interface RankingLineageMetadata {
  ranking_model_version: 'ranking-v0-foundation';
  embedding_model_version: string;
  vector_collection_version: string;
  semantic_fallback: boolean;
  deterministic_contract: 'fixed-weight-v0';
  feature_gates: RankingFeatureGates;
  feature_availability: RankingFeatureAvailability;
  fallbacks_used: string[];
}

export interface RankingScoreResult {
  package_id: string;
  score: number;
  status: 'scored' | 'insufficient_signals';
  components: {
    relevance: number;
    freshness: number;
    popularity: number;
    ctr: number;
    action_rate: number;
    cold_start_blend: number;
  };
  lineage: RankingLineageMetadata;
}

function normalize(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildAvailability(input: RankingSignalInput): RankingFeatureAvailability {
  return {
    query_relevance: input.query_relevance !== null && input.query_relevance !== undefined,
    freshness: input.freshness !== null && input.freshness !== undefined,
    popularity: input.popularity !== null && input.popularity !== undefined,
    ctr: input.ctr !== null && input.ctr !== undefined,
    action_rate: input.action_rate !== null && input.action_rate !== undefined,
    cold_start_prior: input.cold_start_prior !== null && input.cold_start_prior !== undefined
  };
}

function resolveEmbeddingModelVersion(input: RankingSignalInput): string {
  return input.embedding_model_version?.trim() || 'not_configured';
}

function resolveVectorCollectionVersion(input: RankingSignalInput): string {
  return input.vector_collection_version?.trim() || 'not_configured';
}

export function scorePackageV0(
  input: RankingSignalInput,
  gates: RankingFeatureGates = defaultRankingFeatureGates
): RankingScoreResult {
  const availability = buildAvailability(input);
  const fallbacks: string[] = [];

  if (gates.requireQueryRelevance && !availability.query_relevance) {
    return {
      package_id: input.package_id,
      score: 0,
      status: 'insufficient_signals',
      components: {
        relevance: 0,
        freshness: 0,
        popularity: 0,
        ctr: 0,
        action_rate: 0,
        cold_start_blend: 0
      },
      lineage: {
        ranking_model_version: 'ranking-v0-foundation',
        embedding_model_version: resolveEmbeddingModelVersion(input),
        vector_collection_version: resolveVectorCollectionVersion(input),
        semantic_fallback: Boolean(input.semantic_fallback),
        deterministic_contract: 'fixed-weight-v0',
        feature_gates: gates,
        feature_availability: availability,
        fallbacks_used: ['query_relevance_missing']
      }
    };
  }

  const relevance = normalize(input.query_relevance);
  const freshness = normalize(input.freshness);
  const popularity = normalize(input.popularity);
  let ctr = normalize(input.ctr);
  let actionRate = normalize(input.action_rate);

  const impressions = Math.max(0, input.impressions_7d ?? 0);

  if (!gates.enableBehavioralSignals) {
    ctr = 0;
    actionRate = 0;
    fallbacks.push('behavioral_signals_disabled');
  } else if (impressions < gates.minImpressionsForBehavioralSignals) {
    ctr = 0;
    actionRate = 0;
    fallbacks.push('behavioral_signals_under_sample_threshold');
  }

  const baseScore =
    0.55 * relevance +
    0.15 * freshness +
    0.15 * popularity +
    0.1 * ctr +
    0.05 * actionRate;

  let coldStartBlend = 0;
  let finalScore = baseScore;

  if (
    gates.enableColdStartPriorBlend &&
    impressions < gates.minImpressionsForBehavioralSignals &&
    availability.cold_start_prior
  ) {
    const prior = normalize(input.cold_start_prior);
    const blend = Math.min(1, impressions / gates.minImpressionsForBehavioralSignals);
    coldStartBlend = blend;
    finalScore = blend * baseScore + (1 - blend) * prior;
    fallbacks.push('cold_start_prior_blend');
  }

  if (!availability.freshness) {
    fallbacks.push('freshness_missing');
  }

  if (!availability.popularity) {
    fallbacks.push('popularity_missing');
  }

  return {
    package_id: input.package_id,
    score: roundScore(finalScore),
    status: 'scored',
    components: {
      relevance: roundScore(relevance),
      freshness: roundScore(freshness),
      popularity: roundScore(popularity),
      ctr: roundScore(ctr),
      action_rate: roundScore(actionRate),
      cold_start_blend: roundScore(coldStartBlend)
    },
    lineage: {
      ranking_model_version: 'ranking-v0-foundation',
      embedding_model_version: resolveEmbeddingModelVersion(input),
      vector_collection_version: resolveVectorCollectionVersion(input),
      semantic_fallback: Boolean(input.semantic_fallback),
      deterministic_contract: 'fixed-weight-v0',
      feature_gates: gates,
      feature_availability: availability,
      fallbacks_used: [...new Set(fallbacks)]
    }
  };
}

export * from './hybrid-retrieval.js';
export * from './retrieval-service.js';
export * from './retrieval-sync.js';
export * from './postgres-bm25-retriever.js';
export * from './qdrant-semantic-retriever.js';
export * from './embedding-provider.js';
