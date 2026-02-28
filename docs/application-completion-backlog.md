# Forge Application Completion Backlog

Date: 2026-02-28
Scope: Complete Forge as a production-ready install broker for CLI addons (MCP servers, skills, plugins).

## Success Criteria (Definition of Done)

1. Users can reliably run `discover -> plan -> install -> verify -> update -> remove` for supported addon types.
2. Top target clients/runtimes have production adapters with rollback-safe behavior.
3. Catalog metadata freshness, trust policy checks, and install verification are observable and alertable.
4. CI/release gates enforce quality, migration integrity, and governance drift controls.
5. Beta pilot targets are met and GA release criteria are signed off.

## Priority Legend

1. `P0`: Required for GA.
2. `P1`: Required for stable scale after GA.
3. `P2`: Optimization/expansion.

## Execution Order (Step-by-Step)

1. Execute all `P0` stories in Epics E1-E6 and E9.
2. Run end-to-end beta pilot under E10 with explicit go/no-go metrics.
3. Promote approved `P1` stories (E7-E8) in parallel with pilot hardening.
4. Freeze contracts, cut release tag, and publish GA runbook/report.

## Epic Backlog

## E1. Product Contract and Scope Freeze

Outcome: Lock exactly what Forge v1 supports to prevent moving-target implementation.
Owner: Product + Platform Foundations
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E1-S1 | Freeze v1 addon metadata contract for MCP/skills/plugins | Product + Shared Contracts | P0 | none |
| E1-S2 | Freeze lifecycle API contract for discover/plan/install/verify/update/remove | Control Plane | P0 | E1-S1 |
| E1-S3 | Publish compatibility matrix (clients, OS, adapter support level) | Product + Runtime | P0 | E1-S2 |

### Acceptance Criteria

1. Contract schemas are versioned and documented with migration guidance.
2. Breaking changes require explicit decision-log entry and version bump.
3. Compatibility matrix is published in docs and referenced from root README.

## E2. Catalog Connectors and Ingestion at Scale

Outcome: Reliable, refreshable catalog pipeline beyond scaffold/fixture operation.
Owner: Catalog + Data Platform
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E2-S1 | Implement GitHub source connector with deterministic normalization | Catalog | P0 | E1-S1 |
| E2-S2 | Implement docs/web source connector with schema-safe extraction | Catalog | P0 | E2-S1 |
| E2-S3 | Add scheduled ingestion/reconciliation with freshness SLA tracking | Data Platform | P0 | E2-S1, E2-S2 |
| E2-S4 | Add conflict review workflow for identity/lineage anomalies | Catalog + Governance | P1 | E2-S3 |

### Acceptance Criteria

1. Ingestion pipeline supports repeatable runs with idempotent results.
2. Freshness status is queryable per package and visible via API/ops reporting.
3. Identity conflict handling is deterministic and audit logged.

## E3. Plan Engine and Dependency Resolution Completion

Outcome: Deterministic install plans with explainability and conflict resolution.
Owner: Control Plane + Policy Engine
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E3-S1 | Implement dependency graph expansion and transitive resolution | Control Plane | P0 | E1-S2, E2-S1 |
| E3-S2 | Add conflict detection (version, capability, runtime compatibility) | Policy Engine | P0 | E3-S1 |
| E3-S3 | Add plan explanation payload (`why`, `risk`, `required actions`) | Control Plane | P0 | E3-S2 |
| E3-S4 | Add plan simulation mode for safe preflight previews | Control Plane | P1 | E3-S3 |

### Acceptance Criteria

1. Same input produces same plan output and action order.
2. Plan responses include machine-readable conflict and remediation fields.
3. Plan-only mode is fully test-covered and non-mutating.

## E4. Adapter Expansion and Runtime Verification

