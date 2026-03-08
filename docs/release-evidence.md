# Release Evidence

Release: `v0.2.0-rc.1`
Date: `2026-03-08`
Commit: `f151dcf`

STATUS: DRAFT

## Gate Results

| Gate | Command | Result | Notes/Blocker |
| --- | --- | --- | --- |
| check | `npm run check` | PASS | governance + docs-status + typecheck + workspace/integration suite |
| migration verify | `npm run verify:migrations:dr018` | PASS | all DR-018 guards passed |
| e2e local | `npm run test:e2e-local` | PASS | local end-to-end lifecycle suite passed |
| integration-db docker | `npm run test:integration-db:docker` | PASS | docker-backed integration-db suite passed |
| retrieval dry-run | `npm run run:retrieval-sync -- --mode dry-run --limit 25` | PASS | 0 candidates (empty catalog, expected) |
| outbox dry-run | `npm run run:outbox -- --mode dry-run --limit 25` | PASS | 0 claimed (no pending outbox jobs) |
| dead-letter list | `npm run run:outbox-dead-letter -- --action list --limit 25` | PASS | 0 dead-letter rows |
| slo-rollup dry-run | `npm run run:slo-rollup -- --mode dry-run --from 2026-02-21T00:00:00Z --to 2026-03-08T00:00:00Z --limit 100` | PASS | 10 metric families computed, 0 sample data (expected for fresh DB) |
| trust-gate evaluate dry-run | `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from 2026-02-21T00:00:00Z --window-to 2026-03-08T00:00:00Z --trigger release-evidence` | PASS | decision_type=hold, freeze_active=true (initial rollout posture) |
| promotion eligibility dry-run | `npm run run:security-promotion -- --mode dry-run --package-id <uuid> --reviewer-id validator --evidence-ref VALIDATION-001` | PASS | argument validation functional; no live packages to promote |
| distribution policy (candidate) | `node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0-rc.1` | PASS | |
| distribution policy (stable) | `node scripts/verify-distribution-policy.mjs --channel stable --version 0.2.0` | PASS | |
| distribution policy (negative: stable+prerelease) | `node scripts/verify-distribution-policy.mjs --channel stable --version 0.2.0-rc.1` | PASS (rejected) | correctly exits 1 with policy error |
| distribution policy (negative: candidate+release) | `node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0` | PASS (rejected) | correctly exits 1 with policy error |

## Migration Notes

- Migration list: `001..016`
- Lock-risk summary: all migrations are additive DDL (`CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Brief metadata locks only; no table rewrites.
- Rollback notes: forward-compensation only. No destructive down migrations. See `docs/runbooks/migration-rollout-and-rollback.md`.

## Artifact Integrity

- Source bundle: `artifacts/forge-candidate-0.2.0-rc.1-f151dcf.tar.gz` (planned final package name from clean commit `f151dcf`)
- Checksum manifest: `artifacts/release.sha256` (regenerate during final package step)
- Checksum: `<pending>`
- Signature file: `artifacts/release.sha256.asc` (pending: GPG signing key not available in local environment; enforced in CI via `FORGE_RELEASE_GPG_PRIVATE_KEY_B64`)
- Signature verification: BLOCKED (local-only; CI workflow enforces this gate)
- Distribution manifest: `artifacts/distribution-manifest.json` (regenerate during final package step)
- Distribution channel: `candidate`
- Distribution policy validation: `node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0-rc.1` -> PASS

## Beta Outcomes

- Beta readiness status: `blocked` (pilot execution has not started; all tooling is ready)
- Beta readiness report reference: `artifacts/beta-readiness-report.json` (baseline artifact generated; all KPI windows currently `insufficient_data`)
- Triage playbook reference: `docs/beta-triage-playbook.md`
- GA readiness review reference: `docs/ga-readiness-review-2026-03-08.md`

## Deferred Items

| Item | Owner | Follow-up Date | Rationale |
| --- | --- | --- | --- |
| Final package generation from commit `f151dcf` | Release Manager + Platform | 2026-03-10 | package step must be rerun after evidence approval and signing material are available |
| Human sign-offs + evidence promotion to `APPROVED` | Release Manager + Security + QA + Platform | 2026-03-10 | release workflow will reject draft evidence and placeholder sign-offs |
| GPG signature verification (local) | Platform Ops | 2026-03-10 | signing key is a CI-only secret; workflow enforces before publish |
| Beta pilot KPI population | Product | 2026-03-10 | artifacts/scripts ready; live pilot not yet started |
| GA launch decision | Product + Security + QA + Platform | 2026-03-14 | depends on beta outcomes and triage closure |

## Sign-Off

- Release Manager: `<pending>`
- Security Reviewer: `<pending>`
- QA Owner: `<pending>`
- Platform Owner: `<pending>`
