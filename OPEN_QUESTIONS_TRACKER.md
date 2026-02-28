# Open Questions Tracker

Purpose: execution tracker for unresolved AQ/MQ items with explicit safe defaults and guardrails.

## Working Rules
1. No unresolved question is silently hardcoded.
2. Every unresolved item must map to one of: feature flag, migration guard, runtime guard, or explicit backlog deferral.
3. Resolution requires ADR or approved DR reference.

## Step 0/1/2/3 Active Queue (Implemented Guards)

| ID | Status | Safe Default | Guard/Artifact | Notes |
|---|---|---|---|---|
| AQ-007 | Open | Keep dual-action UX; do not auto-enable install-now flow | `flags.product.installNowEnabled=false` | Prevents premature UX lock-in |
| AQ-013 | Open | Curated ingestion baseline only | `flags.ingest.fullCatalogEnabled=false` | Avoids uncontrolled index quality drift |
| AQ-049 / MQ-034 | Proposed | Keep `registry_packages` compatibility path active while canonicalizing package relation | `flags.data.useRegistryPackagesTable=true` + `005_registry_packages_cutover.sql` | Canonical table + compatibility view landed; approval still required before removing bridge |
| AQ-050 / MQ-033 / MQ-035 | Proposed | Keep preflight deterministic via explicit service boundaries and replay-safe projection recompute | `packages/policy-engine/src/index.ts`, `packages/security-governance/src/index.ts`, `apps/control-plane/src/index.ts` | Runtime ingestion/projection paths are now executable with in-memory/store adapters |
| AQ-057 | Proposed | Human review required before aggressive automated enforcement | `flags.security.autoBlockAggressive=false` | Keep until DR-019 gates are approved |
| MQ-012 | Proposed | Use DR-014 RT fraud thresholds under feature-flag rollout | `flags.fraud.strictThresholdsApproved=false` | Flip only after DR-014 approval |
| MQ-017 | Proposed | Do not assume hardcoded VS Code profile path | `flags.runtime.hardcodedVsCodeProfilePath=false` | Require DR-015 adapter discovery implementation |
| MQ-019 / MQ-021 | Proposed | Enforce fixed runtime start ordering, trust transitions, and remote failure reason mapping | `apps/runtime-daemon/src/index.ts` + `apps/runtime-daemon/tests/runtime-pipeline.test.ts` | Remote hook outcomes now gate readiness deterministically |
| MQ-023 | Proposed | Reject signed requests unless canonical serialization validator passes | `flags.security.strictSignatureCanonicalization=true` + signed ingestion runtime service | Fails closed and enforces canonical hash/timestamp/nonce checks pending DR-016 approval |
| MQ-029 | Proposed | Block reporter recompute when metrics view/table is missing | `infra/postgres/migrations/002_open_question_guards.sql`, `006_security_reporter_runtime.sql` | Recompute function and service now call `assert_security_reporter_metrics_ready()` |
| AQ-054 / AQ-056 / MQ-038 | Proposed | Runtime event schema contract required for policy/start/crash/health telemetry | `packages/shared-contracts/src/event-types.ts` + `packages/shared-contracts/src/event-validation.ts` | Measurement contract implemented; SLO enforcement remains deferred |

## Proposed But Not Approved (Implemented as Reviewable Contracts)

