export type MergeField =
  | 'githubRepoId'
  | 'ownerIdentity'
  | 'name'
  | 'description'
  | 'toolKind'
  | 'domainCategory'
  | 'capabilities'
  | 'permissions'
  | 'io'
  | 'installCommand'
  | 'configTemplate'
  | 'runtimeRequirements'
  | 'ratings'
  | 'stars'
  | 'downloads'
  | 'lastUpdated'
  | 'tags';

export interface FieldCandidate<T> {
  sourceName: string;
  sourceUpdatedAt?: string | null;
  value: T;
}

export interface ResolvedField<T> {
  value: T;
  fieldSource: string;
  fieldSourceUpdatedAt: string | null;
  mergeRunId: string;
}

export const FIELD_PRECEDENCE: Record<MergeField, string[]> = {
  githubRepoId: ['github'],
  ownerIdentity: ['github', 'verified_partner_claim', 'others'],
  name: ['smithery', 'glama', 'github', 'mcp.so', 'registry'],
  description: ['smithery', 'glama', 'github', 'mcp.so', 'registry'],
  toolKind: ['glama', 'smithery', 'registry_inference', 'github_topics'],
  domainCategory: ['smithery', 'glama', 'github_topics', 'mcp.so_tags'],
  capabilities: ['glama'],
  permissions: ['glama'],
  io: ['glama'],
  installCommand: ['smithery', 'registry_derived', 'readme_parse'],
  configTemplate: ['smithery'],
  runtimeRequirements: ['npm', 'pypi', 'inferred_docs'],
  ratings: ['mcp.so'],
  stars: ['github'],
  downloads: ['npm', 'pypi'],
  lastUpdated: [
    'github',
    'smithery',
    'glama',
    'mcp.so',
    'registry',
    'npm',
    'pypi',
    'registry_derived',
    'readme_parse',
    'inferred_docs',
    'github_topics',
    'mcp.so_tags'
  ],
  tags: ['smithery', 'glama', 'github', 'mcp.so', 'registry', 'npm', 'pypi', 'github_topics', 'mcp.so_tags']
};

