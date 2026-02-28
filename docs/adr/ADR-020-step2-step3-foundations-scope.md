# ADR-020: Step 2/3 Foundations Scope and Guardrails

- Status: Proposed
- Date: 2026-02-27
- Owners: Platform Foundations
- Related IDs: AQ-013, AQ-049, AQ-050, AQ-057, MQ-011, MQ-012, MQ-014, MQ-015, MQ-017, MQ-019, MQ-021, MQ-033, MQ-034, MQ-035, MQ-038, DR-008, DR-009, DR-010, DR-011, DR-014, DR-015, DR-017, DR-018

## Context
Step 0/1 established monorepo scaffolding plus deterministic identity and merge-precedence contracts. The next wave must add event/fraud foundations and runtime/policy service boundaries without hardcoding unresolved AQ/MQ behavior.

## Decision
Implement Step 2/3 foundations as typed contracts and deterministic scaffolds, with conservative defaults and explicit feature gates for unresolved decisions.

Implementation scope for this wave:
1. Event schema v1 contract definitions and validators.
2. Control-plane ingestion scaffold with idempotency and persistence adapter interfaces.
3. Security/policy preflight projection contracts (flagged vs blocked behavior modeled but gated).
4. Ranking v0 deterministic scoring scaffold with explicit signal-availability gates.
5. Runtime daemon and adapter lifecycle contracts for policy-first startup ordering.
6. SQL baseline for `raw_events`, `event_flags`, and `trusted_metrics_staging` with compatibility posture (`registry_packages`) maintained.

Out of scope for this wave:
1. Production-grade DB/queue adapter implementations.
2. Full remote-mode transport implementations.
3. Approval-state changes for DR/AQ/MQ records.

## Traceability Map
| Implemented Item | Contract Anchor |
|---|---|
| Event envelope + runtime event additions | DR-010, MQ-038, Redline §3 + §14.8 |
| Raw ingestion + idempotency scaffold | DR-011, AQ-050, MQ-035 |
| Fraud outcome/state modeling + thresholds as reviewable contract | DR-014, MQ-011..MQ-014 |
| Enforcement projection for preflight | DR-008, MQ-033, AQ-050 |
| Runtime start ordering and trust transitions | DR-009, AQ-020, AQ-021, MQ-019, MQ-021 |
| Adapter scope discovery/write order contracts | DR-015, MQ-017, MQ-018 |
| Strict-mode flagged handling guard | DR-017, AQ-057 |
| Registry FK compatibility posture | DR-018, AQ-049, MQ-034 |

## Consequences
- Positive impacts:
  - Removes placeholder-only service entrypoints for Step 2/3 domains.
  - Establishes deterministic contracts that can be safely implemented in later waves.
  - Keeps unresolved governance decisions behind explicit guardrails.
- Risks:
  - Scaffold-only layers may be mistaken for production-ready behavior.
  - Additional integration glue is still required for live ingestion and enforcement.
- Follow-on work:
  - Wire concrete storage and queue adapters.
  - Implement cron jobs/projections on top of finalized approval decisions.

## Acceptance Criteria
1. All new service/package boundaries expose explicit typed contracts.
2. Event and preflight behavior is deterministic and covered by tests.
3. Compatibility-safe migration artifacts are additive and non-destructive.
4. No decision status is silently changed.

## Rollback / Reversal Plan
1. Revert this wave's migrations via forward compensating migration (no destructive down migration).
2. Keep feature flags in conservative defaults to disable any newly surfaced behavior.
3. Revert package/app entrypoint wiring to prior scaffold if integration instability is found.
