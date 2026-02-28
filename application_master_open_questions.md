# Application-Wide Master Open Questions Register

Purpose: top-level unresolved decision tracker for the entire Forge application.

Scope:

- Product strategy
- Marketplace supply
- Discovery/install/runtime UX
- Trust and safety
- Monetization and creator economics
- Legal/compliance
- Partnerships and GTM
- Technical architecture and delivery readiness

Status legend:

- `Open`: unresolved
- `Proposed`: draft decision recorded; pending approval
- `Approved`: accepted and implementation-binding
- `Decide This Week`: blocking near-term progress
- `Defer`: intentionally postponed

Owner legend:

- `Product`: PM/strategy
- `Eng`: engineering leadership
- `Trust`: trust and safety
- `Legal`: legal/privacy
- `GTM`: growth/partnerships
- `Ops`: operations/finance/reviewer ops

## A) Product Strategy and Positioning

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-001 | High | What is the exact one-line current-state positioning claim vs roadmap claim? | Product | Strategy Gate | Open | |
| AQ-002 | High | Which user segment is primary for launch (solo devs, power users, teams)? | Product | Strategy Gate | Proposed | DR-001 |
| AQ-003 | High | What is the must-win job-to-be-done for first 90 days? | Product | Strategy Gate | Proposed | DR-002 |
| AQ-004 | Medium | What is explicitly out of scope for first release to prevent bloat? | Product | Strategy Gate | Open | |
| AQ-005 | Medium | What are the top three differentiators to emphasize against Smithery/Glama/mcp.so? | Product | Strategy Gate | Open | |
| AQ-006 | High | What is the launch narrative for local-first reliability as core value? | Product | Strategy Gate | Open | |

## B) User Experience and Workflow

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-007 | High | What is the exact dual-action UX in Phase 0 (`View` + `Copy Install`) and when does `Install Now` replace it? | Product | P0 | Open | |
| AQ-008 | High | What are the non-negotiable UX latency targets for search/filter interactions? | Product + Eng | P0 | Open | |
| AQ-009 | Medium | What onboarding path is used when no supported client is detected? | Product | P0.5 | Open | MQ-017 |
| AQ-010 | High | What is the trust prompt copy standard and permission diff presentation pattern? | Product + Trust | P0.5 | Open | MQ-032 |
| AQ-011 | Medium | What fallback behavior should occur if runtime start fails after retry budget? | Product + Eng | P0.5 | Open | MQ-021 |
| AQ-012 | Medium | What user-visible “health” statuses are shown and where? | Product + Eng | P1 | Open | MQ-021 |

## C) Discovery and Data Index Strategy

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-013 | High | What is the exact initial ingestion scope (GitHub breadth vs curated subset)? | Product + Eng | P0 | Open | |
| AQ-014 | High | What is the canonical package identity contract across repos/registries/monorepos? | Eng | P0 | Proposed | MQ-001; DR-003 |
| AQ-015 | High | What field precedence matrix is approved across all sources? | Eng + Product | P0 | Proposed | MQ-003; DR-004 |
| AQ-016 | Medium | What quality gate determines listing eligibility for newly discovered packages? | Product + Trust | P0 | Open | |
| AQ-017 | Medium | How is stale package data detected and re-indexed safely? | Eng | P0 | Open | |
| AQ-018 | Medium | What manual curation workflow exists for misclassified/duplicate listings? | Ops | P0 | Open | MQ-002 |

## D) Install and Runtime Reliability

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-019 | High | Which client is the only guaranteed runtime target in current-state messaging? | Product | P0.5 | Open | |
| AQ-020 | High | What is the exact policy source precedence for enterprise checks? | Trust + Eng | P0.5 | Proposed | MQ-019; MQ-032; DR-009 |
| AQ-021 | High | Which runtime modes are in-scope now (`local`) vs next (`remote`)? | Product + Eng | P0.5 | Proposed | MQ-021; DR-009 |
| AQ-022 | Medium | What is the adapter certification checklist before adding a new client adapter? | Eng | P1 | Open | MQ-022 |
| AQ-023 | Medium | What is the compatibility/support matrix format published to users? | Product | P1 | Open | |
| AQ-024 | Medium | What are the restart/backoff budgets by failure class? | Eng | P0.5 | Open | MQ-021 |

## E) Trust, Security, and Governance

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-025 | High | What evidence minimums are mandatory per claim type (`malware`, `rce`, etc.)? | Trust | P0.5 | Open | MQ-025 |
| AQ-026 | High | What defines “independent trusted sources” for permanent block? | Trust | P0.5 | Open | MQ-026 |
| AQ-027 | High | What appeal escalation model guarantees SLA compliance? | Ops + Trust | P0.5 | Open | MQ-027 |
| AQ-028 | Medium | What policy exists for false reports and reporter sanctions? | Trust | P0.5 | Open | |
| AQ-029 | Medium | Which reason-code taxonomy is globally canonical? | Trust + Eng | P0.5 | Open | MQ-032 |
| AQ-030 | Medium | Under what conditions do flagged packages stay installable with warnings? | Trust + Product | P0.5 | Open | MQ-030 |

