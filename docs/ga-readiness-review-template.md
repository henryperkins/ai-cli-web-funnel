# GA Readiness Review Template (E10-S1 -> E10-S3)

Review Date: `<yyyy-mm-dd>`
Release Candidate: `<tag-or-rc-id>`
Window: `<from-iso>` to `<to-iso>`

## 1) Beta Readiness Summary

- Overall status: `<go|blocked|no-go>`
- Report source: `npm run run:beta-readiness -- --mode <dry-run|production> --from <iso> --to <iso>`
- Total KPIs: `<count>`
- Pass: `<count>`
- Fail: `<count>`
- Insufficient data: `<count>`

## 2) KPI Detail

| KPI | Value | Threshold | Status | Notes |
| --- | --- | --- | --- | --- |
| install.apply.success_rate | `<value>` | `>= 0.98` | `<pass|fail|insufficient_data>` | `<notes>` |
| install.verify.success_rate | `<value>` | `>= 0.97` | `<pass|fail|insufficient_data>` | `<notes>` |
| profile.install_run.success_rate | `<value>` | `>= 0.95` | `<pass|fail|insufficient_data>` | `<notes>` |
| retrieval.semantic_fallback.rate | `<value>` | `<= 0.15` | `<pass|fail|insufficient_data>` | `<notes>` |
| outbox.dispatch.dead_letter_rate | `<value>` | `<= 0.01` | `<pass|fail|insufficient_data>` | `<notes>` |
| funnel.ttfsc.p90_seconds | `<value>` | `<= 300` | `<pass|fail|insufficient_data>` | `<notes>` |
| funnel.cold_start.success_rate | `<value>` | `>= 0.95` | `<pass|fail|insufficient_data>` | `<notes>` |
| funnel.retryless.success_rate | `<value>` | `>= 0.85` | `<pass|fail|insufficient_data>` | `<notes>` |

## 3) Operational Validation

| Check | Result | Notes |
| --- | --- | --- |
| `npm run check` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| `npm run verify:migrations:dr018` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| `npm run test:e2e-local` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| `npm run test:integration-db:docker` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| trust-gate dry-run evaluate | `<PASS|FAIL|BLOCKED>` | `<details>` |

## 4) Blockers and Deferrals

| Item | Severity | Owner | Target Date | Mitigation |
| --- | --- | --- | --- | --- |
| `<item>` | `<sev0|sev1|sev2|sev3>` | `<owner>` | `<yyyy-mm-dd>` | `<mitigation>` |

## 5) Decision

- Decision: `<Proceed to GA|Hold|Rollback candidate>`
- Rationale: `<summary>`
- Conditions for next review: `<actions>`

## 6) Sign-Off

- Product Owner: `<name>`
- Platform Owner: `<name>`
- Security Reviewer: `<name>`
- QA Owner: `<name>`
