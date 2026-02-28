# Beta Triage Playbook (E10-S2)

Status: Active
Date: 2026-02-28
Owner: Engineering Leads

## Objective

Triage beta failures using a consistent severity model and close high-severity issues before GA decision review.

## Severity Rubric

1. `SEV0`: Data-loss/security-unsafe behavior or release-gate integrity failure.
2. `SEV1`: Core install loop broken for broad cohort segments.
3. `SEV2`: Partial degradation with workaround and bounded impact.
4. `SEV3`: Cosmetic/non-blocking issue with no safety impact.

## Top Failure Class Workflow

1. Intake
   - capture failure event, command, environment, and blocker string.
   - map to loop stage: discover, plan, install, verify.
2. Classify
   - assign severity (`SEV0..SEV3`) and owner.
   - tag whether governance/migration/privacy constraints are implicated.
3. Contain
   - for `SEV0/SEV1`, freeze affected release channel and disable risky production modes.
   - keep trust-gate operations in dry-run until containment is complete.
4. Diagnose
   - run symptom -> cause -> fix analysis and reproduce with deterministic commands.
5. Resolve
   - apply scoped fix, rerun targeted tests, then rerun relevant release gates.
6. Verify closure
   - verify blocker is closed or explicitly deferred with owner/date/sign-off.

## Required Evidence per Incident

1. Exact failing command + output summary.
2. Stage impact (discover/plan/install/verify).
3. Root cause summary.
4. Fix reference (commit/PR/doc).
5. Re-validation commands and outcomes.
6. Deferred status (if not closed) with owner and date.

## Escalation Rules

1. `SEV0`: immediate escalation to Product + Platform + Security; GA decision automatically `Hold`.
2. `SEV1`: daily review until resolved or formally deferred.
3. `SEV2/SEV3`: batch into scheduled triage windows unless trend indicates escalation.

## Exit Criteria for E10-S2

1. No unresolved `SEV0`.
2. `SEV1` issues are either closed or explicitly deferred with sign-off.
3. Triage evidence is attached to GA readiness review artifacts.
