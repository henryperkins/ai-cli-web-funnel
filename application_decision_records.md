# Application Decision Records

Date: February 26, 2026

Purpose: capture proposed decisions for high-priority application questions and link them back to the open-question registers.

Status legend:

- `Proposed`: ready for stakeholder approval.
- `Approved`: accepted and binding for implementation.
- `Superseded`: replaced by a later decision record.

## DR-001

- Status: `Proposed`
- Decides: `AQ-002`
- Title: Primary Launch Segment

Decision:

Forge Phase 0 and 0.5 will target AI-native individual developers and small engineering teams (`1-10`) who primarily use VS Code with Copilot and are comfortable with CLI tooling.

Why:

1. Shortest path to activation for search + install + runtime reliability.
2. Lowest procurement and policy friction versus enterprise-first motion.
3. Highest fit with initial adapter scope (`copilot-vscode` only).

Out of scope for initial GTM:

1. Enterprise-managed rollouts as primary buyer motion.
2. Non-VS Code-first ecosystems as primary segment.

Acceptance criteria:

1. Website and docs messaging explicitly state this launch segment.
2. Onboarding flow and examples prioritize VS Code + Copilot.
3. Success metrics segmented for solo/small-team cohort first.

---

## DR-002

- Status: `Proposed`
- Decides: `AQ-003`
- Title: Must-Win Job-To-Be-Done (First 90 Days)

Decision:

The must-win job is: “Help a developer reliably discover a relevant MCP tool, configure it, and have it successfully callable in Copilot within 5 minutes, with predictable restart behavior afterward.”

Why:

1. Directly aligns with core moat (`discover -> install -> runtime reliability`).
2. Clear user outcome with measurable latency and success metrics.
3. Avoids overextending into advanced profile economics too early.

Primary KPI set:

1. Time-to-first-successful-call (`TTFSC`) p90 <= 5 minutes.
2. Cold-start success rate >= 95% for onboarded packages.
3. Retryless success ratio >= 85% for first invocation.

Acceptance criteria:

1. Instrumented funnel exists from search query to first successful runtime call.
2. Dashboard reports KPI set weekly.
3. P0/P0.5 backlog explicitly prioritizes this job over adjacent features.

---

## DR-003

- Status: `Proposed`
- Decides: `AQ-014` (and `MQ-001`)
- Title: Canonical Package Identity Contract

Decision:

Adopt deterministic `package_id` generation with stable identity inputs, including monorepo support.

Contract:

1. Primary key generation:
  - `package_id = UUIDv5(FORGE_PACKAGE_NAMESPACE, canonical_locator)`
2. Canonical locator format:
  - `<github_repo_id>:<subpath_or_root>:<tool_kind>:<primary_registry_name_or_none>`
3. Rules:
  - `github_repo_id` (numeric GitHub repo ID) is authoritative when available.
  - `subpath_or_root` supports monorepo packages.
  - `tool_kind` distinguishes MCP/skill/prompt/plugin identity surfaces.
  - `primary_registry_name_or_none` prevents cross-registry spoof/alias collisions.

Fallback path (pre-resolution):

1. Use provisional identity from normalized GitHub URL + subpath + tool kind.
2. Mark as `identity_state=provisional`.
3. Promote to `identity_state=canonical` once authoritative `github_repo_id` is resolved.

Auxiliary tables required:

1. `package_aliases` (repo renames, old URLs, registry aliases).
2. `package_identity_conflicts` (manual-review queue + resolution log).

Acceptance criteria:

1. Repo rename does not change `package_id`.
2. Forks with different repo IDs get different `package_id`.
3. Two packages from same monorepo but different subpaths produce different `package_id`.
4. Identity conflict queue exists with reviewer SLA.

---

## DR-004

- Status: `Proposed`
- Decides: `AQ-015` (and `MQ-003`)
- Title: Field Precedence Matrix (Approved Order Draft)

Decision:

Use the following authoritative precedence order by field family:

1. Identity and ownership:
  - `github_repo_id` authoritative (GitHub)
  - owner identity: GitHub > verified partner claim > others
