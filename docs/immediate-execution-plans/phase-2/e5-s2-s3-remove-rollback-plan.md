# E5-S2/S3 Plan: Remove/Uninstall and Rollback

Stories: `E5-S2`, `E5-S3`
Owner: Control Plane + Runtime
Priority: `P0`
Status: Done (2026-02-28)

## Objective

Finish lifecycle completeness by adding remove/uninstall support and rollback flows for failed lifecycle operations.

## In Scope

1. Remove/uninstall workflow with dependency safety checks.
2. Rollback endpoint/path for failed apply/update/remove attempts.
3. Persisted attempt/audit tracking for remove/rollback stages.
4. Lifecycle state transition guards and idempotent replay behavior.

## Out of Scope

1. Advanced policy exception UI.
2. Non-v1 adapter-specific uninstall enhancements.

## Implementation Steps

1. Implement remove workflow (`E5-S2`).
- Add endpoint/service path and state transition handling.
- Include dependency safety checks before remove execution.

2. Implement rollback flow (`E5-S3`).
- Add rollback endpoint/path with constrained valid source states.
- Reuse existing idempotency and correlation semantics.

3. Persist and audit behavior.
- Extend attempt/audit storage for remove/rollback operations.
- Ensure replay and conflict semantics match existing lifecycle behavior.

4. Add tests.
- Unit tests for happy path, invalid state, replay, and conflicts.
- Integration-db coverage for persisted attempts and transitions.

5. Update operations docs.
- Add remove/rollback procedures and symptom->cause->fix guidance.

## File Touchpoints

1. `apps/control-plane/src/install-lifecycle.ts`
2. `apps/control-plane/src/http-app.ts`
3. `apps/control-plane/src/postgres-adapters.ts`
4. `tests/`
5. `docs/runbooks/`

## Validation Commands

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run test:integration-db:docker`
5. `npm run test:e2e-local`

## Exit Criteria

1. Remove and rollback paths are implemented and test-covered.
2. State transitions are deterministic and guard invalid transitions.
3. Lifecycle audit data includes remove/rollback attempts.
