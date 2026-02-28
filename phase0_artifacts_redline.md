# Phase 0 Artifacts Redline (Implementation-Ready)

This redline converts the prior draft into a practical Phase 0 scope that can ship before install-proxy telemetry exists.

## 1) Scope Decision

### Keep in Phase 0
- Event schema for search and action telemetry.
- Real-time fraud guardrails.
- Sponsor disclosure policy.
- Search ranking model v0.

### Modify for Phase 0
- Creator rewards and tiering: visibility/badge only, no payout economics.
- Fraud engine: begin with deterministic RT + simple daily checks.
- Scoring: add sample-size guards and smoothing.

### Defer from Phase 0
- Full creator revenue-share model.
- Profile-install/fork/rating score components (unless profiles launch in P0).
- Advanced clustering/fraud graph modeling.

## 2) Missing Critical Contracts (Add Before Build)

1. Canonical package identity and dedupe spec.
2. Source normalization + merge precedence contract.
3. Privacy/data governance policy.
4. Billing/reconciliation policy for promoted listings.
5. Ranking evaluation and rollback policy.

## 3) Event Schema v1 (Revised)

## 3.1 Required envelope

```json
{
  "schema_version": "1.0.0",
  "event_id": "uuid-v4",
  "event_name": "search.query | package.impression | package.click | package.action | promoted.interaction",
  "event_occurred_at": "ISO-8601",
  "event_received_at": "ISO-8601",
  "idempotency_key": "sha256(session_id + event_name + event_occurred_at + stable_payload_fingerprint)",
  "request_id": "uuid-v4",
  "session_id": "uuid-v4",
  "actor": {
    "actor_id": "anon:<random-rotating-id> | user:<internal-id>",
    "actor_type": "anonymous | authenticated | verified_creator | sponsor"
  },
  "privacy": {
    "consent_state": "granted | denied | not_required",
    "region": "country-code-or-null"
  },
  "client": {
    "app": "web",
    "app_version": "string",
    "user_agent_family": "chromium | webkit | gecko | other",
    "device_class": "desktop | tablet | mobile",
    "referrer_domain": "string | null"
  },
  "payload": {}
}
```

## 3.2 Privacy constraints

- Do not store raw IP.
- Do not store browser fingerprint hashes.
- Do not store full user-agent; store parsed family/class only.
- Do not store raw install commands in events; store `command_template_id`.

## 3.3 Event set for P0

- `search.query`
- `package.impression`
- `package.click`
- `package.action` with `action in [view_github, copy_install, bookmark, share]`
- `promoted.interaction`

Optional events (`search.filter`, `package.detail_view`, `profile.*`) can be added post-launch.

## 4) Event Data States (Required)

Maintain three stores:

1. `raw_events` (append-only, immutable).
2. `event_flags` (fraud/rule outcomes; many-to-one from events).
3. `trusted_metrics` (aggregates used by ranking/billing).

No destructive mutation of `raw_events`.

## 5) Fraud Rules v0 (Revised)

## 5.1 Rule outcomes

- `clean`: counts everywhere.
- `flagged`: excluded from ranking until reviewed; excluded from billing by default.
- `blocked`: event rejected (obvious automation only).

Do not use partial weighting (for example 0.5x). Use explicit include/exclude.

## 5.2 Real-time rules (P0 required)

1. `FRT-01`: session event burst > threshold (for example 120 events/5 min) -> `flagged`.
2. `FRT-02`: repeated `copy_install` on same package by same actor within 24h -> keep first, flag remainder.
3. `FRT-03`: known headless/automation signatures + impossible interaction cadence -> `blocked`.
4. `FRT-04`: promoted-click burst from same actor/session -> `flagged`.
5. `FRT-05`: action without prior impression/click context -> `flagged`.

## 5.3 Daily checks (P0 minimal)

1. `FDB-01`: package spike > 3 sigma over 14-day rolling baseline -> quarantine incremental excess.
2. `FDB-02`: creator self-traffic outlier -> exclude suspected self-traffic from creator-facing metrics.

Advanced cluster/botnet detection is deferred.

## 6) Sponsor Label Policy v1 (Revised)

## 6.1 Non-negotiable disclosure

- Paid placements must show `Sponsored` or `Promoted`.
- Label must be visible at first render.
- Paid cards must be visually distinct from organic cards.
- Sponsored density cap: max 1 paid result per 5 organic results.
- `is_promoted` must be present on all impression/click/action events for paid placements.

