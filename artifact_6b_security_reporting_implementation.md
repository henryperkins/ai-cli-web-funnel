# Artifact 6b: API Endpoints + SQL Schema + Cron Jobs

Implementation-ready companion for Artifact 6 in [phase0_artifacts_redline.md](/home/azureuser/ai-cli-web-funnel/phase0_artifacts_redline.md).

## 0) Implementation assumptions

- DB: PostgreSQL 15+
- Scheduler: `pg_cron`
- API auth for reporters: Ed25519 request signing + reporter key ID
- Idempotency: required for all mutating endpoints
- Package FK target: `registry_packages(id uuid)` (swap if needed)

Hardening defaults:

- Signature timestamp skew: reject requests older/newer than `5 minutes` from server time.
- Nonce replay protection window: `24 hours`.
- Audit tables are immutable after insert.
- All cron target functions must exist and be idempotent.

---

## 1) API endpoints (v1)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/v1/security/reports` | POST | Reporter signed request | Submit security report + evidence metadata |
| `/v1/security/reports/{report_id}` | GET | Reporter/Admin/Reviewer | Fetch report status and decision trail |
| `/v1/security/reports/{report_id}/review` | POST | Reviewer/Admin | Add reviewer finding, set decision |
| `/v1/security/reports/{report_id}/attachments` | POST | Reporter signed request | Attach additional evidence hashes/refs |
| `/v1/security/packages/{package_id}/enforcement` | GET | Internal service key | Preflight read for install/runtime policy gate |
| `/v1/security/appeals` | POST | Maintainer auth | Create appeal against action |
| `/v1/security/appeals/{appeal_id}/resolve` | POST | Reviewer/Admin | Resolve appeal + reinstate/confirm |
| `/v1/security/reporters` | POST | Admin | Create/vet reporter profile |
| `/v1/security/reporters/{reporter_id}/score/recompute` | POST | Admin | On-demand score recompute |
| `/v1/security/reporters/{reporter_id}` | GET | Admin/Reporter self | Reporter profile + current tier/score |

### Required signed headers (reporter endpoints)

- `X-Reporter-Id`
- `X-Key-Id`
- `X-Timestamp` (ISO8601 UTC)
- `X-Nonce` (uuid)
- `X-Body-SHA256`
- `X-Signature-Ed25519`
- `Idempotency-Key`

### Canonical string for signature

```text
<METHOD>\n<PATH>\n<X-Timestamp>\n<X-Nonce>\n<X-Body-SHA256>
```

### Request validation rules (required)

1. Reject if `abs(now_utc - X-Timestamp) > 5 minutes`.
2. Reject if nonce already seen for `(reporter_id, nonce)`.
3. Reject if body hash mismatch.
4. Reject if signature invalid for `(reporter_id, key_id)`.
5. Enforce idempotency key for all mutating endpoints.

---

## 2) Core endpoint contracts

### POST `/v1/security/reports`

```json
{
  "external_report_id": "partner-2026-000123",
  "severity": "critical",
  "claim_type": "malware",
  "summary": "Package contains malicious postinstall script",
  "affected_packages": [
    {
      "package_id": "5f3b5a66-4d58-4f27-8b8f-6a18965e0f1c",
      "affected_versions": [">=2.1.0 <2.1.4"],
      "source_kind": "raw"
    }
  ],
  "evidence": {
    "repro_steps": "1) Install v2.1.3 ... 2) Observe outbound callback ...",
    "ioc_hashes": ["5f70bf18a08660b1..."],
    "poc_refs": ["https://example.org/poc/123"],
    "logs_hashes": ["0a1b2c..."]
  }
}
```

`202 Accepted`

```json
{
  "report_id": "e2f3c8aa-1a93-4cbb-a502-8820ca7f5f8d",
  "status": "submitted",
  "decision": "pending_validation"
}
```

### POST `/v1/security/reports/{report_id}/review`

```json
{
  "decision": "confirm_temp_block",
  "reason_code": "validated_malware_ioc_match",
  "notes": "Reproduced in sandbox",
  "requires_second_source": true
}
```

### GET `/v1/security/packages/{package_id}/enforcement?version=2.1.3&org_id=acme`

`200 OK`