2. Display metadata:
  - name: Smithery > Glama > GitHub > mcp.so > registry
  - description: Smithery > Glama > GitHub > mcp.so > registry
3. Classification:
  - type/tool kind: Glama > Smithery > registry inference > GitHub topics
  - domain/category: Smithery > Glama > GitHub topics > mcp.so tags
4. Capabilities and permissions:
  - capabilities/IO/permissions: Glama authoritative
5. Install and config:
  - install command: Smithery > registry-derived > README parse
  - config template: Smithery authoritative
6. Runtime requirements:
  - node/python/runtime constraints: npm/PyPI > inferred docs
7. Social trust:
  - ratings/reviews: mcp.so authoritative
8. Popularity:
  - stars: GitHub authoritative
  - downloads: npm/PyPI authoritative
9. Freshness:
  - `last_updated = max(trusted_source_timestamps)`
10. Tags:
  - union across sources with dedupe + spam governance.

Tie-break and lineage rules:

1. If same precedence level conflicts, pick newest `source_updated_at`.
2. If still tied, deterministic lexical tie-break on `source_name`.
3. Persist `field_source`, `field_source_updated_at`, and `merge_run_id` for each resolved field.

Acceptance criteria:

1. Merge output includes lineage metadata per resolved field.
2. Re-running merge on unchanged inputs is idempotent.
3. Conflicting equal-precedence values resolve deterministically.

---

## DR-005

- Status: `Proposed`
- Decides: `AQ-031`, `AQ-032`, `AQ-033` (and `MQ-006`, `MQ-007`, `MQ-008`)
- Title: Privacy, Retention, and Data Subject Workflow Baseline

Decision:

Adopt a Phase 0 privacy contract that separates anonymous telemetry, account-linked governance records, and billing-grade aggregates, with explicit lawful-basis handling and retention controls.

Contract:

1. Data classes:
   - `anonymous_behavioral`: pseudonymous events for discovery/ranking/reliability.
   - `account_linked_governance`: reporter, maintainer, appeal, and enforcement records.
   - `billing_grade_metrics`: sponsor and marketplace reconciled aggregates.
2. Lawful-basis and consent behavior:
   - If consent is required by region and denied, collect only strictly necessary operational/security events.
   - If consent is granted (or region not requiring opt-in for analytics), collect full telemetry envelope.
   - Governance and abuse-prevention records are processed under security/contractual legitimate-interest basis.
3. Retention matrix (default):
   - `raw_events`: 13 months.
   - `event_flags`: 18 months.
   - `trusted_metrics`: 25 months.
   - `security_reports`, `security_evidence_*`, `security_appeals`: 24 months after closure.
   - `security_action_audit` and finalized billing artifacts: 7 years.
4. Data subject workflow:
   - Export includes all account-linked governance records and audit references.
   - Deletion request pseudonymizes personal identifiers in mutable stores within 30 days.
   - Immutable audit/legal rows are retained but de-identified and access-restricted.

Acceptance criteria:

1. Retention TTLs are encoded in scheduled jobs and documented in runbooks.
2. Deletion/export runbooks define controller/processor responsibilities and SLA timers.
3. Event ingestion enforces consent-state gates by region.

---

## DR-006

- Status: `Proposed`
- Decides: `AQ-038`, `AQ-039` (and `MQ-009`, `MQ-010`)
- Title: Sponsored Placement Billing and Reconciliation Contract

Decision:

Adopt a strict sponsored-vs-organic separation policy with billing sourced only from fraud-filtered aggregates.

Contract:

1. Ranking separation:
   - `organic_rank_score` is computed independently of paid placement logic.
   - Paid placement is applied only after organic ranking, with persisted `organic_position` and `final_position`.
2. Billing source of truth:
   - Invoices are generated from `trusted_metrics` only.
   - `raw_events` remain immutable and are never directly invoiced.
3. Reconciliation and dispute windows:
   - Monthly billing period closes at month-end UTC.
   - Billing lock date: the 3rd UTC day of following month.
   - Adjustment/dispute window: 14 calendar days from invoice issue.
   - Sponsor dispute SLA: first response `<2` business days; resolution target `<=10` business days.