Outcome: Install/apply/verify works across target clients with deterministic failure handling.
Owner: Runtime + Adapter Team
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E4-S1 | Implement adapters for top target clients (by product priority list) | Runtime | P0 | E1-S3 |
| E4-S2 | Standardize adapter contract (`install`, `update`, `remove`, `verify`) | Runtime + Shared Contracts | P0 | E4-S1 |
| E4-S3 | Add adapter health checks and startup diagnostics | Runtime | P0 | E4-S2 |
| E4-S4 | Add rollback-safe partial-failure handling for multi-action installs | Runtime | P0 | E4-S2 |

### Acceptance Criteria

1. Every GA adapter passes a shared adapter contract test suite.
2. Verify responses include deterministic status codes and failure taxonomy.
3. Partial failures preserve auditability and safe rollback guidance.

## E5. Lifecycle Completion: Update, Remove, and Rollback

Outcome: Full lifecycle coverage beyond install-only workflows.
Owner: Control Plane + Runtime
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E5-S1 | Implement `POST /v1/install/plans/:id/update` workflow | Control Plane | P0 | E3-S3, E4-S2 |
| E5-S2 | Implement remove/uninstall workflow with dependency safety checks | Control Plane | P0 | E5-S1 |
| E5-S3 | Implement rollback endpoint/path for failed apply/update/remove attempts | Control Plane + Runtime | P0 | E5-S2 |
| E5-S4 | Add lifecycle runbook sections for update/remove/rollback operations | Docs + Runtime | P1 | E5-S3 |

### Acceptance Criteria

1. Update/remove/rollback are idempotent and replay-safe.
2. Lifecycle audit tables capture attempts and outcomes consistently.
3. Runbooks provide exact commands and troubleshooting for each path.

## E6. Security, Trust, and Governance Enforcement

Outcome: Trust posture is enforced for catalog and runtime behavior.
Owner: Security Governance + Platform
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E6-S1 | Enforce package trust policy gates before apply | Security Governance | P0 | E3-S2, E4-S2 |
| E6-S2 | Finalize reporter ingestion + enforcement recompute operations | Security Governance | P0 | existing Wave 7/9 baseline |
| E6-S3 | Add policy decision explainability in API responses | Security Governance + Control Plane | P0 | E6-S1 |
| E6-S4 | Close outstanding AQ/MQ approvals required for GA posture | Product + Governance Council | P0 | E6-S1, E6-S2 |

### Acceptance Criteria

1. Blocked installs return deterministic, explainable policy reasons.
2. Governance drift checker is part of merge gating and remains green.
3. Required governance decisions are explicitly approved before GA.

## E7. Profiles, Bundles, and Team Workflows

Outcome: Team-level reuse and controlled rollout of addon sets.
Owner: Control Plane + Product
Priority: `P1`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E7-S1 | Add profile overlays (env-specific package variants) | Control Plane | P1 | existing profile baseline |
| E7-S2 | Add profile sharing/ownership model for team usage | Product + Control Plane | P1 | E7-S1 |
| E7-S3 | Add profile policy gates (allow/deny package families) | Security Governance | P1 | E6-S1, E7-S1 |

### Acceptance Criteria

1. Profile install behavior is deterministic across environments.
2. Profile ownership and access behavior is test-covered.
3. Profile actions are audit logged with actor and correlation IDs.

## E8. Observability and SLO Operations

Outcome: Reliable operational telemetry with actionable alerting.
Owner: Security Governance + SRE
Priority: `P1`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E8-S1 | Extend SLO rollup metrics to include update/remove/rollback outcomes | Security Governance | P1 | E5-S3 |
| E8-S2 | Add dashboards and alerts for install failure and dead-letter thresholds | SRE | P1 | E8-S1 |
| E8-S3 | Add alert-driven triage playbooks linked from runbooks | SRE + Docs | P1 | E8-S2 |

### Acceptance Criteria

1. SLO dashboards are available for on-call with alert thresholds documented.
2. Alert to runbook path is explicit and tested during game-day drill.
3. Rollup jobs provide deterministic outputs and rerun safety.