```json
{
  "package_id": "5f3b5a66-4d58-4f27-8b8f-6a18965e0f1c",
  "state": "policy_blocked_temp",
  "install_allowed": false,
  "runtime_allowed": false,
  "reason_code": "malware_critical_tier_a",
  "expires_at": "2026-02-29T03:10:00Z",
  "policy_blocked": true
}
```

### POST `/v1/security/appeals`

```json
{
  "package_id": "5f3b5a66-4d58-4f27-8b8f-6a18965e0f1c",
  "action_id": "91f5...",
  "maintainer_statement": "Hash corresponds to test fixture; fixed in 2.1.4",
  "evidence_refs": ["https://github.com/org/repo/commit/abc123"]
}
```

---

## 3) SQL schema (copy-ready migration)

```sql
-- 001_security_governance.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enums
CREATE TYPE security_reporter_tier AS ENUM ('A','B','C');
CREATE TYPE security_reporter_status AS ENUM ('active','probation','suspended','removed');
CREATE TYPE security_severity AS ENUM ('low','medium','high','critical');
CREATE TYPE security_claim_type AS ENUM ('malware','rce','credential_theft','supply_chain','policy_violation');
CREATE TYPE security_report_status AS ENUM ('submitted','rejected','validated','queued_review','decision_made','closed');
CREATE TYPE security_action_state AS ENUM ('none','flagged','policy_blocked_temp','policy_blocked_perm','reinstated');
CREATE TYPE security_source_kind AS ENUM ('raw','curated');
CREATE TYPE security_decision AS ENUM ('no_action','flag_only','temp_block','perm_block','reinstate');

-- Reporter profiles
CREATE TABLE security_reporters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_entity_name TEXT,
  tier security_reporter_tier NOT NULL DEFAULT 'C',
  status security_reporter_status NOT NULL DEFAULT 'probation',
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  coi_disclosures JSONB NOT NULL DEFAULT '[]'::jsonb,
  sla_hours INTEGER NOT NULL DEFAULT 24 CHECK (sla_hours > 0),
  trust_score NUMERIC(5,4) NOT NULL DEFAULT 0.0000 CHECK (trust_score >= 0 AND trust_score <= 1),
  false_positive_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0000 CHECK (false_positive_rate >= 0 AND false_positive_rate <= 1),
  onboarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reporter signing keys
CREATE TABLE security_reporter_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES security_reporters(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  public_key_ed25519 TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(reporter_id, key_id)
);

-- Nonce replay protection (short retention)
CREATE TABLE security_request_nonces (
  reporter_id UUID NOT NULL REFERENCES security_reporters(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_id, nonce)
);

-- Idempotency
CREATE TABLE security_idempotency_keys (
  scope TEXT NOT NULL,                -- e.g., 'POST:/v1/security/reports'
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(scope, idempotency_key)
);

-- Reports
CREATE TABLE security_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES security_reporters(id),
  external_report_id TEXT,
  severity security_severity NOT NULL,
  claim_type security_claim_type NOT NULL,
  summary TEXT NOT NULL,
  status security_report_status NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_minimums_met BOOLEAN NOT NULL DEFAULT FALSE,
  abuse_suspected BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (external_report_id IS NULL OR length(trim(external_report_id)) > 0)
);

-- Null-safe uniqueness for partner IDs (allows many NULLs, disallows duplicate non-NULL)
CREATE UNIQUE INDEX uq_security_reports_external_report_id
ON security_reports(reporter_id, external_report_id)
WHERE external_report_id IS NOT NULL;

CREATE INDEX idx_security_reports_status_submitted ON security_reports(status, submitted_at);
CREATE INDEX idx_security_reports_reporter ON security_reports(reporter_id, submitted_at DESC);

-- A report can affect many packages
CREATE TABLE security_report_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES security_reports(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES registry_packages(id),
  affected_versions TEXT[] NOT NULL,
  source_kind security_source_kind NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_packages_package ON security_report_packages(package_id);

-- Evidence
CREATE TABLE security_evidence_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL UNIQUE REFERENCES security_reports(id) ON DELETE CASCADE,
  repro_steps TEXT NOT NULL,
  ioc_hashes TEXT[] NOT NULL DEFAULT '{}',
  poc_refs TEXT[] NOT NULL DEFAULT '{}',
  logs_hashes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional expanded artifact table
CREATE TABLE security_evidence_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES security_reports(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,              -- ioc_hash|log_hash|poc_ref
  artifact_value TEXT NOT NULL,
  normalized_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_artifacts_norm ON security_evidence_artifacts(normalized_value);

-- Review + decisions
CREATE TABLE security_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES security_reports(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL,                -- internal user id
  decision security_decision NOT NULL,
  reason_code TEXT NOT NULL,
  notes TEXT,
  requires_second_source BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_report ON security_reviews(report_id, created_at DESC);

-- Enforcement actions (history)
CREATE TABLE security_enforcement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES registry_packages(id),
  report_id UUID REFERENCES security_reports(id),
  state security_action_state NOT NULL,
  reason_code TEXT NOT NULL,
  source TEXT NOT NULL,                     -- auto|human_reviewer|appeal
  created_by UUID,                          -- nullable for auto
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_actions_package_active ON security_enforcement_actions(package_id, active, created_at DESC);
CREATE INDEX idx_actions_expiry ON security_enforcement_actions(expires_at) WHERE active = TRUE;

-- Hardening: ensure only one active blocking action per package
CREATE UNIQUE INDEX uq_actions_one_active_block_per_package
ON security_enforcement_actions(package_id)
WHERE active = TRUE AND state IN ('policy_blocked_temp', 'policy_blocked_perm');

-- Current projection for fast preflight reads
CREATE TABLE security_enforcement_current (
  package_id UUID PRIMARY KEY REFERENCES registry_packages(id),
  state security_action_state NOT NULL DEFAULT 'none',
  reason_code TEXT,
  action_id UUID REFERENCES security_enforcement_actions(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable audit
CREATE TABLE security_action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES security_enforcement_actions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                 -- created|expired|overridden|reinstated
  actor_type TEXT NOT NULL,                 -- auto|reviewer|maintainer
  actor_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION security_prevent_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security_action_audit is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_security_action_audit_no_update
BEFORE UPDATE ON security_action_audit
FOR EACH ROW EXECUTE FUNCTION security_prevent_audit_mutation();

CREATE TRIGGER trg_security_action_audit_no_delete
BEFORE DELETE ON security_action_audit
FOR EACH ROW EXECUTE FUNCTION security_prevent_audit_mutation();

-- Appeals
CREATE TABLE security_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES registry_packages(id),
  action_id UUID NOT NULL REFERENCES security_enforcement_actions(id),
  maintainer_id UUID NOT NULL,
  statement TEXT NOT NULL,
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',      -- open|accepted|rejected
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolver_id UUID
);

CREATE INDEX idx_appeals_open ON security_appeals(status, opened_at);

-- Reporter score history
CREATE TABLE security_reporter_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES security_reporters(id) ON DELETE CASCADE,
  precision_confirmed_reports NUMERIC(5,4) NOT NULL,
  evidence_completeness NUMERIC(5,4) NOT NULL,
  reviewer_agreement_rate NUMERIC(5,4) NOT NULL,
  sla_compliance NUMERIC(5,4) NOT NULL,
  conflict_disclosure_compliance NUMERIC(5,4) NOT NULL,
  false_positive_inverse NUMERIC(5,4) NOT NULL,
  computed_score NUMERIC(5,4) NOT NULL,
  computed_tier security_reporter_tier NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Abuse signals
CREATE TABLE security_abuse_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES security_reporters(id),
  report_id UUID REFERENCES security_reports(id),
  signal_type TEXT NOT NULL,                -- low_evidence|spam_pattern|conflict_undisclosed
  score NUMERIC(5,4) NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 4) Decision function + enforcement projection

```sql
CREATE OR REPLACE FUNCTION security_apply_action(
  p_package_id UUID,
  p_report_id UUID,
  p_state security_action_state,
  p_reason_code TEXT,
  p_source TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_action_id UUID;
BEGIN
  INSERT INTO security_enforcement_actions(
    package_id, report_id, state, reason_code, source, expires_at, active
  ) VALUES (
    p_package_id, p_report_id, p_state, p_reason_code, p_source, p_expires_at, TRUE
  ) RETURNING id INTO v_action_id;

  INSERT INTO security_enforcement_current(package_id, state, reason_code, action_id, updated_at)
  VALUES (p_package_id, p_state, p_reason_code, v_action_id, now())
  ON CONFLICT (package_id) DO UPDATE
  SET state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      action_id = EXCLUDED.action_id,
      updated_at = now();

  INSERT INTO security_action_audit(action_id, event_type, actor_type, payload)
  VALUES (v_action_id, 'created', p_source, '{}'::jsonb);

  RETURN v_action_id;
END;
$$ LANGUAGE plpgsql;
```

### Rule evaluator

```sql
CREATE OR REPLACE FUNCTION security_evaluate_report(p_report_id UUID)
RETURNS VOID AS $$
DECLARE
  r RECORD;
  pkg RECORD;
BEGIN
  SELECT sr.*, srep.tier, srep.status AS reporter_status
  INTO r
  FROM security_reports sr
  JOIN security_reporters srep ON srep.id = sr.reporter_id
  WHERE sr.id = p_report_id;

  IF r.reporter_status <> 'active' OR NOT r.signature_valid OR NOT r.evidence_minimums_met OR r.abuse_suspected THEN
    UPDATE security_reports SET status = 'rejected' WHERE id = p_report_id;
    RETURN;
  END IF;

  FOR pkg IN SELECT * FROM security_report_packages WHERE report_id = p_report_id LOOP
    IF r.tier = 'A' AND r.severity = 'critical' AND pkg.source_kind = 'raw' THEN
      PERFORM security_apply_action(pkg.package_id, p_report_id, 'policy_blocked_temp', 'malware_critical_tier_a', 'auto', now() + interval '72 hours');
    ELSIF (r.tier = 'A' OR r.tier = 'B') AND r.severity IN ('high','critical') THEN
      PERFORM security_apply_action(pkg.package_id, p_report_id, 'flagged', 'needs_human_review', 'auto', NULL);
    ELSE
      -- Tier C or low confidence: advisory only
      NULL;
    END IF;
  END LOOP;

  UPDATE security_reports SET status = 'queued_review', validated_at = now() WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 5) Cron jobs (`pg_cron`)

