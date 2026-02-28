# Cron Go-Live Checklist

## Scope
Checklist for enabling governance cron classes that mutate security state (score recompute, expiry reconciliation, trust-gate promotion decisions).

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
