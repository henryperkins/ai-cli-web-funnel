# GA Launch Report Template (E10-S3)

Release: `<tag>`
Date: `<yyyy-mm-dd>`
Prepared by: `<owner>`

## 1) Executive Decision

- Launch decision: `<Launch|Hold>`
- Decision scope: `<channels and cohorts>`
- Summary rationale: `<short rationale>`

## 2) Beta Outcome Summary

- Beta readiness status: `<go|blocked|no-go>`
- Beta report reference: `<artifact/path>`
- Cohorts covered: `<A/B/C>`
- Notable regressions: `<summary>`

## 3) Gate Matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run check` | `<PASS|FAIL|BLOCKED>` | `<evidence>` |
| `npm run verify:migrations:dr018` | `<PASS|FAIL|BLOCKED>` | `<evidence>` |
| `npm run test:e2e-local` | `<PASS|FAIL|BLOCKED>` | `<evidence>` |
| `npm run test:integration-db:docker` | `<PASS|FAIL|BLOCKED>` | `<evidence>` |
| trust-gate dry-run | `<PASS|FAIL|BLOCKED>` | `<evidence>` |
| release artifact signature verification | `<PASS|FAIL|BLOCKED>` | `<evidence>` |

## 4) Unresolved Blockers

| Blocker | Severity | Owner | Target Date | Approved Deferral |
| --- | --- | --- | --- | --- |
| `<blocker>` | `<sev>` | `<owner>` | `<yyyy-mm-dd>` | `<yes/no>` |

## 5) Risk and Rollback Readiness

1. Highest residual risk: `<description>`
2. Rollback trigger conditions: `<conditions>`
3. Rollback command/evidence link: `<link>`

## 6) Distribution Channel Decision

- Channel: `<stable|candidate|canary>`
- Version: `<semver>`
- Policy validation evidence: `scripts/verify-distribution-policy.mjs`
- Artifact manifest: `artifacts/distribution-manifest.json`

## 7) Sign-Off

- Product Owner: `<name>`
- Platform Owner: `<name>`
- Security Reviewer: `<name>`
- QA Owner: `<name>`
- Release Manager: `<name>`
