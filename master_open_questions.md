# Master Open Questions Register

Purpose: single source of unresolved decisions across `phase0_artifacts_redline.md` and `artifact_6b_security_reporting_implementation.md`.

Status legend:

- `Open`: unresolved.
- `Proposed`: draft decision recorded; pending approval.
- `Decide This Week`: blocks active implementation sequencing.
- `Defer`: intentionally postponed to later phase.

## A) Platform Foundations

| ID | Priority | Question | Source | Owner | Needed By | Status |
|---|---|---|---|---|---|---|
| MQ-001 | High | What is the final canonical `package_id` generation algorithm (repo ID + subpath + registry mapping + collision handling)? | Redline §9 | Data Platform | P0 | Proposed (DR-003) |
| MQ-002 | High | What is the exact manual-review workflow for identity conflicts and what SLA applies? | Redline §9 | Trust & Ops | P0 | Proposed (DR-013) |
| MQ-003 | High | What is the complete field-level merge precedence matrix (all fields, not examples only)? | Redline §10 | Data Platform | P0 | Proposed (DR-004) |
| MQ-004 | High | Which source-of-truth table/service stores `field_source` lineage and how is it queried? | Redline §10 | Data Platform | P0 | Proposed (DR-013) |
| MQ-005 | Medium | What is the final definition of `raw` vs `curated` source class for enforcement logic? | Redline §15.2 / 6b schema | Trust & Safety | P0.5 | Proposed (DR-017) |

## B) Privacy, Governance, Billing

| ID | Priority | Question | Source | Owner | Needed By | Status |
|---|---|---|---|---|---|---|
| MQ-006 | High | What lawful basis/consent model applies per region for telemetry events? | Redline §11 | Privacy/Legal | P0 | Proposed (DR-005) |
| MQ-007 | High | What are exact retention TTLs for `raw_events`, `event_flags`, `trusted_metrics`, reports, and appeals? | Redline §11 + 6b | Privacy/Legal | P0 | Proposed (DR-005) |
| MQ-008 | High | What is the deletion/export workflow for account-linked governance records? | Redline §11 | Privacy/Legal | P0 | Proposed (DR-005) |
| MQ-009 | High | What is the sponsor billing adjustment window and dispute SLA (numerical targets)? | Redline §12 | Monetization Ops | P0 | Proposed (DR-006) |
| MQ-010 | Medium | Are promoted-event raw records immutable and separated from adjusted billing facts? | Redline §6.3 / §12 | Data Platform | P0 | Proposed (DR-006) |

## C) Events, Fraud, Ranking

| ID | Priority | Question | Source | Owner | Needed By | Status |
|---|---|---|---|---|---|---|
| MQ-011 | High | What exact anonymous actor/session ID rotation policy is used (TTL, regeneration triggers)? | Redline §3.1 | Platform Backend | P0 | Proposed (DR-014) |
| MQ-012 | High | What final thresholds apply for RT fraud rules (`FRT-01..05`) instead of example values? | Redline §5.2 | Trust & Safety | P0 | Proposed (DR-014) |
| MQ-013 | Medium | Which headless/automation signature list is authoritative and how often is it updated? | Redline §5.2 | Trust & Safety | P0 | Proposed (DR-014) |
| MQ-014 | High | What is the reviewer SLA for processing `flagged` events/reports before re-inclusion? | Redline §5/§15 | Trust & Ops | P0 | Proposed (DR-014) |
| MQ-015 | High | Which semantic model and index stack are used for ranking relevance (`bm25 + semantic`)? | Redline §7.2 | Search Infra | P0 | Proposed (DR-012) |
| MQ-016 | Medium | What benchmark dataset and rollback guardrails define ranking promotion/revert decisions? | Redline §7.4 | Search Infra | P0 | Proposed (DR-007) |

## D) Runtime Reliability Layer

| ID | Priority | Question | Source | Owner | Needed By | Status |
|---|---|---|---|---|---|---|
| MQ-017 | High | How is VS Code user-profile MCP config discovered/written safely across OS variants? | Redline §14.2 | Runtime Team | P0.5 | Proposed (DR-015) |
| MQ-018 | High | What daemon sidecar metadata format/path is canonical for `managed_by` ownership tracking? | Redline §14.2 | Runtime Team | P0.5 | Proposed (DR-015) |
| MQ-019 | High | What policy source precedence applies when org policy sources conflict (GitHub policy vs local MDM file)? | Redline §14.5 | Enterprise Integrations | P0.5 | Proposed (DR-009) |
| MQ-020 | Medium | Which remote auth methods are in-scope for P1 (`api-key`, `bearer`, `oauth`) and token storage rules? | Redline §14.6 | Runtime Team | P1 | Proposed (DR-015) |
| MQ-021 | Medium | What exact transition conditions define `healthy`, `degraded`, `failed` states? | Redline §14.8/14.9 | Runtime Team | P0.5 | Proposed (DR-009) |
| MQ-022 | Medium | Which adapter API hooks are mandatory vs optional for non-Copilot clients? | Redline §14.7 | Runtime Team | P1 | Proposed (DR-015) |