```sql
-- Every minute: evaluate newly submitted reports
SELECT cron.schedule(
  'security_eval_pending_reports',
  '* * * * *',
  $$SELECT security_eval_pending_batch(200);$$
);

-- Every 5 min: expire temp blocks and restore projection
SELECT cron.schedule(
  'security_expire_temp_blocks',
  '*/5 * * * *',
  $$SELECT security_expire_actions();$$
);

-- Every 15 min: SLA breach scanner (appeals + reviews)
SELECT cron.schedule(
  'security_sla_monitor',
  '*/15 * * * *',
  $$SELECT security_check_sla_and_notify();$$
);

-- Hourly: purge nonce replay table older than 24h
SELECT cron.schedule(
  'security_purge_nonces',
  '0 * * * *',
  $$DELETE FROM security_request_nonces WHERE seen_at < now() - interval '24 hours';$$
);

-- Daily: recompute reporter scores
SELECT cron.schedule(
  'security_recompute_reporter_scores_daily',
  '10 2 * * *',
  $$SELECT security_recompute_reporter_scores();$$
);

-- Weekly: apply tier promotions/demotions
SELECT cron.schedule(
  'security_recompute_tiers_weekly',
  '0 3 * * 1',
  $$SELECT security_apply_reporter_tiers();$$
);

-- Daily: search/ranking penalties sync from enforcement_current
SELECT cron.schedule(
  'security_sync_rank_penalties',
  '20 2 * * *',
  $$SELECT security_sync_ranking_penalties();$$
);
```

