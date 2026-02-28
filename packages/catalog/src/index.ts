import {
  buildIdentityConflictRecord,
  resolveMergedRecord,
  resolvePackageIdentity,
  type FieldCandidate,
  type MergeField,
  type ToolKind
} from '@forge/shared-contracts';

export type CatalogAliasType = 'repo_rename' | 'url_alias' | 'registry_alias';

export interface CatalogSourceAliasCandidate {
  alias_type: CatalogAliasType;
  alias_value: string;
  source_name?: string;
  active?: boolean;
}

export interface CatalogSourceCandidate {
  source_name: string;
  source_updated_at?: string | null;
  github_repo_id?: number | string;
  github_repo_locator?: string;
  registry_package_locator?: string;
  subpath?: string | null;
  tool_kind: ToolKind;
  primary_registry_name?: string | null;
  package_slug?: string | null;
  canonical_repo?: string | null;
  aliases?: CatalogSourceAliasCandidate[];
  fields?: Partial<Record<MergeField, unknown>>;
}

export interface CatalogIngestInput {
  merge_run_id: string;
  occurred_at: string;
  source_snapshot?: Record<string, unknown>;
  detected_by?: string;
  review_sla_hours?: number;
  registry_to_github_map?: Record<string, string>;
  candidates: CatalogSourceCandidate[];
}

export interface CatalogPackageCandidate {
  package_id: string;
  package_slug: string | null;
  canonical_repo: string | null;
  repo_aliases: string[];
  tool_kind: ToolKind;
  identity_state: 'canonical' | 'provisional';
  merge_run_id: string;
}

export interface CatalogAliasCandidate {
  package_id: string;
  alias_type: CatalogAliasType;
  alias_value: string;
  source_name: string;
  active: boolean;
}

export interface CatalogFieldLineageCandidate {
  package_id: string;
  field_name: string;
  field_value_json: unknown;
  field_source: string;
  field_source_updated_at: string | null;
  merge_run_id: string;
}

export interface CatalogConflictCandidate {
  conflict_fingerprint: string;
  canonical_locator_candidate: string;
  conflicting_aliases: string[];
  detected_by: string;
  status: 'open';
  review_sla_hours: number;
  review_due_at: string;
}

export interface CatalogIngestResult {
  merge_run_id: string;
  occurred_at: string;
  source_snapshot: Record<string, unknown>;
  requires_manual_review: boolean;
  resolution_path: 'canonical_repo_id' | 'github_locator' | 'registry_map' | 'manual_review';
  package_candidate: CatalogPackageCandidate | null;
  alias_candidates: CatalogAliasCandidate[];
  field_lineage: CatalogFieldLineageCandidate[];
  conflicts: CatalogConflictCandidate[];
}

const PACKAGE_SLUG_SOURCE_ORDER = [
  'smithery',
  'glama',
  'github',
  'mcp.so',
  'registry',
  'npm',
  'pypi'
] as const;

const MERGE_FIELDS: MergeField[] = [
  'githubRepoId',
  'ownerIdentity',
  'name',
  'description',
  'toolKind',
  'domainCategory',
  'capabilities',
  'permissions',
  'io',
  'installCommand',
  'configTemplate',
  'runtimeRequirements',
  'ratings',
  'stars',
  'downloads',
  'lastUpdated',
  'tags'
];

const MERGE_FIELD_SET = new Set<MergeField>(MERGE_FIELDS);

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeAliasValue(value: string): string {
  return value.trim().toLowerCase();
}

