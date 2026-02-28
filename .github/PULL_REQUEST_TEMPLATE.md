## Summary
- Describe the user-visible and operational change.
- Link related DR(s), incident tickets, and rollout runbooks.

## Migration Scope
- Migration files touched:
- Zero-downtime posture (additive/concurrent/two-phase validation):
- Data backfill or replay requirement:

## Lock Risk / Impact
- Expected lock level and duration:
- Write/read paths potentially impacted:
- Mitigations (batching, low-traffic window, retry behavior):

## Rollback / Compensation Plan
- Forward compensating migration plan:
- Feature flags or kill switches:
- Recovery owner and estimated execution time:

## Verification Evidence
- `npm run verify:migrations:dr018`:
- Contract test output:
- Integration-db output:
- Additional smoke checks:

## Cron Go-Live Checklist
- [ ] Dry-run completed with no side effects.
- [ ] Shadow run completed with reconciliation proof.
- [ ] Replay/idempotency tests passed (missed run, duplicate run, partial failure).
- [ ] Production enablement approved with rollback owner assigned.

## Reviewer Sign-off
- [ ] DB reviewer approved lock/risk and compensation plan.
- [ ] Service owner approved runtime behavior and runbook updates.
- [ ] On-call owner approved cron go-live and incident triage coverage.
