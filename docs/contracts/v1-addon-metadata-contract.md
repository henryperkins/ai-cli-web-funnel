# v1 Addon Metadata Contract

Status: Frozen (`v1.0.0`)
Last Updated: 2026-02-28

## Scope

This document freezes the v1 metadata contract used by Forge catalog ingest and package read/search APIs.

Primary implementation references:
1. `packages/catalog/src/index.ts`
2. `packages/catalog/src/postgres-adapters.ts`
3. `apps/control-plane/src/catalog-routes.ts`
4. `packages/shared-contracts/src/constants.ts`

## Contract Version Marker

`ADDON_METADATA_CONTRACT_VERSION = "v1.0.0"` (exported from `@forge/shared-contracts`).

Any breaking change to this contract requires:
1. version marker bump,
2. compatibility notes in this doc,
3. `DECISION_LOG.md` entry describing migration path and impact.

## Canonical Package Record (read model)

Forge package records expose:
1. `package_id` (UUID string)
2. `package_slug` (string or null)
3. `canonical_repo` (string or null)
4. `updated_at` (ISO timestamp)

Detail view also includes:
1. `aliases[]` ordered by `alias_type`, then `alias_value`
2. `lineage_summary[]` with deterministic latest-source selection per field

## Ingest Input Contract (normalized candidate)

`CatalogSourceCandidate` shape (normalized before merge):
1. identity anchors: `github_repo_id`, `github_repo_locator`, `registry_package_locator`, `tool_kind`
2. metadata anchors: `source_name`, `source_updated_at`, `package_slug`, `canonical_repo`
3. merge fields: `fields` map (merge precedence rules apply)
4. alias candidates: `aliases[]`

Determinism rules:
1. candidate ordering must be stable via `compareSourceCandidates`.
2. alias output must be deduped and stably sorted.
3. normalized strings are lowercase/trimmed where specified by connector rules.

## Supported Source Families in v1

GA source families:
1. `github`
2. `npm`
3. `pypi`
4. `docs` (document/web source mode)

The ingest runner also supports direct normalized runs via JSON input (`runs[]` or root object).

## API Surface Boundaries

Package read endpoints using this contract:
1. `GET /v1/packages`
2. `GET /v1/packages/:package_id`
3. `POST /v1/packages/search`

Search responses may enrich ranking/action fields, but package identity fields above remain stable for v1.

## Breaking-Change Policy (v1)

Breaking examples:
1. removing/renaming required package record fields,
2. changing ID type semantics,
3. changing deterministic alias ordering guarantees,
4. changing merge precedence semantics without compatibility path.

For any breaking example, maintain old and new behavior in parallel only via explicit compatibility bridge and migration notes.