| ID | Decision Record | Current Treatment |
|---|---|---|
| AQ-014 / MQ-001 | DR-003 | Deterministic identity generation + provisional/manual-review + promotion helpers |
| AQ-015 / MQ-003 | DR-004 | Precedence matrix + deterministic tie-break + lineage metadata |
| MQ-002 / MQ-004 | DR-013 | Identity conflict workflow SLA + lineage source-of-truth query contract |
| MQ-011..MQ-014 | DR-014 | Event/fraud contract scaffolds + deterministic outcome enums + migration baseline; strict rollout remains gated |
| MQ-017 / MQ-018 / MQ-020 / MQ-022 | DR-015 | Runtime scope discovery order and adapter lifecycle hooks implemented as typed scaffolds |
| MQ-023 / MQ-024 / MQ-025 / MQ-028 / MQ-029 | DR-016 | Signed ingestion hardening + replay limits + enum/metrics schema contract |
| MQ-005 / MQ-026 / MQ-027 / MQ-030 / MQ-031 | DR-017 | Source-kind semantics + appeals escalation + strict-mode/expiry behavior |
| MQ-015 | DR-012 | Semantic stack contract draft: model/dimension/index/fallback/versioning invariants |
| AQ-049 / MQ-034 / MQ-036 / MQ-037 | DR-018 | Canonical package relation + compatibility view cutover migration + verification script/tests |
| AQ-050 / MQ-033 / MQ-035 | DR-008 / DR-011 | Typed ingestion + projection-first preflight scaffold implemented; persistence adapters remain pluggable stubs |
| AQ-020 / AQ-021 / MQ-019 / MQ-021 | DR-009 | Runtime order and trust-state transitions implemented as deterministic pipeline contracts |
| AQ-054 / AQ-056 / MQ-038 | DR-010 | Runtime event contract implemented in shared schema v1 modules and validation helpers |
| AQ-057 / AQ-060 | DR-019 | False-positive ceiling and full-catalog enforcement promotion gates |

## Full Register Coverage (No Silent Gaps)

Canonical source registers:
1. `application_master_open_questions.md` (AQ-001..AQ-060)
2. `master_open_questions.md` (MQ-001..MQ-038)

Coverage policy by register section:

### Application AQ Coverage
- AQ-001..AQ-006: Strategy decisions. No Step 0/1 runtime/code path; tracked as product gating backlog.
- AQ-007..AQ-012: UX/workflow decisions. Guarded by conservative UX defaults and runtime-safe behavior.
- AQ-013..AQ-018: Discovery/index decisions. Step 1 contracts implemented; unresolved gates remain backlog items.
- AQ-019..AQ-024: Runtime scope/support decisions. Step 3 contract scaffolds now implemented with conservative defaults; no hardcoded profile-path assumptions.
- AQ-025..AQ-030: Trust/governance semantics. Enforced as fail-closed posture until approvals are explicit.
- AQ-031..AQ-036: Legal/privacy/compliance. Treated as mandatory before broad telemetry monetization rollout.
- AQ-037..AQ-042: Monetization/creator economics. Deferred from Step 0/1; no payout logic enabled.
- AQ-043..AQ-048: Partnerships/ecosystem. No Step 0/1 implementation dependency.
- AQ-049..AQ-054: Architecture/ops contracts. AQ-049 compatibility guard retained; AQ-050/AQ-054 scaffolds implemented with projection-first and telemetry contract boundaries.
- AQ-055..AQ-060: KPI and go/no-go thresholds. Tracked for instrumentation steps; no fabricated thresholds.

### Technical MQ Coverage
- MQ-001..MQ-004: Step 1 identity/lineage implemented; governance details now in DR-013 and pending approval.
- MQ-005: Source-class contract proposed in DR-017; keep guardrails until approved.
- MQ-006..MQ-010: Privacy/billing contractual baseline tracked; implementation deferred to telemetry/billing steps.
- MQ-011..MQ-016: Event/fraud/ranking contract scaffolds implemented; strict thresholds remain feature-flagged until approved.
- MQ-017..MQ-022: Runtime adapter/state ordering contracts implemented as typed scaffolds with remote-mode stubs.
- MQ-023..MQ-033: Security governance and preflight projection contracts scaffolded; MQ-029 SQL guard remains active.
- MQ-034..MQ-038: Integration/delivery contracts proposed (DR-018/DR-011/DR-010); compatibility and telemetry guards remain until approved.

## Closure Workflow
1. Mark question as `Proposed` only when a DR/ADR exists.
2. Mark as `Approved` only with stakeholder sign-off.
3. Replace safe default with approved behavior in the same change set that updates this file.
