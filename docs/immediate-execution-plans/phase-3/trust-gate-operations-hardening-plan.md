# Phase 3 Plan: Trust-Gate Operations Hardening

Owner: Security Governance + Platform
Priority: `P0`
Status: In Progress (2026-02-28)

## Objective

Convert Wave 10 trust-gate logic from test-proven internals into explicit operator commands with replay-safe dry-run posture and production controls.

## In Scope

1. Add operator script for trust-gate metrics snapshot + decision evaluation.
2. Add operator script for permanent block promotion workflow with reviewer evidence inputs.
3. Add npm script wrappers and structured logs.
4. Add runbook guidance with symptom -> cause -> fix and replay-safe escalation paths.
5. Add trust-gate dry-run checks to ops smoke workflow.

## Out of Scope

1. New trust-policy semantics beyond current DR-017/DR-019 implementation.
2. Destructive rollback behavior.

## Implementation Steps

1. Implement `scripts/run-security-trust-gates.mjs` (`--mode dry-run|production`, `--action snapshot|evaluate`).
2. Implement `scripts/run-security-promotion.mjs` (`--mode dry-run|production`) with reviewer inputs.
3. Wire root `package.json` scripts.
4. Extend `.github/workflows/forge-ops-smoke.yml` with non-blocking trust-gate dry-run steps + logs + summary rows.
5. Update `docs/runbooks/cron-go-live-checklist.md` and related runbook docs.

## File Touchpoints

1. `scripts/run-security-trust-gates.mjs`
2. `scripts/run-security-promotion.mjs`
3. `package.json`
4. `.github/workflows/forge-ops-smoke.yml`
5. `docs/runbooks/cron-go-live-checklist.md`
6. `docs/ci-verification.md`

## Validation

1. `npm run run:security-trust-gates -- --mode dry-run --action snapshot --window-from <iso> --window-to <iso>`
2. `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger manual`
3. `npm run run:security-promotion -- --mode dry-run --package-id <uuid> --reviewer-id <id> --evidence-ref <ticket>`
4. `npx vitest run tests/integration-db/security-trust-gates.integration-db.test.ts --maxWorkers=1`

## Exit Criteria

1. Operators can run trust-gate snapshot/evaluation without test harness code.
2. Promotion flow supports explicit dry-run and reviewer evidence context.
3. Ops smoke reports trust-gate command outcomes with retained logs.
