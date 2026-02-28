# Cron Go-Live Checklist

## Scope
Checklist for enabling governance cron classes that mutate security state (score recompute, expiry reconciliation, trust-gate promotion decisions).

## Operator commands
1. Snapshot trust-gate metrics (read-only):
   - `npm run run:security-trust-gates -- --mode dry-run --action snapshot --window-from <iso> --window-to <iso>`
2. Evaluate trust-gate decision in dry-run:
   - `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger manual`
3. Evaluate trust-gate decision in production:
   - `npm run run:security-trust-gates -- --mode production --action evaluate --run-id <run-id> --window-from <iso> --window-to <iso> --trigger weekly`
4. Validate permanent promotion in dry-run:
   - `npm run run:security-promotion -- --mode dry-run --package-id <uuid> --reviewer-id <id> --evidence-ref <ticket-id>`
5. Execute permanent promotion in production:
   - `npm run run:security-promotion -- --mode production --package-id <uuid> --reviewer-id <id> --evidence-ref <ticket-id> --evidence-summary <summary>`

## Preconditions
1. `npm run verify:migrations:dr018` passes.
2. `npm run test:integration-contract` passes for migration and job contracts.
3. `npm run test:integration-db:docker` (or equivalent shared DB run) passes with current migrations.
4. Backup/PITR checkpoint exists for the target database.

## Stage 1: Dry-run
1. Run each cron class in `dry-run` mode and capture output artifact (timestamp, run_id, window).
2. Confirm no mutable tables changed (`security_enforcement_actions`, `security_enforcement_projections`, `security_enforcement_rollout_state`, `security_enforcement_promotion_decisions`).
3. Verify expected metric snapshots exist in logs for:
   - false-positive numerator/denominator
   - appeals SLA numerator/denominator
   - unresolved critical backlog breach count

## Stage 2: Shadow
1. Run cron classes in `shadow` mode.
2. Persist shadow evidence payloads and compare against dry-run outputs.
3. Reconciliation gate:
   - no divergence in computed gate pass/fail booleans
   - deterministic dedupe key behavior for outbox-driven jobs

## Stage 3: Replay and Recovery Tests
1. Missed-run replay: execute window re-run and verify idempotent behavior.
2. Duplicate-run replay: execute same `run_id` and verify decision row upsert/idempotency.
3. Partial-failure recovery: force a failure after claim and re-run to confirm safe completion.
4. Record replay evidence and reconciliation SQL snapshots in rollout ticket.

## Stage 4: Production Enablement
1. Enable production mode for one cron class at a time.
2. After each enablement, run reconciliation queries:
   - projection/action parity
   - rollout state singleton correctness
   - promotion decision row for current `run_id`
3. Confirm on-call handoff includes:
   - freeze trigger conditions
   - compensating rollback path
   - pager escalation contacts

## Incident Triage and Rollback
1. If any gate regresses or job errors exceed tolerance, switch rollout state to `raw-only` with `freeze_active=true`.
2. Stop production cron execution and continue in dry-run while investigating.
3. Use forward compensating migration/updates only; do not run destructive down scripts.
4. Append incident evidence to `DECISION_LOG.md` and the active rollout ticket.

## Symptom -> cause -> fix
1. `security_trust_gate.run_failed` with DB-url errors
   - Cause: operator environment missing DB configuration.
   - Fix: set `FORGE_DATABASE_URL` (or `DATABASE_URL`) and rerun dry-run.
2. `security_trust_gate.evaluate_completed` reports freeze + `decided_mode=raw-only`
   - Cause: one or more gates failed (`false_positive`, `appeals_sla`, or backlog).
   - Fix: review gate evidence in log payload, remediate source metrics, rerun dry-run before production.
3. `security_promotion.production_completed` returns `status=rejected`
   - Cause: two-source/reviewer confirmation requirements were not met.
   - Fix: gather corroborating reports + reviewer confirmation, rerun promotion dry-run.
4. repeated run with same `run_id` produces unexpected updates
   - Cause: run-id reuse across different evaluation windows.
   - Fix: keep same `run_id` only for replay of the same window; generate a new run-id for new windows.
