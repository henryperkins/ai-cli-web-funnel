# Security Trust-Gate Operations

## Scope

Operator runbook for trust-gate metrics snapshots, rollout decision evaluation, and permanent block promotion workflows.

Implemented in:
1. `scripts/run-security-trust-gates.mjs`
2. `scripts/run-security-promotion.mjs`
3. `packages/security-governance/src/index.ts`
4. `packages/security-governance/src/postgres-adapters.ts`
5. `infra/postgres/migrations/016_security_appeals_and_trust_gates.sql`

## Safety Defaults

1. Use `--mode dry-run` first for all trust-gate commands.
2. Promotion command requires explicit reviewer evidence reference (`--evidence-ref`).
3. Replay-safe posture: trust-gate decisions are keyed by `run_id` (`ON CONFLICT (run_id)` upsert).
4. Rollout state writes are singleton upserts; use unique `run_id` per scheduled window.
5. Do not store plaintext secrets in evidence summaries.

## Commands

1. Snapshot trust-gate metrics (read-only):
   - `npm run run:security-trust-gates -- --mode dry-run --action snapshot --window-from <iso> --window-to <iso>`
2. Evaluate trust-gate decision (dry-run, no DB mutation):
   - `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger manual`
3. Evaluate trust-gate decision (production, persists rollout decision/state):
   - `npm run run:security-trust-gates -- --mode production --action evaluate --run-id <run-id> --window-from <iso> --window-to <iso> --trigger weekly`
4. Validate permanent promotion eligibility (dry-run):
   - `npm run run:security-promotion -- --mode dry-run --package-id <uuid> --reviewer-id <id> --evidence-ref <ticket-id>`
5. Execute permanent promotion (production):
   - `npm run run:security-promotion -- --mode production --package-id <uuid> --reviewer-id <id> --reason-code policy_blocked_malware --reviewer-confirmed-at <iso> --evidence-ref <ticket-id> --evidence-summary <summary>`

## Replay-Safe Guidance

1. Decision replay:
   - same `run_id` re-evaluates the same decision row (upsert), avoiding duplicate rows.
   - use a new `run_id` only for a new evaluation window or rerun with changed evidence.
2. Promotion replay:
   - run dry-run validation first.
   - rerun production only after confirming the prior execution result and action state.
3. Window discipline:
   - keep windows non-overlapping for scheduled evaluations unless intentionally replaying a missed run.

## Symptom -> cause -> fix

1. `FORGE_DATABASE_URL or DATABASE_URL is required.`
   - Cause: DB env is missing.
   - Fix: set DB URL and rerun dry-run before production mode.
2. `perm_block_requirements_not_met` or `status=rejected`
   - Cause: two-source/reviewer requirements are not satisfied.
   - Fix: capture additional corroborating evidence, confirm reviewer sign-off, rerun dry-run validation.
3. `invalid --window-from/--window-to` or parse errors
   - Cause: malformed ISO timestamps or inverted window bounds.
   - Fix: pass valid ISO-8601 UTC timestamps and ensure `window_from < window_to`.
4. decision unexpectedly freezes to `raw-only`
   - Cause: one or more trust gates failed (false-positive, appeals SLA, or backlog).
   - Fix: inspect structured log payload gate booleans/evidence, remediate metric source issues, rerun dry-run.
5. `security_promotion.run_failed` with transient DB errors
   - Cause: connectivity/lock issue during promotion call.
   - Fix: verify DB health, retry dry-run, then rerun production once healthy.

## Validation Checks

1. `npx vitest run tests/contract/migration-wave10.contract.test.ts`
2. `npx vitest run tests/integration-db/security-trust-gates.integration-db.test.ts --maxWorkers=1`
3. `npm run test:integration-db:docker`