4. Transparency:
   - Sponsor reports must include raw count, adjusted count, and reason-class adjustments.

Acceptance criteria:

1. Billing queries read only `trusted_metrics` and are traceable to adjustment reasons.
2. Invoice snapshots are immutable after lock date.
3. Reports show organic vs promoted position lineage for sampled placements.

---

## DR-007

- Status: `Proposed`
- Decides: `AQ-058` (and `MQ-016`)
- Title: Ranking Evaluation, Promotion, and Rollback Policy

Decision:

Adopt a versioned ranking release process with deterministic rollback gates.

Contract:

1. Versioning:
   - Persist `ranking_model_version` on every ranking run.
   - Persist `merge_run_id` and feature snapshot version used by the run.
2. Promotion gates (must all pass):
   - Offline relevance: no degradation in primary NDCG benchmark set.
   - Online quality canary: CTR/action-rate deltas not below `-5%` versus control.
   - Runtime budget: ranking API p95 latency regression not worse than `+10%`.
   - Trust posture: no material increase in fraud-flagged exposure.
3. Rollout sequence:
   - `10%` canary -> `50%` expansion -> `100%` rollout, with checkpoint review at each stage.
4. Rollback:
   - One-step rollback to prior stable `ranking_model_version` is mandatory.
   - Rollback triggers include KPI breach, incident severity, or governance override.

Acceptance criteria:

1. Model versions and benchmark deltas are queryable for each deploy.
2. Rollback can be executed without schema rollback.
3. Weekly ranking review includes explicit keep/rollback decision log.

---

## DR-008

- Status: `Proposed`
- Decides: `AQ-050` (partial) and `MQ-033`
- Title: Single Enforcement Projection Read Model for Preflight

Decision:

Use `security_enforcement_current` as the only hot-path enforcement read model for install/runtime preflight.

Contract:

1. Read-path rule:
   - Preflight must read only `security_enforcement_current` for security enforcement state.
2. State precedence for projection rebuild:
   - blocking states (`policy_blocked_perm`, `policy_blocked_temp`) override `flagged`, which overrides `reinstated`/`none`.
   - Within same precedence, newest active action wins.
3. Multi-report merge behavior:
   - Multiple reports map to one package projection row.
   - Projection updates are idempotent and append-only in action history.
4. Runtime behavior:
   - `policy_blocked_*` => return `policy_blocked` and stop before trust/start.
   - `flagged` => allow install/runtime with warning metadata.

Acceptance criteria:

1. No hot-path preflight query joins to `security_reports`.
2. Projection update functions are deterministic and replay-safe.
3. Enforcement reason codes are returned consistently in preflight responses.

---

## DR-009

- Status: `Proposed`
- Decides: `AQ-020`, `AQ-021` (and `MQ-019`, `MQ-021`, `MQ-032`)
- Title: Runtime Trust State Machine and Policy Precedence

Decision:

Lock runtime lifecycle ordering and trust-state semantics for local/remote execution modes.

Contract:

1. Start-order contract (mandatory):
   - `policy_preflight -> trust_gate -> preflight_checks -> start_or_connect -> health_validate -> supervise`.
2. Trust-state model:
   - primary states: `untrusted -> trusted -> trust_expired`.
   - terminal/override states: `denied`, `policy_blocked`.
3. Trust reset triggers:
   - major version bump,
   - author/maintainer change,
   - permission escalation,
   - explicit user revoke.
4. Policy precedence:
   - policy denial always short-circuits trust/start paths.
   - blocked reason taxonomy unifies org-policy and security-governance causes.
5. Runtime mode parity:
   - both `local` and `remote` modes must adhere to the same policy/trust ordering.

Acceptance criteria:

1. Adapter tests prove ordering invariants across supported scopes.
2. Trust-reset triggers are emitted as structured events.
3. Denial reason codes map one-to-one to user/admin-facing messages.

---

## DR-010