## 6.2 Organic separation

- Compute `organic_rank_score` independently from paid boosts.
- Apply paid placement logic after organic ranking.
- Store both ranks for audit:
  - `organic_position`
  - `final_position`

## 6.3 Billing integrity

- Invoicing must use fraud-filtered `trusted_metrics`.
- Keep raw and adjusted counts in reports.
- Keep adjustment window and dispute workflow documented.

## 7) Search Ranking Spec v0 (Revised)

## 7.1 Inputs

- Query relevance (BM25 + semantic).
- Freshness.
- External popularity (GitHub stars velocity, npm/PyPI downloads).
- Smoothed CTR.
- Smoothed action rate (`copy_install/click`).

## 7.2 Formula (v0)

```python
def smoothed_rate(numerator, denominator, global_rate, alpha):
    return (numerator + alpha * global_rate) / (denominator + alpha)

def search_rank_score_v0(pkg, query, stats):
    relevance = 0.6 * bm25(pkg, query) + 0.4 * semantic(pkg, query)
    freshness = max(0.0, 1 - days_since(pkg.last_updated) / 365)
    popularity = 0.6 * norm(pkg.github_star_velocity_30d) + 0.4 * norm(pkg.downloads_weekly)

    ctr = smoothed_rate(pkg.clicks_7d, pkg.impressions_7d, stats.global_ctr_7d, alpha=50)
    action = smoothed_rate(pkg.copy_actions_7d, pkg.clicks_7d, stats.global_action_rate_7d, alpha=25)

    base = (
        0.55 * norm(relevance) +
        0.15 * freshness +
        0.15 * norm(popularity) +
        0.10 * norm(ctr) +
        0.05 * norm(action)
    )

    if pkg.impressions_7d < 100:
        prior = 0.5 * norm(pkg.github_stars) + 0.3 * norm(pkg.downloads_weekly) + 0.2 * pkg.schema_completeness
        blend = min(1.0, pkg.impressions_7d / 100.0)
        return blend * base + (1 - blend) * prior

    return base
```

## 7.3 Minimum eligibility gate

Package must satisfy all:

- canonical identity resolved.
- description length >= 20.
- README available and parseable.
- updated within last 365 days.
- not fraud-blocked.

Sponsored listings must pass the same gate.

## 7.4 Versioning and rollback

- Persist `ranking_model_version` on each ranking run.
- Keep offline benchmark set and weekly NDCG/CTR deltas.
- One-click rollback to prior model version required.

## 8) Creator Score/Tiers v0 (Pre-telemetry)

Phase 0 creator program is recognition-only:

- `Listed`: indexed.
- `Verified`: ownership verified.
- `Trending`: score percentile threshold over 14-day window.
- `Community Pick`: curated/profile inclusion threshold (only if profiles enabled).

No revenue-share payouts in Phase 0.

## 9) Canonical Package Identity Spec (Required)

Generate stable `package_id` from canonical repo identity:

- Canonical key candidate order:
  1. normalized GitHub repo URL (`github.com/org/repo`)
  2. fallback registry URL to GitHub mapping
  3. manual review queue
- Track rename/fork lineage with aliases:
  - `canonical_repo`
  - `repo_aliases[]`
  - `is_fork`
  - `fork_parent`
- Monorepo handling:
  - package-level `subpath` support (`repo + subpath`).

## 10) Merge Precedence Contract (Required)

Define field ownership explicitly. Example:

- `name`: Smithery > Glama > GitHub.
- `capabilities`: Glama authoritative.
- `config_template`: Smithery authoritative.
- `ratings`: mcp.so authoritative.
- `downloads`: npm/PyPI authoritative.
- `last_updated`: max timestamp across trusted sources.

All overrides must record `field_source`.

## 11) Privacy and Governance Policy (Required)

- Data classification matrix (anonymous behavioral vs account-linked).
- Retention matrix by event type and store (`raw_events`, `event_flags`, `trusted_metrics`).
- Consent handling by region and lawful basis.
- User deletion/export workflow for account-linked records.

## 12) Billing and Reconciliation Policy (Required if Sponsored Launches)

- Billing source: `trusted_metrics` only.
- Monthly lock date and adjustment window.
- Fraud adjustment transparency in sponsor reports.
- Dispute SLA and recalculation procedure.

## 13) Build Sequence (Updated)