## E9. CI, Release Gates, and Distribution

Outcome: Shipping confidence via enforced quality gates and repeatable releases.
Owner: Platform + CI Maintainers
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E9-S1 | Add profile-specific e2e path to CI | Platform | P0 | E7 baseline |
| E9-S2 | Add ops smoke workflow (retrieval/outbox/dead-letter/SLO dry-runs) | Platform | P0 | E8 baseline |
| E9-S3 | Define release checklist with required gate outputs and artifact signatures | Platform + Product | P0 | E9-S1, E9-S2 |
| E9-S4 | Publish package/CLI distribution channels and upgrade policy | Platform | P1 | E9-S3 |

### Acceptance Criteria

1. CI gates fail fast on regressions and include governance checks.
2. Release checklist is executable and attached to each release candidate.
3. Ops smoke workflow results are retained and reviewable.

## E10. Beta Pilot and GA Launch

Outcome: Real-user validation and controlled GA rollout.
Owner: Product + Engineering Leads
Priority: `P0`

### Stories

| ID | Story | Owner | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| E10-S1 | Run closed beta with explicit user cohorts and success metrics | Product | P0 | E1-E6, E9 |
| E10-S2 | Triage top beta failure classes and close high-severity issues | Engineering Leads | P0 | E10-S1 |
| E10-S3 | Execute GA readiness review and launch decision | Product + Platform + Security | P0 | E10-S2 |

### Acceptance Criteria

1. Beta metrics meet target thresholds for install success and verification reliability.
2. High-severity blockers are closed or explicitly deferred with sign-off.
3. GA launch report is published with known limitations and next-wave commitments.

## Post-Phase-2 Status Snapshot (2026-02-28)

| Story | Status | Evidence |
| --- | --- | --- |
| E9-S1 | Done | `.github/workflows/forge-ci.yml`, `tests/e2e/profile-lifecycle-local.e2e.test.ts` |
| E9-S2 | Done | `.github/workflows/forge-ops-smoke.yml` |
| E9-S3 | Done | `docs/release-checklist.md`, `.github/workflows/forge-release.yml` |
| E9-S4 | In Progress | `docs/immediate-execution-plans/phase-3/e9-s4-distribution-upgrade-policy-plan.md` |
| E10-S1 | In Progress | `docs/immediate-execution-plans/phase-3/e10-s1-beta-pilot-execution-plan.md` |
| E10-S2 | In Progress | `docs/immediate-execution-plans/phase-3/e10-s2-s3-triage-and-ga-decision-gate-plan.md` |
| E10-S3 | In Progress | `docs/immediate-execution-plans/phase-3/e10-s2-s3-triage-and-ga-decision-gate-plan.md` |

## Immediate Next Sprint (Recommended)

1. Close `E9-S4` with channel policy, release guardrails, and signed distribution manifest outputs.
2. Execute `E10-S1` beta pilot onboarding and baseline KPI snapshot reporting.
3. Operationalize trust-gate scripts/runbooks and add trust-gate dry-runs to ops smoke.
4. Complete `E10-S2/S3` triage and GA decision artifact templates with owner/date accountability.
5. Start selected `P1` follow-ons (`E2-S4` identity conflict review workflow, `E7-S1` profile overlays, `E8-S1` SLO extensions).

Immediate execution plan docs:
1. `docs/immediate-execution-plans/README.md`
2. `docs/immediate-execution-plans/phase-2/README.md`
3. `docs/immediate-execution-plans/phase-3/README.md`

## Suggested Tracking Fields

1. `Status`: Not Started, In Progress, Blocked, Done.
2. `Target Milestone`: M1, M2, M3.
3. `Risk`: Low, Medium, High.
4. `Decision Dependency`: AQ/MQ/DR IDs if governance-bound.
5. `Evidence Link`: test run, build report, or dashboard URL.