- Status: `Proposed`
- Decides: `AQ-054`, `AQ-056` (and `MQ-038`)
- Title: Runtime Event Contract and Reliability SLO Baseline

Decision:

Adopt a required runtime telemetry contract and measurable reliability baseline for Phase 0.5.

Contract:

1. Required runtime event set:
   - `server.start`
   - `server.crash`
   - `server.health_transition`
   - `server.policy_check`
2. Mandatory event fields:
   - `mode`, `adapter`, `scope`, `outcome`, `duration_ms`, `attempt`.
   - include `policy_block_reason` when applicable.
3. Privacy constraint:
   - no raw secrets or raw logs in telemetry; store hashes/booleans only.
4. Reliability measurement baseline (P0.5):
   - cold-start success rate `>=95%`.
   - cold-start p95 latency `<=20s` for local mode.
   - crash auto-recovery rate `>=80%` where restart policy applies.
   - health-transition false-positive rate `<2%`.
   - policy-check p95 latency `<=150ms`.

Acceptance criteria:

1. Runtime dashboards include all baseline metrics and weekly trend views.
2. Event coverage is `>=99%` for start attempts and policy checks.
3. Reliability go/no-go reviews reference these exact metrics before release expansion.

---

## DR-011

- Status: `Proposed`
- Decides: `AQ-050` (and `MQ-035`)
- Title: Service Boundary Ownership Across Control and Local Planes

Decision:

Lock service ownership boundaries so each domain has one write authority and explicit integration contracts.

Contract:

1. Registry service owns identity resolution, source merge precedence, and package metadata lineage.
2. Search service owns retrieval/ranking APIs and ranking-model deployment control.
3. Security governance service owns reporter intake, decisions, enforcement actions, and projection maintenance.
4. Policy preflight service owns deterministic allow/deny evaluation using org policy + enforcement projection.
5. Billing/analytics service owns `trusted_metrics`, adjustment pipelines, and invoice exports.
6. Local daemon owns scope writes, trust gate, lifecycle supervision, and health checks.
7. Client adapters own client-specific discovery/read/write/lifecycle hooks; they do not own policy decisions.

Acceptance criteria:

1. Each service boundary has an API contract and owning team.
2. Cross-domain writes occur only through service APIs/events, never direct table writes.
3. Preflight remains low-latency and independent from search-query execution path.

---

## DR-012

- Status: `Proposed`
- Decides: `MQ-015`
- Title: Semantic Retrieval Stack Contract (`BM25 + semantic`)

Decision:

Adopt a fixed Phase 0 semantic retrieval stack using OpenAI embeddings + Qdrant, with deterministic hybrid fusion and a mandatory BM25-only fallback path.

Contract:

1. Retrieval architecture:
   - Candidate generation remains lexical BM25.
   - Semantic retrieval executes in parallel against Qdrant chunk vectors.
   - Final relevance score uses `0.6 * bm25 + 0.4 * semantic` (per redline §7.2).
2. Embedding model baseline:
   - Provider/model: OpenAI `text-embedding-3-small`.
   - Vector dimension: `1536`.
   - Similarity metric: cosine distance.
   - Any model or dimension change requires a new `embedding_model_version` and controlled rollout.
3. Vector index baseline:
   - Engine: Qdrant.
   - Collection naming convention: `packages_semantic_v{n}` (version suffix mandatory).
   - Vector ID must be deterministic from `package_id + chunk_id + embedding_model_version`.
   - Minimum payload fields: `package_id`, `chunk_id`, `source_id`, `updated_at`, `eligibility_state`.
4. Query and filtering contract:
   - Semantic retrieval must apply the same ranking eligibility gate before returning candidates.
   - Default query fanout: BM25 `k=200`, semantic `k=100`, fused output `k=50`.
   - Hybrid fusion must be deterministic for identical inputs and index snapshot.
5. Reliability and fallback:
   - If semantic query fails/times out, serve BM25-only results and mark `semantic_fallback=true`.
   - If embedding generation fails during ingestion, retain prior vectors and enqueue retry; do not block package availability.
   - Search availability targets remain anchored to BM25 path even during semantic degradation.