function toEpoch(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareSourceCandidates(
  left: CatalogSourceCandidate,
  right: CatalogSourceCandidate
): number {
  const leftHasRepoId = left.github_repo_id !== undefined && left.github_repo_id !== null;
  const rightHasRepoId = right.github_repo_id !== undefined && right.github_repo_id !== null;
  if (leftHasRepoId !== rightHasRepoId) {
    return leftHasRepoId ? -1 : 1;
  }

  const leftHasRepoLocator = Boolean(left.github_repo_locator);
  const rightHasRepoLocator = Boolean(right.github_repo_locator);
  if (leftHasRepoLocator !== rightHasRepoLocator) {
    return leftHasRepoLocator ? -1 : 1;
  }

  const leftHasRegistryLocator = Boolean(left.registry_package_locator);
  const rightHasRegistryLocator = Boolean(right.registry_package_locator);
  if (leftHasRegistryLocator !== rightHasRegistryLocator) {
    return leftHasRegistryLocator ? -1 : 1;
  }

  const sourceDelta = left.source_name.localeCompare(right.source_name);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  const updatedDelta = toEpoch(right.source_updated_at) - toEpoch(left.source_updated_at);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const toolKindDelta = left.tool_kind.localeCompare(right.tool_kind);
  if (toolKindDelta !== 0) {
    return toolKindDelta;
  }

  return (left.subpath ?? '').localeCompare(right.subpath ?? '');
}

function resolvePackageSlug(candidates: CatalogSourceCandidate[]): string | null {
  const slugCandidates = candidates
    .map((candidate) => {
      const normalized = normalizeNullableString(candidate.package_slug);
      if (!normalized) {
        return null;
      }

      const precedenceIndex = PACKAGE_SLUG_SOURCE_ORDER.indexOf(
        candidate.source_name as (typeof PACKAGE_SLUG_SOURCE_ORDER)[number]
      );

      return {
        source_name: candidate.source_name,
        source_updated_at: candidate.source_updated_at ?? null,
        value: normalized,
        precedence: precedenceIndex === -1 ? Number.POSITIVE_INFINITY : precedenceIndex
      };
    })
    .filter((candidate): candidate is {
      source_name: string;
      source_updated_at: string | null;
      value: string;
      precedence: number;
    } => candidate !== null)
    .sort((left, right) => {
      const precedenceDelta = left.precedence - right.precedence;
      if (precedenceDelta !== 0) {
        return precedenceDelta;
      }

      const updatedDelta = toEpoch(right.source_updated_at) - toEpoch(left.source_updated_at);
      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      const sourceDelta = left.source_name.localeCompare(right.source_name);
      if (sourceDelta !== 0) {
        return sourceDelta;
      }

      return left.value.localeCompare(right.value);
    });

  const winner = slugCandidates[0];
  return winner ? winner.value : null;
}

function collectLineageCandidates(
  candidates: CatalogSourceCandidate[]
): Partial<Record<MergeField, FieldCandidate<unknown>[]>> {
  const map: Partial<Record<MergeField, FieldCandidate<unknown>[]>> = {};

  for (const candidate of candidates) {
    if (!candidate.fields) {
      continue;
    }

    for (const [field, value] of Object.entries(candidate.fields)) {
      if (!MERGE_FIELD_SET.has(field as MergeField)) {
        continue;
      }

      const key = field as MergeField;
      const entry: FieldCandidate<unknown> = {
        sourceName: candidate.source_name,
        sourceUpdatedAt: candidate.source_updated_at ?? null,
        value
      };

      const existing = map[key] ?? [];
      map[key] = [...existing, entry];
    }
  }

  return map;
}

function dedupeAliases(candidates: CatalogAliasCandidate[]): CatalogAliasCandidate[] {
  const seen = new Set<string>();
  const deduped: CatalogAliasCandidate[] = [];

  const ordered = [...candidates].sort((left, right) => {
    const typeDelta = left.alias_type.localeCompare(right.alias_type);
    if (typeDelta !== 0) {
      return typeDelta;
    }

    const valueDelta = left.alias_value.localeCompare(right.alias_value);
    if (valueDelta !== 0) {
      return valueDelta;
    }

    return left.source_name.localeCompare(right.source_name);
  });

  for (const candidate of ordered) {
    const key = `${candidate.alias_type}:${candidate.alias_value}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function addHours(occurredAt: string, hours: number): string {
  return new Date(Date.parse(occurredAt) + hours * 60 * 60 * 1000).toISOString();
}

export function createCatalogIngestService() {
  return {
    ingest(input: CatalogIngestInput): CatalogIngestResult {
      if (input.candidates.length === 0) {
        throw new Error('catalog_ingest_invalid: at least one source candidate is required');
      }

      const reviewSlaHours = Math.max(1, Math.trunc(input.review_sla_hours ?? 48));
      const detectedBy = input.detected_by ?? 'catalog-ingest';

      const sortedCandidates = [...input.candidates].sort(compareSourceCandidates);
      const pivotCandidate = sortedCandidates[0];
      if (!pivotCandidate) {
        throw new Error('catalog_ingest_invalid: failed to resolve identity pivot candidate');
      }

      const identityResolution = resolvePackageIdentity(
        {
          ...(pivotCandidate.github_repo_id !== undefined &&
          pivotCandidate.github_repo_id !== null
            ? { githubRepoId: pivotCandidate.github_repo_id }
            : {}),
          ...(pivotCandidate.github_repo_locator
            ? { githubRepoLocator: pivotCandidate.github_repo_locator }
            : {}),
          ...(pivotCandidate.registry_package_locator
            ? { registryPackageLocator: pivotCandidate.registry_package_locator }
            : {}),
          ...(pivotCandidate.subpath !== undefined
            ? { subpath: pivotCandidate.subpath }
            : {}),
          toolKind: pivotCandidate.tool_kind,
          ...(pivotCandidate.primary_registry_name
            ? { primaryRegistryName: pivotCandidate.primary_registry_name }
            : {})
        },
        {
          ...(input.registry_to_github_map
            ? { registryToGithubMap: input.registry_to_github_map }
            : {})
        }
      );

      if (identityResolution.requiresManualReview) {
        const conflictingAliases = sortedCandidates
          .flatMap((candidate) => candidate.aliases ?? [])
          .map((alias) => normalizeAliasValue(alias.alias_value))
          .filter((alias) => alias.length > 0)
          .sort((left, right) => left.localeCompare(right));

        const conflict = buildIdentityConflictRecord(
          identityResolution,
          detectedBy,
          conflictingAliases
        );

        return {
          merge_run_id: input.merge_run_id,
          occurred_at: input.occurred_at,
          source_snapshot: input.source_snapshot ?? {},
          requires_manual_review: true,
          resolution_path: 'manual_review',
          package_candidate: null,
          alias_candidates: [],
          field_lineage: [],
          conflicts: [
            {
              conflict_fingerprint: conflict.conflictFingerprint,
              canonical_locator_candidate: conflict.canonicalLocatorCandidate,
              conflicting_aliases: conflict.conflictingAliases,
              detected_by: conflict.detectedBy,
              status: 'open',
              review_sla_hours: reviewSlaHours,
              review_due_at: addHours(input.occurred_at, reviewSlaHours)
            }
          ]
        };
      }

      const packageId = identityResolution.packageId;
      const merged = resolveMergedRecord(
        collectLineageCandidates(sortedCandidates),
        input.merge_run_id
      );

      const packageSlug =
        resolvePackageSlug(sortedCandidates) ??
        normalizeNullableString(
          typeof merged.resolved.name === 'string' ? merged.resolved.name : null
        );
      const canonicalRepo =
        identityResolution.locatorInputs.githubRepoLocator ??
        normalizeNullableString(pivotCandidate.canonical_repo);

      const aliasCandidates: CatalogAliasCandidate[] = [];

      if (identityResolution.locatorInputs.githubRepoLocator) {
        aliasCandidates.push({
          package_id: packageId,
          alias_type: 'repo_rename',
          alias_value: normalizeAliasValue(identityResolution.locatorInputs.githubRepoLocator),
          source_name: 'identity_resolver',
          active: true
        });
      }

      if (identityResolution.locatorInputs.registryPackageLocator) {
        aliasCandidates.push({
          package_id: packageId,
          alias_type: 'registry_alias',
          alias_value: normalizeAliasValue(identityResolution.locatorInputs.registryPackageLocator),
          source_name: 'identity_resolver',
          active: true
        });
      }

      for (const candidate of sortedCandidates) {
        for (const alias of candidate.aliases ?? []) {
          const normalizedAlias = normalizeAliasValue(alias.alias_value);
          if (normalizedAlias.length === 0) {
            continue;
          }

          aliasCandidates.push({
            package_id: packageId,
            alias_type: alias.alias_type,
            alias_value: normalizedAlias,
            source_name: alias.source_name ?? candidate.source_name,
            active: alias.active ?? true
          });
        }

        const normalizedRepoLocator = normalizeNullableString(candidate.github_repo_locator);
        if (normalizedRepoLocator) {
          aliasCandidates.push({
            package_id: packageId,
            alias_type: 'url_alias',
            alias_value: normalizeAliasValue(normalizedRepoLocator),
            source_name: candidate.source_name,
            active: true
          });
        }
      }

      const dedupedAliases = dedupeAliases(aliasCandidates);

      const fieldLineage: CatalogFieldLineageCandidate[] = Object.entries(merged.lineage)
        .map(([fieldName, lineage]) => {
          if (!lineage) {
            return null;
          }

          return {
            package_id: packageId,
            field_name: fieldName,
            field_value_json: lineage.value,
            field_source: lineage.fieldSource,
            field_source_updated_at: lineage.fieldSourceUpdatedAt,
            merge_run_id: input.merge_run_id
          } satisfies CatalogFieldLineageCandidate;
        })
        .filter((entry): entry is CatalogFieldLineageCandidate => entry !== null)
        .sort((left, right) => left.field_name.localeCompare(right.field_name));

      return {
        merge_run_id: input.merge_run_id,
        occurred_at: input.occurred_at,
        source_snapshot: input.source_snapshot ?? {},
        requires_manual_review: false,
        resolution_path: identityResolution.resolutionPath,
        package_candidate: {
          package_id: packageId,
          package_slug: packageSlug,
          canonical_repo: canonicalRepo,
          repo_aliases: dedupedAliases
            .filter((alias) => alias.alias_type === 'repo_rename' || alias.alias_type === 'url_alias')
            .map((alias) => alias.alias_value)
            .sort((left, right) => left.localeCompare(right)),
          tool_kind: pivotCandidate.tool_kind,
          identity_state: identityResolution.identityState,
          merge_run_id: input.merge_run_id
        },
        alias_candidates: dedupedAliases,
        field_lineage: fieldLineage,
        conflicts: []
      };
    }
  };
}

export * from './postgres-adapters.js';
