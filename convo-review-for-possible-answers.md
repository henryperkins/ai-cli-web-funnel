# Forge Architecture & Strategy — Corrected Notes

## Scope

This document replaces speculative claims with source-of-truth statements from the architecture artifacts and decision registers.

## Source-of-truth hierarchy

1. `phase0_artifacts_redline.md` — runtime, governance, ranking, and Phase 0 constraints.
2. `artifact_6b_security_reporting_implementation.md` — API/SQL/job implementation details for enforcement and preflight integration.
3. `application_decision_records.md` — proposed decision package (DR-001 through DR-011).
4. `application_master_open_questions.md` — application-level status (open vs proposed).
5. `master_open_questions.md` — technical implementation open items.

---

## Core architecture (current-state)

Forge is a two-plane system with strict boundaries:

### A) Cloud control plane

- Catalog ingest and normalization into a unified registry.
- Search retrieval/ranking plus fraud-aware signals.
- Security governance for reporter intake, enforcement state transitions, and appeals.
- Policy/preflight decision surface for deterministic allow/deny checks.
- Analytics + billing pipelines based on fraud-filtered metrics.

### B) Local execution plane

- Local-first install proxy and runtime daemon.
- Scope-aware config ownership (workspace, user-profile, daemon default).
- Trust gate and permission prompts before execution.
- Process supervision / remote connectivity with health validation.
- Client adapters (Copilot-first rollout, others phased).

### C) Mandatory runtime start sequence

`policy_preflight -> trust_gate -> preflight_checks -> start_or_connect -> health_validate -> supervise`

### D) Trust and policy semantics

- Trust lifecycle: `untrusted -> trusted -> trust_expired`
- Terminal/override outcomes: `denied`, `policy_blocked`
- Trust reset triggers: major version bump, author/maintainer change, permission escalation, explicit user revoke.
- Policy denial always short-circuits trust/start.

### E) Runtime modes

- `local` (stdio supervision)
- `remote` (SSE / streamable HTTP)

Both modes must obey the same policy/trust ordering.

### F) Enforcement read path

- Preflight reads hot-path projection (`security_enforcement_current`) only.
- `policy_blocked_temp` / `policy_blocked_perm` => block install/runtime.
- `flagged` => allow with warning metadata.

---

## Data architecture (required)

- `raw_events`: append-only immutable event log.
- `event_flags`: fraud/rule outcomes.
- `trusted_metrics`: fraud-filtered aggregates for ranking and billing.

For governance:

- `security_enforcement_actions`: history of actions.
- `security_enforcement_current`: fast current-state projection for preflight.
- `security_action_audit`: immutable audit trail.

---

## What is now decisioned vs still open

### Proposed decisions captured (pending stakeholder approval)

- DR-003: canonical package identity contract.
- DR-004: field-level merge precedence matrix.
- DR-005: privacy/retention/deletion-export baseline.
- DR-006: sponsored billing/reconciliation contract.
- DR-007: ranking promotion + rollback policy.
- DR-008: single enforcement projection read model.
- DR-009: runtime trust state machine + policy precedence.
- DR-010: runtime event contract + reliability SLO baseline.
- DR-011: service boundary ownership across planes.

### Remaining blockers (not yet resolved)

- AQ-049 / MQ-034: final package table + FK contract.
- AQ-057: acceptable false-positive ceiling for automated enforcement.
- MQ-012: final numeric fraud thresholds.
- MQ-017: cross-OS VS Code user-profile config discovery/write contract.
- MQ-023: canonical Ed25519 serialization/verification contract.
- MQ-029: definition and refresh strategy for `security_reporter_metrics_30d`.

---

## Corrections applied to prior draft

1. **Removed speculative payout economics as settled fact.**
   - Bronze/Silver/Gold/Platinum payouts and quality-multiplier formula are not approved architecture for Phase 0.
   - Phase 0 creator program remains recognition-only (`Listed`, `Verified`, `Trending`, optional `Community Pick`).

2. **Corrected identity statement.**
   - Canonical identity is not simply “GitHub URL universal key.”
   - Contract is deterministic `package_id` with canonical locator and authoritative repo ID handling.

3. **Corrected local config path language.**
   - No hardcoded path assumptions are allowed.
   - Scope resolution and ownership rules are required before writing config.

4. **Corrected enforcement projection wording.**
   - `security_enforcement_current` is a maintained/upserted projection for fast reads.
   - Immutable semantics apply to audit/history tables, not to the projection row itself.

5. **Corrected rollout certainty claims.**
   - Copilot-first is the near-term adapter path.
   - Broad cross-client support remains phased and partly open.

6. **Corrected dual-action certainty claims.**
   - “View + Open in VS Code” is not fully locked as final Phase 0 UX.
   - Dual-action specifics remain an explicit application open question.

---

## Safe response snippets (reuse)

### Q: How does the install proxy ensure reliable setup?

By enforcing a deterministic startup pipeline (`policy_preflight -> trust_gate -> checks -> start/connect -> health -> supervise`), using scope-aware config ownership, and validating readiness before declaring success.

### Q: What are creator rewards in Phase 0?

Recognition-only tiers (`Listed`, `Verified`, `Trending`, optional `Community Pick`) with no payout economics until telemetry/fraud pipelines are production-ready.

### Q: How does Forge unify metadata from multiple sources?

Through canonical package identity resolution plus a field-level merge precedence matrix, with per-field lineage persisted for auditability and deterministic re-runs.

### Q: How is preflight kept fast and deterministic?

By reading only the current enforcement projection (`security_enforcement_current`) instead of joining raw report/evidence tables on the hot path.

---

## Editorial status

This file is now aligned with the current architecture docs and decision records, and avoids presenting unresolved items as finalized commitments.
 