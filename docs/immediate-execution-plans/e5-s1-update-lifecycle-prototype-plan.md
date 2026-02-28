# E5-S1 Plan: Update Lifecycle Prototype

Story: `E5-S1`
Owner: Control Plane
Priority: `P0`
Status: Completed

## Objective

Prototype update lifecycle flow so existing install plans can transition to version-aware updates with replay-safe behavior.

## In Scope

1. Design and prototype API path for update execution.
2. Reuse existing idempotency and audit patterns from apply/verify.
3. Define minimal persistence strategy for update attempts.
4. Add prototype tests and operational notes.

## Out of Scope

1. Full remove/uninstall implementation (`E5-S2`).
2. Full rollback endpoint implementation (`E5-S3`).
3. Complete UI integration.

## Implementation Steps

1. Contract design.

- Define request/response shape for update action (for example `POST /v1/install/plans/:plan_id/update`).
- Align response taxonomy with existing apply/verify endpoints.

2. Persistence and audit model.

- Reuse/install extension of lifecycle attempt tables as needed.
- Preserve replay semantics: same idempotency key + same request hash => replay.

3. Prototype handler implementation.

- Add update flow to lifecycle service and HTTP wiring.
- Keep behavior feature-flagged if needed for safe rollout.

4. Test plan.

- Unit tests: successful update, replay, conflict, invalid plan state.
- Integration tests: persisted attempts and status transitions.

5. Documentation.

- Add prototype constraints and known limitations to docs/build report.

## File Touchpoints

1. `apps/control-plane/src/install-lifecycle.ts`
2. `apps/control-plane/src/http-app.ts`
3. `apps/control-plane/src/postgres-adapters.ts` (if update persistence is added)
4. `tests/` (unit + integration)
5. `docs/` (prototype notes)

## Validation Commands

1. `npm run typecheck`
2. `npm run test`
3. `npm run check`
4. `npm run test:integration-db:docker` (if DB paths are touched)

## Risks and Mitigations

1. Risk: update semantics diverge from apply/verify idempotency behavior.
   Mitigation: enforce shared idempotency helper and conflict tests.

2. Risk: state transition ambiguity.
   Mitigation: explicit allowed transition matrix in code and tests.

## Exit Criteria

1. Prototype endpoint/service path exists and is test-covered.
2. Idempotency and audit semantics match existing lifecycle patterns.
3. Prototype limitations are documented for follow-on stories (`E5-S2`, `E5-S3`).

## Execution Notes (2026-02-28)

1. Added prototype update method in lifecycle service:
   - `apps/control-plane/src/install-lifecycle.ts` now exposes `updatePlan(planId, idempotencyKey, correlationId, targetVersion?)`.
2. Added update HTTP endpoint:
   - `POST /v1/install/plans/:plan_id/update` in `apps/control-plane/src/http-app.ts`.
3. Prototype persistence/audit strategy:
   - reuses `install_apply_attempts` for update attempts (`details.operation = "update"`),
   - reuses `install_plan_audit` stage `apply` with `event_type` `install.update.succeeded|failed`,
   - preserves idempotency replay/conflict semantics via existing idempotency adapter.
4. Added prototype tests:
   - `apps/control-plane/tests/install-lifecycle-update.test.ts` (success, replay, conflict, invalid state),
   - `apps/control-plane/tests/http-app.test.ts` update-route coverage,
   - `tests/e2e/discover-plan-apply-verify-local.e2e.test.ts` update-path assertion.

### Known Prototype Limitations

1. Update currently reuses install/apply status space (`apply_succeeded` / `apply_failed`) for persisted plan status transitions.
2. No dedicated remove/rollback behavior is included (deferred to `E5-S2` and `E5-S3`).
3. No UI-level update orchestration is included in this slice.
