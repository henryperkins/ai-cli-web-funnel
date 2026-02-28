# E3-S1 Plan: Dependency Graph Expansion and Transitive Resolution

Story: `E3-S1`
Owner: Control Plane + Policy Engine
Priority: `P0`
Status: Completed

## Objective

Expand install planning to include dependency graph construction and deterministic transitive resolution.

## In Scope

1. Dependency graph model for package relationships.
2. Deterministic transitive dependency expansion during plan creation.
3. Conflict-safe action ordering for dependency-first install actions.
4. Plan output fields that expose resolved dependency set.

## Out of Scope

1. Advanced conflict remediation UX text (covered in `E3-S3`).
2. Runtime adapter-specific dependency semantics beyond plan layer.

## Implementation Steps

1. Model dependency inputs.

- Define dependency fields in catalog/package structures used by planner.
- Validate schema constraints for dependency references.

2. Build graph resolver.

- Implement deterministic traversal with cycle detection.
- Ensure stable ordering (for example topological + deterministic tie-break).

3. Integrate into planner.

- Update install planning service to include dependencies in generated actions.
- Preserve idempotency/replay semantics for identical requests.

4. Conflict handling baseline.

- Emit deterministic conflict status when graph is invalid (missing node, cycle, incompatible requirement).
- Keep failure taxonomy machine-readable.

5. Test coverage.

- Add unit tests for acyclic graph resolution, cycle detection, duplicate dependency edges, and deterministic order.
- Add integration-db or integration-contract coverage for plan outputs with dependencies.

6. Documentation.

- Update API docs/build report sections with dependency resolution behavior.

## File Touchpoints

1. `apps/control-plane/src/install-lifecycle.ts`
2. `apps/control-plane/src/http-app.ts` (if response schema expands)
3. `packages/shared-contracts/src/` (if new plan response fields are added)
4. `tests/` (unit + integration/contract)
5. `docs/` (planner behavior documentation)

## Validation Commands

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. Targeted planner tests (new suites)

## Risks and Mitigations

1. Risk: non-deterministic plan ordering.
   Mitigation: explicit deterministic sort keys and snapshot-style test assertions.

2. Risk: large dependency graph performance impact.
   Mitigation: bounded traversal guards and early conflict exits.

## Exit Criteria

1. Plan responses include deterministic dependency expansion results.
2. Cycles and invalid references fail with explicit taxonomy.
3. Planner tests prove stable results across repeated runs.

## Execution Notes (2026-02-28)

1. Added dependency graph contracts and pure resolver in `packages/shared-contracts/src/dependency-graph.ts` with deterministic topological ordering, cycle detection, duplicate-edge detection, and missing-dependency taxonomy.
2. Integrated dependency resolution into `createInstallLifecycleService.createPlan` with optional request fields (`dependency_edges`, `known_package_ids`) and response field `dependency_resolution`.
3. Expanded HTTP route handling in `apps/control-plane/src/http-app.ts`:
   - validates dependency payloads,
   - forwards dependency fields to planner,
   - maps `dependency_resolution_failed:` to deterministic 422 response.
4. Test coverage added:
   - `packages/shared-contracts/tests/dependency-graph.test.ts` (16 resolver tests),
   - `apps/control-plane/tests/install-lifecycle-dependencies.test.ts` (planner integration),
   - `apps/control-plane/tests/http-app.test.ts` (request validation + error mapping).