## E) Security Reporter Governance (Artifact 6/6b)

| ID | Priority | Question | Source | Owner | Needed By | Status |
|---|---|---|---|---|---|---|
| MQ-023 | High | How is Ed25519 signature verification implemented (canonical JSON serialization and strict parser behavior)? | 6b §1 | API Platform | P0.5 | Proposed (DR-016) |
| MQ-024 | High | What nonce cardinality limits and storage controls prevent replay-table abuse? | 6b §0/§3 | API Platform | P0.5 | Proposed (DR-016) |
| MQ-025 | High | Which endpoint/process creates `signature_valid`, `evidence_minimums_met`, and `abuse_suspected` flags and at what stage? | 6b §3/§4 | Trust & Safety | P0.5 | Proposed (DR-016) |
| MQ-026 | High | What constitutes “independent trusted sources” for permanent block confirmation? | Redline §15.3 | Trust & Safety | P0.5 | Proposed (DR-017) |
| MQ-027 | High | How are appeals assigned/escalated to guarantee `<8h` critical first response SLA? | Redline §15.3 / 6b appeals | Trust & Ops | P0.5 | Proposed (DR-017) |
| MQ-028 | Medium | Should `security_appeals.status` and `security_enforcement_actions.source` be enums instead of free text? | 6b §3 | DB Architecture | P0.5 | Proposed (DR-016) |
| MQ-029 | High | Where is `security_reporter_metrics_30d` defined and how is it refreshed? | 6b §6 | Data Platform | P0.5 | Proposed (DR-016) |
| MQ-030 | Medium | What is the exact behavior for `flagged` packages in install path under enterprise strict mode? | Redline §15.4 / 6b §7 | Enterprise Integrations | P0.5 | Proposed (DR-017) |
| MQ-031 | Medium | What is the default expiration/reinstatement behavior when `policy_blocked_temp` lapses with pending appeal? | 6b §5 | Trust & Safety | P0.5 | Proposed (DR-017) |
| MQ-032 | Medium | Which reason-code taxonomy is canonical across runtime, policy preflight, and governance actions? | Redline §14.5/§15.4 / 6b | Runtime + Trust | P0.5 | Proposed (DR-009) |
| MQ-033 | Medium | How are multiple simultaneous reports against one package merged for a single enforcement projection? | 6b §4/§5 | Data Platform | P0.5 | Proposed (DR-008) |

## F) Integration and Delivery

| ID | Priority | Question | Source | Owner | Needed By | Status |
|---|---|---|---|---|---|---|
| MQ-034 | High | What is the exact package table name and FK contract to replace placeholder `registry_packages`? | 6b §0/§3 | DB Architecture | P0.5 | Proposed (DR-018) |
| MQ-035 | High | Which services own notification integrations referenced as stubs (`queue/webhook`, ranking sync) and what interfaces are used? | 6b §5 stubs | Platform Architecture | P0.5 | Proposed (DR-011) |
| MQ-036 | Medium | What migration strategy (`up/down`, transactional boundaries, lock expectations) is required for governance DDL rollout? | 6b §3 | DB Architecture | P0.5 | Proposed (DR-018) |
| MQ-037 | Medium | What test plan is required before enabling cron jobs in production (dry-run tables, shadow mode, replay tests)? | 6b §5 | QA/Infra | P0.5 | Proposed (DR-018) |
| MQ-038 | Medium | What observability SLOs apply to governance pipelines (triage latency, expiry lag, false-positive drift)? | Redline §14.9 / §15 | SRE | P0.5 | Proposed (DR-010) |

---

## Immediate Closure Queue (Decide This Week)

1. Approve/reject all proposed decisions: `MQ-001..004` (DR-003/DR-004/DR-013), `MQ-005` (DR-017), `MQ-006..010` (DR-005/DR-006), `MQ-011..014` (DR-014), `MQ-015..016` (DR-012/DR-007), `MQ-017..022` (DR-015/DR-009), `MQ-023..033` (DR-016/DR-017/DR-008/DR-009), `MQ-034..038` (DR-018/DR-011/DR-010).
2. Sequence implementation kickoff packages: `DR-018` (schema/migrations), `DR-016` (ingestion verification), `DR-014` (fraud thresholds), `DR-015` (runtime adapter contract), `DR-017` (appeals/strict-mode).
3. Keep all unresolved items in `Proposed` state until stakeholder approval; do not remove active guardrails before approval.

Decision records:

- `/home/azureuser/ai-cli-web-funnel/application_decision_records.md`
