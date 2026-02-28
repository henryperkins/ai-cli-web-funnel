# v1 Lifecycle API Contract

Status: Frozen (`v1.0.0`)
Last Updated: 2026-02-28

## Scope

This document freezes Forge install lifecycle API contracts for v1 control-plane operations.

Primary implementation references:
1. `packages/shared-contracts/src/install-lifecycle.ts`
2. `apps/control-plane/src/install-lifecycle.ts`
3. `apps/control-plane/src/http-app.ts`

## Contract Version Marker

`INSTALL_LIFECYCLE_CONTRACT_VERSION = "v1.0.0"` (exported from `@forge/shared-contracts`).

Any breaking change requires:
1. version bump in shared contracts,
2. updated migration/compatibility notes in this doc,
3. `DECISION_LOG.md` entry with rollout strategy.

## Endpoints

Plan/read:
1. `POST /v1/install/plans`
2. `GET /v1/install/plans/:plan_id`

Lifecycle operations:
1. `POST /v1/install/plans/:plan_id/apply`
2. `POST /v1/install/plans/:plan_id/install` (alias)
3. `POST /v1/install/plans/:plan_id/update`
4. `POST /v1/install/plans/:plan_id/remove`
5. `POST /v1/install/plans/:plan_id/uninstall` (alias)
6. `POST /v1/install/plans/:plan_id/rollback`
7. `POST /v1/install/plans/:plan_id/verify`

## Idempotency Contract

Scope keys:
1. `POST:/v1/install/plans`
2. `POST:/v1/install/plans/:id/apply`
3. `POST:/v1/install/plans/:id/update`
4. `POST:/v1/install/plans/:id/remove`
5. `POST:/v1/install/plans/:id/rollback`
6. `POST:/v1/install/plans/:id/verify`

Invariant:
1. same key + same request hash => replay (`x-idempotent-replay: true`)
2. same key + different request hash => conflict

## Response Stability Requirements

Create plan response (v1) includes:
1. identity/status fields (`plan_id`, `package_id`, `status`, `replayed`)
2. policy summary (`policy_outcome`, `policy_reason_code`, `security_state`)
3. action summary (`action_count`)
4. dependency summary (`dependency_resolution`, when supplied)
5. explainability payload (`explainability`) with deterministic ordering

Operation responses include:
1. stable status enum per operation,
2. `attempt_number`,
3. `reason_code`,
4. policy decision snapshot (`policy_decision`).

## Error Taxonomy

HTTP/status-reason behavior uses shared constants in `INSTALL_LIFECYCLE_HTTP_ERROR_REASON`.

Deterministic behavior requirements:
1. reason codes are machine-readable and stable,
2. dependency/policy conflicts are returned in deterministic order,
3. invalid transitions are explicit (`*_invalid_plan_state`, etc.).

## Breaking-Change Policy (v1)

Breaking examples:
1. removing or renaming endpoint paths,
2. changing idempotency invariants,
3. removing response fields required by contract tests,
4. changing meaning of existing reason codes.

Required procedure:
1. add version bump,
2. add decision-log entry,
3. add compatibility/migration notes,
4. extend contract tests before rollout.
