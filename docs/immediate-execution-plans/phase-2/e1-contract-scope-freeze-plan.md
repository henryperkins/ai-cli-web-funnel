# E1 Plan: Contract and Scope Freeze

Stories: `E1-S1`, `E1-S2`, `E1-S3`
Owner: Product + Platform Foundations + Shared Contracts
Priority: `P0`
Status: Done (2026-02-28)

## Objective

Freeze Forge v1 product contract boundaries (metadata schema, lifecycle API contract, and compatibility matrix) so all subsequent implementation work is against a stable target.

## In Scope

1. v1 addon metadata contract for MCP servers, skills, and plugins.
2. v1 lifecycle API contract for `discover/plan/install/verify/update/remove`.
3. Compatibility matrix by client, runtime mode, and support level.
4. Governance and versioning rules for contract changes.

## Out of Scope

1. New feature behavior beyond contract shape and validation.
2. Adapter implementation details (covered in `E4`).

## Implementation Steps

1. Freeze metadata contract (`E1-S1`).
- Define canonical required vs optional fields.
- Define source lineage and normalization expectations.
- Add schema version marker and compatibility rules.

2. Freeze lifecycle API contract (`E1-S2`).
- Define endpoint request/response schemas.
- Define consistent error taxonomy and idempotency semantics across lifecycle endpoints.
- Define backward-compatibility policy.

3. Publish compatibility matrix (`E1-S3`).
- Enumerate supported clients and modes (`local`, `remote`, transport variants).
- Mark support level (`ga`, `beta`, `planned`) per client/mode.
- Link matrix from root docs.

4. Governance closure.
- Add decision-log entry for contract freeze acceptance.
- Record any governance dependencies (AQ/MQ/DR references).

## File Touchpoints

1. `packages/shared-contracts/src/`
2. `apps/control-plane/src/http-app.ts`
3. `docs/README.md`
4. `README.md`
5. `application_decision_records.md`
6. `DECISION_LOG.md`

## Validation Commands

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`

## Exit Criteria

1. Contracts are versioned and documented.
2. Compatibility matrix is published and linked from root/docs indexes.
3. Change-control policy for breaking changes is documented.
4. Freeze decision is recorded in `DECISION_LOG.md`.
