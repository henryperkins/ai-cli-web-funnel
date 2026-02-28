# Release Evidence Template

Release: `<tag-or-rc-id>`
Date: `<yyyy-mm-dd>`
Commit: `<sha>`

STATUS: DRAFT

## Gate Results

| Gate | Command | Result | Notes/Blocker |
| --- | --- | --- | --- |
| check | `npm run check` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| migration verify | `npm run verify:migrations:dr018` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| e2e local | `npm run test:e2e-local` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| integration-db docker | `npm run test:integration-db:docker` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| retrieval dry-run | `npm run run:retrieval-sync -- --mode dry-run --limit 25` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| outbox dry-run | `npm run run:outbox -- --mode dry-run --limit 25` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| dead-letter list | `npm run run:outbox-dead-letter -- --action list --limit 25` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| slo-rollup dry-run | `npm run run:slo-rollup -- --mode dry-run --from <iso> --to <iso> --limit 100` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| trust-gate evaluate dry-run | `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger release-evidence` | `<PASS|FAIL|BLOCKED>` | `<details>` |
| promotion eligibility dry-run | `npm run run:security-promotion -- --mode dry-run --package-id <uuid> --reviewer-id <id> --evidence-ref <ticket-id>` | `<PASS|FAIL|BLOCKED>` | `<details>` |

## Migration Notes

- Migration list: `<001..N>`
- Lock-risk summary: `<brief>`
- Rollback notes: `<brief>`

## Artifact Integrity

- Source bundle: `<artifact-name>`
- Checksum manifest: `<artifact-path>`
- Signature file: `<artifact-path>`
- Signature verification: `<PASS|FAIL>`
- Distribution manifest: `<artifact-path>`
- Distribution channel: `<stable|candidate|canary>`
- Distribution policy validation: `node scripts/verify-distribution-policy.mjs --channel <channel> --version <semver>` -> `<PASS|FAIL>`

## Beta Outcomes

- Beta readiness status: `<go|blocked|no-go>`
- Beta readiness report reference: `<artifact-or-log-ref>`
- Triage playbook reference: `docs/beta-triage-playbook.md`
- GA readiness review reference: `docs/ga-readiness-review-template.md`

## Deferred Items

| Item | Owner | Follow-up Date | Rationale |
| --- | --- | --- | --- |
| `<item>` | `<owner>` | `<yyyy-mm-dd>` | `<reason>` |

## Sign-Off

- Release Manager: `<name>`
- Security Reviewer: `<name>`
- QA Owner: `<name>`
- Platform Owner: `<name>`

STATUS: APPROVED