6. Versioning and rollout:
   - Persist on each ranking response/run: `ranking_model_version`, `embedding_model_version`, `vector_collection_version`.
   - Rollout sequence: shadow read -> `10%` canary -> `50%` expansion -> `100%` rollout.
   - One-step rollback must exist via semantic disable flag or prior version pin.
7. Ownership boundary:
   - Search service owns semantic indexing schema, retrieval APIs, and fusion behavior.
   - Cross-domain writes to semantic index must occur only through search-owned ingestion interfaces.

Acceptance criteria:

1. Runtime config schema includes and validates: `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`.
2. Startup fails closed when configured embedding dimension mismatches Qdrant collection vector size.
3. Integration tests verify semantic ingest upsert, filtered hybrid retrieval, and forced fallback to BM25-only.
4. Ranking/audit outputs include `embedding_model_version`, `vector_collection_version`, and `semantic_fallback`.
5. Canary promotion requires:
   - search API p95 latency regression not worse than `+10%`,
   - semantic fallback rate `<1%` under normal operations,
   - no benchmark relevance regression against DR-007 guardrails.

---

## DR-013

- Status: `Proposed`
- Decides: `MQ-002`, `MQ-004`
- Title: Identity Conflict Review Workflow and Lineage Source of Truth

Decision:

Adopt `package_identity_conflicts` as the canonical manual-review queue for identity collisions and `package_field_lineage` as the canonical source-of-truth for resolved field provenance.

Contract:

1. Conflict workflow states:
   - `open -> triaged -> resolved | dismissed`.
   - state transitions are append-audited with reviewer identity and resolution note.
2. Conflict SLA:
   - `first_reviewed_at <= 8h` for high-risk collisions (ownership or package-id ambiguity).
   - `first_reviewed_at <= 24h` for standard collisions.
   - `review_due_at <= 48h` for final resolution, with escalation if breached.
3. Lineage source-of-truth:
   - `package_field_lineage` is authoritative for `field_source`, `field_source_updated_at`, and `merge_run_id`.
   - consumers must not infer lineage from denormalized package rows.
4. Query contract:
   - add a stable read path (view or API) for “current lineage per field” based on latest `resolved_at` per `(package_id, field_name)`.
   - historical audits query by `merge_run_id` snapshots.

Acceptance criteria:

1. Conflict queue dashboard reports `open/triaged/resolved/dismissed`, time-to-first-review, and SLA breaches.
2. Merge pipeline writes lineage rows for every resolved field and blocks publication if lineage write fails.
3. A deterministic query returns the same lineage result for identical `merge_run_id` snapshots.

---

## DR-014

- Status: `Proposed`
- Decides: `MQ-011`, `MQ-012`, `MQ-013`, `MQ-014`
- Title: Anonymous ID Rotation and Real-Time Fraud Threshold Baseline

Decision:

Lock Phase 0 anti-abuse posture with explicit actor/session rotation rules, deterministic RT thresholds, and a governed automation-signature source.

Contract:

1. Identity/session rotation:
   - anonymous `actor_id` rotates every `7 days` or on consent/login state change.
   - `session_id` rolls on `30 minutes` inactivity and hard-resets at `24 hours`.
2. Final RT thresholds:
   - `FRT-01`: `>120 events / 5 min / session` -> `flagged`.
   - `FRT-02`: repeated `copy_install` for same package+actor in `24h` -> keep first, flag remainder.
   - `FRT-03`: trusted headless signature + impossible cadence -> `blocked`.
   - `FRT-04`: `>5 promoted clicks / 10 min / actor+package` -> `flagged`.
   - `FRT-05`: action without impression/click context in prior `30 min` -> `flagged`.
3. Signature list governance:
   - authoritative list is versioned in repository-owned governance data.
   - Trust & Safety owns updates; emergency hotfix path allowed with post-change review.
   - daily feed sync + weekly reviewer sign-off for permanent list changes.