1. Canonical identity + merge precedence contracts.
2. Event schema v1 + raw ingestion path.
3. RT fraud flags (minimal blocking).
4. Ranking model v0 (with smoothing and cold-start prior).
5. Sponsor policy + organic/paid rank separation.
6. Daily anomaly checks + sponsor reconciliation.

---

This is the Phase 0 cut that can ship quickly while preserving data integrity, compliance posture, and future upgrade paths.

## 14) Artifact 5: Runtime Reliability Layer v1 (Addendum)

This section extends the platform from discovery/install into runtime reliability for MCP invocation.

## 14.1 Scope and corrections adopted

- No hardcoded config path assumptions.
- Explicit first-run trust gate for local execution.
- Enterprise policy preflight with distinct `policy_blocked` outcome.
- Support both local process and remote endpoint modes.
- Phase 0.5 ships one adapter (`copilot-vscode`); cross-client support remains roadmap.

## 14.2 Config scope model

Scope resolution order:

1. workspace scope (`<workspace>/.vscode/mcp.json`) when user selected and writable.
2. user-profile scope (client-managed user config location).
3. daemon default state (`~/.your-app/*`) as source of truth for generated entries.

Rules:

- Never write to any scope without explicit user/admin approval.
- If existing workspace config is not daemon-owned, merge or prompt; do not overwrite.
- Track ownership via daemon sidecar metadata (preferred) or client-safe metadata fields.

## 14.3 Runtime start pipeline

Every start request follows:

1. `policy_preflight` (org policy, allowlist/caps).
2. `trust_gate` (first run, permission escalation, major changes).
3. `preflight_checks` (config, deps, env presence, port/runtime).
4. `start_or_connect` (local spawn or remote connect).
5. `health_validate` (must pass before "ready").
6. `supervise` (restart/reconnect/backoff and state transitions).

## 14.4 Trust state machine

`untrusted -> trusted -> trust_expired`

Alternative terminal states:

- `denied`
- `policy_blocked`

Trust reset triggers:

- major version bump
- author/maintainer change
- permission escalation
- explicit user revoke

## 14.5 Enterprise policy contract

Policy evaluation precedes trust/start.

Required blocked reasons:

- `mcp_disabled_for_org`
- `server_not_in_allowlist`
- `permissions_exceed_cap`

When blocked:

- stop execution immediately
- emit policy event
- return user-visible admin escalation message

## 14.6 Local and remote runtime modes

Supported modes:

- `local` (stdio process supervision)
- `remote` (SSE or streamable HTTP lifecycle)

Common server entry model:

```json
{
  "package_id": "uuid",
  "package_slug": "string",
  "mode": "local | remote",
  "transport": "stdio | sse | streamable-http",
  "trust_state": "untrusted | trusted | denied | trust_expired | policy_blocked",
  "health": {
    "interval_seconds": 30,
    "timeout_ms": 5000,
    "max_consecutive_failures": 3
  }
}
```

Remote-specific outcomes:

- `remote_unreachable`
- `remote_auth_failed`
- `remote_unhealthy`
- `remote_timeout`
- `remote_cert_invalid`

## 14.7 Client adapter interface and roadmap

Adapter interface responsibilities:

- discover scopes
- read/write/remove server entries
- policy check
- lifecycle hooks

Roadmap:

1. P0.5: `copilot-vscode`
2. P1: `cursor`
3. P2: `claude-code`
4. P3: `codex`

## 14.8 Runtime events (schema additions)

Add event types (same envelope as Section 3):

- `server.start`
- `server.crash` (local mode)
- `server.health_transition`
- `server.policy_check`

Event requirements:

- include `mode`, `adapter`, `scope`, `outcome`.
- include `policy_block_reason` when applicable.
- store no raw secrets/logs (hashes and booleans only).

## 14.9 Reliability SLO instrumentation

Track (measure first, enforce later):

- cold start success rate
- cold start p95 latency
- crash auto-recovery rate
- health-transition false-positive rate
- policy check latency

Phase 0.5 goal is measurement + dashboards, not hard enforcement.

## 14.10 Build sequence extension

Extend Section 13:

7. `copilot-vscode` adapter.
8. trust gate + policy preflight.
9. local process supervisor (`stdio`).
10. runtime events and reliability dashboard.
11. remote mode (SSE/streamable HTTP) in P1.
12. additional adapters in roadmap order.

## 15) Artifact 6: Security Reporter Governance v1

This section defines how trusted external security reports flow into `flagged` and `policy_blocked` enforcement without allowing abusive or low-confidence takedowns.