## F) Legal, Privacy, and Compliance

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-031 | High | What lawful basis governs telemetry and governance data by region? | Legal | P0 | Proposed | MQ-006; DR-005 |
| AQ-032 | High | What retention policy is approved for events, reports, enforcement, and appeals? | Legal + Trust | P0 | Proposed | MQ-007; DR-005 |
| AQ-033 | High | What user deletion/export obligations apply to governance records? | Legal | P0 | Proposed | MQ-008; DR-005 |
| AQ-034 | High | What paid-placement disclosure requirements are mandatory by jurisdiction? | Legal + Product | P0 | Open | |
| AQ-035 | Medium | What third-party content usage/licensing constraints apply to indexed metadata? | Legal | P0 | Open | |
| AQ-036 | Medium | What enterprise contractual commitments are needed for policy enforcement and auditability? | Legal + GTM | P1 | Open | |

## G) Monetization and Creator Economics

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-037 | High | Which monetization streams activate in Phase 0 and in what order? | Product + Ops | P0 | Open | |
| AQ-038 | High | What ranking separation policy is enforced between organic and sponsored? | Product + Trust | P0 | Proposed | MQ-010; DR-006 |
| AQ-039 | High | What billing dispute and adjustment window is committed to sponsors? | Ops | P0 | Proposed | MQ-009; DR-006 |
| AQ-040 | Medium | What creator tier definitions are public pre-telemetry? | Product | P0 | Open | |
| AQ-041 | Medium | When does payout logic start, and what hard data prerequisites are required? | Product + Ops | P1 | Open | |
| AQ-042 | Medium | What anti-gaming policy is published to creators and sponsors? | Trust + Product | P0 | Open | MQ-012 |

## H) Partnerships and Ecosystem

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-043 | High | Which partnership targets are priority one (Smithery, Glama, mcp.so) and by sequence? | GTM | P0 | Open | |
| AQ-044 | High | What is the standard partnership data contract (fields, refresh cadence, attribution)? | GTM + Eng | P0 | Open | |
| AQ-045 | Medium | What minimum integration criteria are required before partner data affects ranking? | Product + Trust | P1 | Open | |
| AQ-046 | Medium | What reciprocal analytics/revenue-share terms are acceptable? | GTM + Ops | P1 | Open | |
| AQ-047 | Medium | What contingency plan exists if no Tier 3 partnership lands? | Product | P0 | Open | |
| AQ-048 | Medium | What trust baseline is required before ingesting community-only sources at scale? | Trust | P1 | Open | |

## I) Engineering Architecture and Operations

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-049 | High | What is the final package table/contract replacing the placeholder `registry_packages`? | Eng | P0.5 | Proposed | MQ-034; DR-018 |
| AQ-050 | High | Which service boundaries own search, governance, runtime, and billing domains? | Eng | P0 | Proposed | MQ-033; MQ-035; DR-008; DR-011 |
| AQ-051 | High | Which queues/webhooks own notifications and ranking sync integrations? | Eng | P0.5 | Proposed | MQ-035; DR-011 |
| AQ-052 | Medium | What migration strategy is mandated for governance DDL rollout and rollback? | Eng | P0.5 | Proposed | MQ-036; DR-018 |
| AQ-053 | Medium | What production runbook exists for cron failures and replay-safe recovery? | Eng + SRE | P0.5 | Proposed | MQ-037; DR-018 |
| AQ-054 | Medium | What observability SLOs are required for governance/reliability pipelines? | SRE | P0.5 | Proposed | MQ-038; DR-010 |

## J) Metrics, Success Criteria, and Decision Gates

| ID | Priority | Question | Owner | Target Milestone | Status | Linked Tech IDs |
|---|---|---|---|---|---|---|
| AQ-055 | High | What are the launch KPIs for discovery quality (CTR, action rate, time-to-success)? | Product + Data | P0 | Open | |
| AQ-056 | High | What are the launch KPIs for runtime reliability (start success, p95 start latency)? | Eng + Product | P0.5 | Proposed | MQ-038; DR-010 |
| AQ-057 | High | What false-positive ceiling is acceptable for automated enforcement actions? | Trust | P0.5 | Proposed | DR-019 |
| AQ-058 | Medium | What thresholds trigger freeze/rollback of ranking or enforcement models? | Product + Eng | P0.5 | Proposed | MQ-016; DR-007 |
| AQ-059 | Medium | What weekly exec dashboard is required for go/no-go gates? | Ops + Product | P0 | Open | |
| AQ-060 | Medium | What criteria define readiness to move from `raw-only` enforcement to full-catalog? | Trust + Product | Phase 6B | Proposed | DR-019 |

---

## Immediate Executive Closure Queue

`Decide This Week`:

1. Approve/reject proposed decisions: AQ-002 (DR-001), AQ-003 (DR-002), AQ-014 (DR-003), AQ-015 (DR-004).
2. Approve/reject legal baseline package: AQ-031/AQ-032/AQ-033 (DR-005).
3. Approve/reject sponsored separation and sponsor dispute terms: AQ-038/AQ-039 (DR-006).
4. Approve/reject ranking promotion/rollback guardrails: AQ-058 (DR-007).
5. Approve/reject enforcement projection + service boundary decisions: AQ-050/AQ-051 (DR-008, DR-011).
6. Approve/reject runtime policy/trust and reliability package: AQ-020/AQ-021 (DR-009), AQ-054/AQ-056 (DR-010).
7. Approve/reject architecture and rollout safety blockers: AQ-049/AQ-052/AQ-053 (DR-018), AQ-057/AQ-060 (DR-019).

---

## Relationship to Technical Register

This file is the application-level register.
Technical implementation-level questions remain in:

- [master_open_questions.md](/home/azureuser/ai-cli-web-funnel/master_open_questions.md)

Decision records live in:

- [application_decision_records.md](/home/azureuser/ai-cli-web-funnel/application_decision_records.md)