4. Review SLA for flagged outcomes:
   - critical: first response `<8h`.
   - non-critical: first response `<24h`.
   - unresolved flagged decisions auto-escalate at `72h`.

Acceptance criteria:

1. Fraud pipeline emits rule-versioned outcomes and threshold values in audit metadata.
2. Integration tests validate all five RT rules against deterministic fixtures.
3. SLA monitor reports flagged backlog age and escalation counts.

---

## DR-015

- Status: `Proposed`
- Decides: `MQ-017`, `MQ-018`, `MQ-020`, `MQ-022`
- Title: Runtime Scope Discovery, Ownership Sidecar, and Adapter/Auth Contract

Decision:

Standardize runtime scope discovery and adapter obligations across clients, with a constrained P1 remote-auth surface and secret-reference storage model.

Contract:

1. Scope discovery/write order:
   - approved workspace scope first, then client user-profile scope, then daemon default state.
   - no writes without explicit user/admin approval.
   - never overwrite non-daemon-owned entries without merge/prompt path.
2. Canonical sidecar metadata:
   - store daemon ownership metadata under `~/.forge/runtime/scopes/<scope_hash>.json`.
   - required fields: `managed_by`, `client`, `scope_path`, `entry_keys`, `checksum`, `last_applied_at`.
3. P1 remote auth methods in scope:
   - `api-key`, `bearer`, `oauth2_client_credentials`.
   - persisted config stores `secret_ref` only; raw secrets live in OS keychain/secret manager.
4. Adapter hook contract:
   - mandatory: discover scopes, read/write/remove entries, policy preflight hook, lifecycle hooks, health check hook.
   - optional: format-preserving rewrite helpers, local backup/restore helpers.

Acceptance criteria:

1. Adapter conformance tests validate mandatory hooks before adapter certification.
2. Runtime writes include sidecar checksum and ownership metadata for every managed scope.
3. Secret scanning confirms no raw credentials persisted in adapter config files.

---

## DR-016

- Status: `Proposed`
- Decides: `MQ-023`, `MQ-024`, `MQ-025`, `MQ-028`, `MQ-029`
- Title: Reporter Ingestion Verification, Replay Protection, and Metrics Schema Hardening

Decision:

Harden reporter intake with strict signed-request validation, bounded replay storage, explicit validation-stage ownership, enum-safe status fields, and a defined 30-day reporter metrics relation.

Contract:

1. Signature verification:
   - canonical string: `<METHOD>\\n<PATH>\\n<X-Timestamp>\\n<X-Nonce>\\n<X-Body-SHA256>`.
   - reject when timestamp skew exceeds `5 minutes`, body hash mismatches, or signature verification fails for `(reporter_id, key_id)`.
   - request bodies are UTF-8 normalized and deterministically serialized before body-hash validation.
2. Replay protection:
   - nonce uniqueness by `(reporter_id, nonce)` for `24h`.
   - hourly nonce purge for expired entries.
   - per-reporter nonce cardinality and request-rate limits to prevent replay-table abuse.
3. Validation stage ownership:
   - ingest endpoint sets `signature_valid` and `evidence_minimums_met`.
   - abuse/risk stage sets `abuse_suspected` before evaluator execution.
   - evaluator rejects if any required validity flag is false.
4. Schema hardening:
   - convert `security_appeals.status` and `security_enforcement_actions.source` to enums.
   - block deployments where enum migrations are missing.
5. `security_reporter_metrics_30d` definition:
   - relation contains the six scoring inputs used by `security_recompute_reporter_scores`.
   - implement as materialized view with hourly concurrent refresh and nightly full refresh.
   - recompute job must call `assert_security_reporter_metrics_ready()` before execution.

Acceptance criteria:

1. Security ingestion tests cover canonicalization mismatch, nonce replay, body-hash mismatch, and stale timestamp rejection.
2. Schema migration adds enums without breaking existing read paths.
3. Reporter score job succeeds only when `security_reporter_metrics_30d` is present and fresh.

---

## DR-017

- Status: `Proposed`
- Decides: `MQ-005`, `MQ-026`, `MQ-027`, `MQ-030`, `MQ-031`
- Title: Enforcement Source Classification, Appeals Escalation, and Strict-Mode Behavior