const TAG_BLOCKLIST = new Set(['sponsored', 'promoted', 'ad', 'ads', 'clickbait', 'free-money']);
const TAG_SPAM_PATTERNS = [/^https?:\/\//i, /^www\./i, /(.)\1{4,}/, /[<>]/, /\s{2,}/];
const MAX_TAG_LENGTH = 40;
const MAX_TAGS = 25;

function toEpoch(timestamp?: string | null): number {
  if (!timestamp) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function precedenceIndex(field: MergeField, sourceName: string): number {
  const order = FIELD_PRECEDENCE[field];
  const index = order.indexOf(sourceName);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function compareCandidates<T>(field: MergeField, left: FieldCandidate<T>, right: FieldCandidate<T>): number {
  const precedenceDelta = precedenceIndex(field, left.sourceName) - precedenceIndex(field, right.sourceName);
  if (precedenceDelta !== 0) {
    return precedenceDelta;
  }

  const timestampDelta = toEpoch(right.sourceUpdatedAt) - toEpoch(left.sourceUpdatedAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.sourceName.localeCompare(right.sourceName);
}

function isSpamTag(tag: string): boolean {
  if (TAG_BLOCKLIST.has(tag)) {
    return true;
  }

  if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) {
    return true;
  }

  if (TAG_SPAM_PATTERNS.some((pattern) => pattern.test(tag))) {
    return true;
  }

  return false;
}

function resolveTags(candidates: FieldCandidate<unknown>[], mergeRunId: string): ResolvedField<string[]> | null {
  const ordered = [...candidates].sort((left, right) => compareCandidates('tags', left, right));
  if (ordered.length === 0) {
    return null;
  }

  const values = ordered.flatMap((candidate) => {
    if (!Array.isArray(candidate.value)) {
      return [];
    }

    return candidate.value
      .map((tag) => String(tag).trim().toLowerCase())
      .filter((tag) => tag.length > 0);
  });

  const deduped = [...new Set(values)]
    .filter((tag) => !isSpamTag(tag))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_TAGS);

  const first = ordered.at(0);
  if (!first) {
    return null;
  }

  return {
    value: deduped,
    fieldSource: 'union',
    fieldSourceUpdatedAt: first.sourceUpdatedAt ?? null,
    mergeRunId
  };
}

function resolveLastUpdated(
  candidates: FieldCandidate<unknown>[],
  mergeRunId: string
): ResolvedField<string> | null {
  const withTimestamps = candidates
    .map((candidate) => {
      const valueTimestamp = typeof candidate.value === 'string' ? toEpoch(candidate.value) : 0;
      const sourceTimestamp = toEpoch(candidate.sourceUpdatedAt);
      const effectiveTimestamp = Math.max(valueTimestamp, sourceTimestamp);

      return {
        candidate,
        effectiveTimestamp
      };
    })
    .filter((entry) => entry.effectiveTimestamp > 0)
    .sort((left, right) => {
      const timestampDelta = right.effectiveTimestamp - left.effectiveTimestamp;
      if (timestampDelta !== 0) {
        return timestampDelta;
      }

      const precedenceDelta =
        precedenceIndex('lastUpdated', left.candidate.sourceName) -
        precedenceIndex('lastUpdated', right.candidate.sourceName);
      if (precedenceDelta !== 0) {
        return precedenceDelta;
      }

      return left.candidate.sourceName.localeCompare(right.candidate.sourceName);
    });

  if (withTimestamps.length === 0) {
    return null;
  }

  const winner = withTimestamps.at(0);
  if (!winner) {
    return null;
  }

  return {
    value: new Date(winner.effectiveTimestamp).toISOString(),
    fieldSource: winner.candidate.sourceName,
    fieldSourceUpdatedAt: winner.candidate.sourceUpdatedAt ?? null,
    mergeRunId
  };
}

export function resolveFieldValue<T>(
  field: MergeField,
  candidates: FieldCandidate<T>[],
  mergeRunId: string
): ResolvedField<T> | ResolvedField<string[]> | ResolvedField<string> | null {
  const nonEmpty = candidates.filter((candidate) => candidate.value !== undefined && candidate.value !== null);
  if (nonEmpty.length === 0) {
    return null;
  }

  if (field === 'tags') {
    return resolveTags(nonEmpty as FieldCandidate<unknown>[], mergeRunId);
  }

  if (field === 'lastUpdated') {
    return resolveLastUpdated(nonEmpty as FieldCandidate<unknown>[], mergeRunId);
  }

  const winner = [...nonEmpty].sort((left, right) => compareCandidates(field, left, right)).at(0);
  if (!winner) {
    return null;
  }

  return {
    value: winner.value,
    fieldSource: winner.sourceName,
    fieldSourceUpdatedAt: winner.sourceUpdatedAt ?? null,
    mergeRunId
  };
}

export type MergeCandidateMap = Partial<Record<MergeField, FieldCandidate<unknown>[]>>;

export interface MergeResult {
  resolved: Partial<Record<MergeField, unknown>>;
  lineage: Partial<Record<MergeField, ResolvedField<unknown>>>;
}

export function resolveMergedRecord(candidatesByField: MergeCandidateMap, mergeRunId: string): MergeResult {
  const resolved: Partial<Record<MergeField, unknown>> = {};
  const lineage: Partial<Record<MergeField, ResolvedField<unknown>>> = {};

  for (const field of Object.keys(FIELD_PRECEDENCE) as MergeField[]) {
    const candidates = candidatesByField[field];
    if (!candidates || candidates.length === 0) {
      continue;
    }

    const resolvedField = resolveFieldValue(field, candidates, mergeRunId);
    if (!resolvedField) {
      continue;
    }

    resolved[field] = resolvedField.value;
    lineage[field] = resolvedField as ResolvedField<unknown>;
  }

  return { resolved, lineage };
}
