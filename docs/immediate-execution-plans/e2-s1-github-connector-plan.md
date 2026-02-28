# E2-S1 Plan: GitHub Source Connector

Story: `E2-S1`
Owner: Catalog Team
Priority: `P0`
Status: Completed

## Objective

Implement a deterministic GitHub connector that ingests addon metadata into Forge catalog flow with replay-safe behavior.

## In Scope

1. Connector module for GitHub repository metadata retrieval.
2. Deterministic normalization into catalog ingest schema.
3. Idempotent ingest integration via existing catalog pipeline.
4. Unit tests for connector behavior and normalization edge cases.

## Out of Scope

1. Web/docs connector implementation (covered by `E2-S2`).
2. Full scheduled ingestion orchestration (covered by `E2-S3`).
3. UI enhancements for catalog browse.

## Implementation Steps

1. Define connector contract.

- Add/extend catalog source interface in `packages/catalog/src`.
- Standardize source record shape for GitHub repository and release metadata.

2. Implement GitHub client adapter.

- Create module (for example `packages/catalog/src/sources/github-connector.ts`).
- Support token-authenticated and unauthenticated modes.
- Handle pagination and rate-limit signaling deterministically.

3. Normalize metadata.

- Map GitHub data into canonical package fields (slug, repo id, source metadata, version hints).
- Preserve lineage fields used by identity merge runs.

4. Integrate with ingest runner.

- Wire connector into `scripts/run-catalog-ingest.mjs` behind explicit source-mode option.
- Keep deterministic dry-run path and non-destructive behavior.

5. Add tests.

- Unit tests for normalization and error handling.
- Integration-style test (fixture-based) through existing catalog ingest tests.

6. Document usage.

- Update relevant docs with connector flags, required env vars, and failure-class behavior.

## File Touchpoints

1. `packages/catalog/src/` (new connector + interface updates)
2. `packages/catalog/tests/` (new/updated tests)
3. `scripts/run-catalog-ingest.mjs`
4. `.env.example` (if connector env vars are needed)
5. `docs/` (connector usage notes)

## Validation Commands

1. `npm run test --workspace @forge/catalog`
2. `npm run typecheck`
3. `npm run test`
4. `npm run check`
5. `npm run run:catalog-ingest -- --mode dry-run --input <fixture-json>`

## Risks and Mitigations

1. Risk: GitHub API rate limits.
   Mitigation: bounded page sizes, retry/backoff policy, and explicit rate-limit failure classification.

2. Risk: inconsistent metadata quality.
   Mitigation: strict normalization rules and lineage markers for unresolved fields.

## Exit Criteria

1. GitHub connector ingests deterministic normalized records.
2. Connector path is test-covered and replay-safe.
3. Dry-run ingest output is stable across repeated runs.

## Execution Notes (2026-02-28)

1. Changed files:
   - `packages/catalog/src/sources/github-connector.ts`
   - `packages/catalog/src/index.ts`
   - `packages/catalog/tests/github-connector.test.ts`
   - `packages/catalog/tests/github-connector-ingest.test.ts`
   - `packages/catalog/tests/fixtures/github-repos.sample.json`
   - `scripts/run-catalog-ingest.mjs`
   - `DECISION_LOG.md` (`DLOG-0038`)
2. Commands run and results:
   - `npm run test --workspace @forge/catalog` -> PASS
   - `npm run typecheck` -> PASS
   - `npm run test` -> PASS
   - `npm run check` -> PASS
3. Deferred items:
   - Live GitHub API dry-run validation is deferred to follow-on source expansion work (`E2-S2`/`E2-S3`) because this execution used fixture-backed deterministic tests.
