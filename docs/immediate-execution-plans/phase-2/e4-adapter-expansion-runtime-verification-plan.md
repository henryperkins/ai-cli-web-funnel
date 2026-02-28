# E4 Plan: Adapter Expansion and Runtime Verification

Stories: `E4-S1`, `E4-S2`, `E4-S3`, `E4-S4`
Owner: Runtime + Adapter Team
Priority: `P0`
Status: Not Started

## Objective

Complete GA adapter coverage and runtime verification reliability across top-priority clients/modes.

## In Scope

1. Implement adapters for top-priority clients from compatibility matrix.
2. Standardize adapter contract surface (`install`, `update`, `remove`, `verify`).
3. Add adapter health checks and startup diagnostics.
4. Add rollback-safe partial-failure handling for multi-action installs.

## Out of Scope

1. Long-tail client support outside v1 compatibility matrix.
2. UI-driven adapter configuration workflows.

## Implementation Steps

1. Adapter prioritization and contract baseline.
- Lock adapter targets from E1 compatibility matrix.
- Ensure shared adapter interface and conformance tests.

2. Implement/upgrade adapters.
- Add or extend adapter modules for prioritized clients.
- Ensure deterministic scope write/order behavior.

3. Add runtime health diagnostics.
- Standardize health check outputs and failure reason mapping.
- Ensure diagnostics remain non-secret.

4. Implement partial-failure safeguards.
- Add rollback-safe sequencing for multi-action apply paths.
- Ensure sidecar/config ownership protections remain intact.

5. Add tests and docs.
- Adapter contract tests per supported client.
- Update runtime runbooks with adapter-specific troubleshooting.

## File Touchpoints

1. `apps/copilot-vscode-adapter/src/`
2. `apps/runtime-daemon/src/`
3. `packages/shared-contracts/src/`
4. `tests/e2e/`
5. `docs/runbooks/`

## Validation Commands

1. `npm run test:e2e-local`
2. `npm run test`
3. `npm run check`
4. `npm run test:integration-db:docker`

## Exit Criteria

1. GA adapters pass shared adapter contract tests.
2. Health checks and diagnostics are deterministic.
3. Partial-failure behavior is rollback-safe and test-covered.
