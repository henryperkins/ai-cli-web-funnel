# E6 Plan: Security, Trust, and Governance Enforcement

Stories: `E6-S1`, `E6-S2`, `E6-S3`, `E6-S4`
Owner: Security Governance + Platform + Product Governance
Priority: `P0`
Status: In Progress (2026-02-28; implementation complete, governance approvals remain explicit/manual)

## Objective

Enforce trust and governance behavior for GA: policy-gated apply, explainable decisions, stable recompute operations, and explicit governance approval closure.

## In Scope

1. Enforce package trust gates before apply.
2. Finalize reporter ingestion and enforcement recompute operational reliability.
3. Add explainable policy decision payloads.
4. Close required AQ/MQ approvals for GA posture.

## Out of Scope

1. New governance feature families outside v1 scope.
2. Post-GA monetization policy mechanics.

## Implementation Steps

1. Enforce trust gates (`E6-S1`).
- Integrate policy outcomes into apply gating path.
- Fail closed with explicit reason codes.

2. Finalize ingestion/recompute reliability (`E6-S2`).
- Validate recompute path metrics readiness and outbox handling under failure/retry.
- Confirm runbook completeness for incident response.

3. Add decision explainability (`E6-S3`).
- Extend API payloads with policy reason/remediation details.
- Keep response fields deterministic and test-covered.

4. Governance closure (`E6-S4`).
- Compile required AQ/MQ/DR approvals.
- Ensure approvals and code/docs changes land in aligned change sets.

## File Touchpoints

1. `packages/security-governance/src/`
2. `apps/control-plane/src/install-lifecycle.ts`
3. `apps/control-plane/src/http-app.ts`
4. `OPEN_QUESTIONS_TRACKER.md`
5. `application_decision_records.md`
6. `DECISION_LOG.md`
7. `docs/runbooks/`

## Validation Commands

1. `npm run check`
2. `npm run test`
3. `npm run test:integration-db:docker`
4. `node scripts/verify-governance-drift.mjs`

## Exit Criteria

1. Apply path enforces trust policy with deterministic outcomes.
2. Policy decisions are explainable in API payloads.
3. Governance approvals required for GA are explicitly closed and recorded.