Decision:

Define enforceable source-class semantics and appeals/expiration behavior to reduce false-positive blast radius while preserving fast response for high-confidence threats.

Contract:

1. Source-kind definitions:
   - `raw`: unvetted or crawler/community-ingested package source.
   - `curated`: partner-vetted or trust-reviewed source with provenance and refresh SLA.
2. Independent trusted sources (permanent block requirement):
   - at least two distinct trusted reporter organizations, using different active key IDs, with corroborating claim/evidence.
   - plus reviewer confirmation before `policy_blocked_perm`.
3. Appeals assignment/escalation:
   - critical appeals assigned within `1h` and first human response `<8h`.
   - non-critical appeals first response `<24h`.
   - automatic escalation to backup queue/on-call before SLA breach.
4. `flagged` behavior under enterprise strict mode:
   - default: allow install/runtime with warning metadata.
   - org policy may set `block_flagged=true` to treat `flagged` as blocked.
5. Expiry/reinstatement with pending appeal:
   - when `policy_blocked_temp` expires and appeal remains open, transition to `flagged` (not `none`) until appeal resolution.

Acceptance criteria:

1. Policy tests prove default and strict-mode outcomes for `flagged` and `policy_blocked_*` states.
2. Appeals queue metrics report assignment latency, first-response SLA, and escalation counts.
3. Permanent block workflows enforce the two-source + reviewer confirmation rule.

---

## DR-018

- Status: `Proposed`
- Decides: `MQ-034`, `MQ-036`, `MQ-037`
- Title: Package FK Contract and Governance Migration/Job Release Strategy

Decision:

Adopt a canonical package relation with compatibility bridging, zero-downtime-forward migration policy, and a staged cron release gate before production write enablement.

Contract:

1. Package FK contract:
   - canonical package table is `registry.packages` (UUID PK).
   - maintain backward-compatible `public.registry_packages` view during transition.
   - all new governance FKs target canonical relation; legacy SQL may read via compatibility view.
2. Migration strategy:
   - forward-only migrations with compensating rollback migrations (no destructive down scripts in production).
   - use concurrent index creation and two-phase constraint validation for large relations.
   - every migration includes lock expectation notes and rollback playbook.
3. Cron release test plan:
   - dry-run mode (no side effects), then shadow mode (side effects to shadow tables), then production mode.
   - replay/idempotency tests for missed run, duplicate run, and partial failure recovery.
   - reconciliation checks before and after enabling each cron job class.
4. Runbook requirement:
   - publish incident procedures for cron failure triage, replay-safe reruns, and projection/data reconciliation.

Acceptance criteria:

1. Compatibility view supports legacy references while canonical FKs pass referential checks.
2. Migration PR template includes lock/risk/rollback sections and required reviewer sign-off.
3. Cron go-live checklist passes dry-run, shadow, and replay tests before production write enablement.

---

## DR-019

- Status: `Proposed`
- Decides: `AQ-057`, `AQ-060`
- Title: False-Positive Ceiling and Full-Catalog Enforcement Promotion Gate

Decision:

Set explicit trust-safety promotion gates so automated enforcement expands only after measurable stability.

Contract:

1. False-positive ceiling:
   - automated block false-positive rate must remain `<=1.0%` on rolling 30-day window.
2. Full-catalog readiness criteria:
   - appeals SLA met for two consecutive review windows.
   - false-positive ceiling met for two consecutive review windows.
   - no unresolved critical reviewer backlog above SLA threshold.
3. Rollout progression:
   - remain `raw-only` while any gate is failing.
   - Phase 6B uses `flagged-first` for partner/community sources.
   - full-catalog block enforcement only after all gates are green and approved.

Acceptance criteria:

1. Weekly trust report publishes false-positive rate, SLA attainment, and backlog-breach metrics.
2. Promotion/revert decisions are logged with explicit gate pass/fail evidence.
3. Enforcement expansion automatically freezes when any required gate regresses.