### Required job functions (stubs if not yet implemented)

```sql
CREATE OR REPLACE FUNCTION security_eval_pending_batch(p_limit INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_report_id UUID;
BEGIN
  FOR v_report_id IN
    SELECT id
    FROM security_reports
    WHERE status = 'submitted'
    ORDER BY submitted_at ASC
    LIMIT p_limit
  LOOP
    PERFORM security_evaluate_report(v_report_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_expire_actions()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE security_enforcement_actions
  SET active = FALSE
  WHERE active = TRUE
    AND state = 'policy_blocked_temp'
    AND expires_at IS NOT NULL
    AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Rebuild current projection for changed packages
  INSERT INTO security_enforcement_current(package_id, state, reason_code, action_id, updated_at)
  SELECT x.package_id, x.state, x.reason_code, x.id, now()
  FROM (
    SELECT DISTINCT ON (package_id)
      package_id, id, state, reason_code, created_at
    FROM security_enforcement_actions
    WHERE active = TRUE
    ORDER BY package_id, created_at DESC
  ) x
  ON CONFLICT (package_id) DO UPDATE
  SET state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      action_id = EXCLUDED.action_id,
      updated_at = now();

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_check_sla_and_notify()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM security_appeals
  WHERE status = 'open'
    AND opened_at < now() - interval '8 hours';

  -- notification integration point (queue/webhook) goes here
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_apply_reporter_tiers()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE security_reporters
  SET tier = CASE
      WHEN trust_score >= 0.85 THEN 'A'::security_reporter_tier
      WHEN trust_score >= 0.65 THEN 'B'::security_reporter_tier
      ELSE 'C'::security_reporter_tier
    END,
    updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_sync_ranking_penalties()
RETURNS INTEGER AS $$
BEGIN
  -- integration point: project enforcement state into search/ranking store
  RETURN 0;
END;
$$ LANGUAGE plpgsql;
```