## 15.1 Canonical objects

```json
{
  "reporter_profile": {
    "reporter_id": "uuid",
    "tier": "A | B | C",
    "status": "active | probation | suspended | removed",
    "identity_verified": true,
    "api_key_id": "string",
    "signing_public_key": "string",
    "trust_score": 0.0
  },
  "security_report": {
    "report_id": "uuid",
    "reporter_id": "uuid",
    "package_id": "uuid",
    "severity": "low | medium | high | critical",
    "claim_type": "malware | rce | credential_theft | supply_chain | policy_violation",
    "affected_versions": ["string"],
    "evidence_bundle_id": "uuid",
    "signature": "base64"
  },
  "evidence_bundle": {
    "evidence_bundle_id": "uuid",
    "min_required_fields_present": true,
    "ioc_hashes": ["sha256"],
    "logs_hashes": ["sha256"],
    "poc_refs": ["uri"]
  },
  "enforcement_action": {
    "action_id": "uuid",
    "package_id": "uuid",
    "state": "none | flagged | policy_blocked_temp | policy_blocked_perm | reinstated",
    "reason_code": "string",
    "expires_at": "iso8601 | null",
    "created_by": "auto | human_reviewer"
  }
}
```

## 15.2 Deterministic decision engine

Reject report if any is true:

- signature invalid.
- reporter not active.
- evidence minimums missing.

Action rules:

1. Tier A + critical + valid evidence + package source `raw` -> `policy_blocked_temp` (72h) and immediate review.
2. Tier A + critical + curated source -> `flagged` and emergency review.
3. Tier B + high/critical + valid evidence -> `flagged` and fast review queue.
4. Tier C -> advisory only (risk/scoring signal only; no direct block).
5. abuse signal or low-confidence evidence -> `no_action`.

## 15.3 Governance constraints

- Auto-blocks expire at 72h unless human-confirmed.
- Permanent block requires either:
  - two independent trusted sources (Tier A/B), or
  - emergency zero-day evidence plus reviewer confirmation.
- Immutable audit log for every enforcement transition.
- Maintainer appeal SLA:
  - critical: first response < 8h.
  - non-critical: first response < 24h.

## 15.4 Integration points

Enterprise policy preflight and runtime layers consume `enforcement_action.state`:

- `policy_blocked_temp | policy_blocked_perm` -> return `policy_blocked` before trust/start/install.
- runtime failure reason codes:
  - `policy_blocked_malware`
  - `policy_blocked_supply_chain`
  - `policy_blocked_org_policy`

Search/ranking behavior:

- `flagged` -> visibility penalty, not automatic delist.
- `policy_blocked_*` -> remove install pathways immediately.

## 15.5 Reporter trust scoring (weekly)

```text
reporter_trust_score =
  0.35 * precision_confirmed_reports +
  0.20 * evidence_completeness +
  0.15 * reviewer_agreement_rate +
  0.10 * sla_compliance +
  0.10 * conflict_disclosure_compliance +
  0.10 * false_positive_inverse
```

Tier thresholds:

- Tier A: score >= 0.85
- Tier B: 0.65 to 0.84
- Tier C: score < 0.65

Allow automatic demotion on sustained false positives or abuse patterns.

## 15.6 Rollout plan

1. Phase 6A: enforce on `raw` GitHub-ingested packages only.
2. Phase 6B: include partner-ingested packages in `flagged` mode first.
3. Phase 6C: full-catalog enforcement after false-positive rate and appeals SLA are stable.

## 15.7 API, schema, and jobs follow-up

Implementation artifact `6b` is captured in:

- `/home/azureuser/ai-cli-web-funnel/artifact_6b_security_reporting_implementation.md`

It includes:

- API endpoints for report submission, evidence upload, reviewer actions, and appeals.
- SQL schema for `reporter_profile`, `security_report`, `evidence_bundle`, and `enforcement_action`.
- Scheduled jobs:
  - weekly reporter trust recalculation,
  - block expiration and reinstatement,
  - enforcement state reconciliation into `trusted_metrics`.

## 16) Open Questions Register

Application-wide canonical tracker:

- `/home/azureuser/ai-cli-web-funnel/application_master_open_questions.md`

Technical implementation tracker:

- `/home/azureuser/ai-cli-web-funnel/master_open_questions.md`

Decision records:

- `/home/azureuser/ai-cli-web-funnel/application_decision_records.md`
