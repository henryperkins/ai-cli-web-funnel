# E3-S2/S3 Plan: Plan Engine Hardening (Conflict Detection + Explanations)

Stories: `E3-S2`, `E3-S3`
Owner: Policy Engine + Control Plane
Priority: `P0`
Status: Done (2026-02-28)

## Objective

Harden the planning engine with deterministic conflict detection and explainable plan output for operator and client clarity.

## In Scope

1. Conflict detection for version/capability/runtime incompatibilities.
2. Deterministic conflict taxonomy and reason codes.
3. Explainability payload in plan responses (`why`, `risk`, `required_actions`).
4. Test coverage for positive and negative planning paths.

## Out of Scope

1. Plan simulation mode (`E3-S4`, P1).
2. UI rendering details for explanation payload.

## Implementation Steps

1. Implement conflict detection (`E3-S2`).
- Add checks in plan builder and/or policy engine integration.
- Ensure deterministic ordering and conflict precedence.

2. Add explainability payload (`E3-S3`).
- Extend plan response contract for explanation sections.
- Include machine-readable remediation details.

3. Preserve idempotency/replay semantics.
- Confirm identical request inputs produce identical outcomes.
- Keep conflict behavior replay-safe.

4. Add tests.
- Unit tests for each conflict class.
- Integration/contract tests for response payload invariants.

5. Document behavior.
- Update docs with conflict taxonomy and explanation fields.

## File Touchpoints

1. `apps/control-plane/src/install-lifecycle.ts`
2. `apps/control-plane/src/http-app.ts`
3. `packages/policy-engine/src/`
4. `packages/shared-contracts/src/`
5. `tests/`

## Validation Commands

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npx vitest run tests/contract/api-payload-invariants.contract.test.ts`

## Exit Criteria

1. Conflict detection is deterministic and test-covered.
2. Plan responses expose explainable remediation payloads.
3. Contract tests enforce payload invariants.