---

## 6) Reporter scoring SQL (weekly formula)

```sql
CREATE OR REPLACE FUNCTION security_recompute_reporter_scores()
RETURNS VOID AS $$
BEGIN
  WITH metrics AS (
    SELECT
      r.id AS reporter_id,
      COALESCE(m.precision_confirmed_reports,0) AS precision_confirmed_reports,
      COALESCE(m.evidence_completeness,0) AS evidence_completeness,
      COALESCE(m.reviewer_agreement_rate,0) AS reviewer_agreement_rate,
      COALESCE(m.sla_compliance,0) AS sla_compliance,
      COALESCE(m.conflict_disclosure_compliance,0) AS conflict_disclosure_compliance,
      COALESCE(m.false_positive_inverse,0) AS false_positive_inverse
    FROM security_reporters r
    LEFT JOIN security_reporter_metrics_30d m ON m.reporter_id = r.id
  ),
  scored AS (
    SELECT
      reporter_id,
      precision_confirmed_reports,
      evidence_completeness,
      reviewer_agreement_rate,
      sla_compliance,
      conflict_disclosure_compliance,
      false_positive_inverse,
      (
        0.35 * precision_confirmed_reports +
        0.20 * evidence_completeness +
        0.15 * reviewer_agreement_rate +
        0.10 * sla_compliance +
        0.10 * conflict_disclosure_compliance +
        0.10 * false_positive_inverse
      )::numeric(5,4) AS score
    FROM metrics
  )
  INSERT INTO security_reporter_score_history(
    reporter_id, precision_confirmed_reports, evidence_completeness, reviewer_agreement_rate,
    sla_compliance, conflict_disclosure_compliance, false_positive_inverse,
    computed_score, computed_tier
  )
  SELECT
    reporter_id, precision_confirmed_reports, evidence_completeness, reviewer_agreement_rate,
    sla_compliance, conflict_disclosure_compliance, false_positive_inverse,
    score,
    CASE
      WHEN score >= 0.85 THEN 'A'::security_reporter_tier
      WHEN score >= 0.65 THEN 'B'::security_reporter_tier
      ELSE 'C'::security_reporter_tier
    END
  FROM scored;

  UPDATE security_reporters r
  SET
    trust_score = h.computed_score,
    tier = h.computed_tier,
    updated_at = now()
  FROM LATERAL (
    SELECT computed_score, computed_tier
    FROM security_reporter_score_history
    WHERE reporter_id = r.id
    ORDER BY computed_at DESC
    LIMIT 1
  ) h;
END;
$$ LANGUAGE plpgsql;
```

---

## 7) Install/runtime preflight integration (critical path)

- Preflight reads only `security_enforcement_current`.
- Block conditions:
  - `state IN ('policy_blocked_temp','policy_blocked_perm')` => return `policy_blocked`.
  - `state = 'flagged'` => allow install/runtime with warning metadata.
- Keeps preflight deterministic and low-latency.

---

## 8) One-sprint build order

- Sprint Day 1-2: migrations + enums + core tables + indexes
- Sprint Day 3: signed report ingestion endpoint + idempotency + nonce replay checks
- Sprint Day 4: evaluator function + enforcement projection + preflight read endpoint
- Sprint Day 5: review + appeal endpoints + cron wiring + dashboard queries
