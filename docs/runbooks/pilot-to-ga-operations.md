# Pilot-to-GA Operations

Date: 2026-03-09
Owner: Product + Platform + Security
Status vocabulary: see `docs/application-completion-backlog.md` (Ready for Execution, Executed, Approved)

## Prerequisites

1. E10-S1 status is `Ready for Execution` in `docs/application-completion-backlog.md`.
2. All technical gates in `docs/release-evidence.md` show PASS.
3. `npm run check` passes (governance + typecheck + tests).
4. `npm run verify:migrations:dr018` passes.
5. `npm run test:e2e-local` and `npm run test:integration-db:docker` pass.
6. `FORGE_DATABASE_URL` is set to a valid Postgres connection string with migrations `001..016` applied.
7. Pre-pilot baseline review exists: `docs/ga-readiness-review-2026-03-08.md`.

## Phase 1: Pilot Execution (E10-S1)

Reference: `docs/beta-pilot-plan.md`

### 1.1 Cohort onboarding

HUMAN GATE: Distribute signed candidate artifact to each cohort per `docs/beta-pilot-plan.md` section "Onboarding Path".

For each cohort member:
1. Provide `artifacts/forge-candidate-0.2.0-rc.1-<sha>.tar.gz` and `artifacts/release.sha256`.
2. Have them verify checksums and run baseline smoke commands:
   ```bash
   npm run run:retrieval-sync -- --mode dry-run --limit 25
   npm run run:outbox -- --mode dry-run --limit 25
   npm run run:slo-rollup -- --mode dry-run --from <pilot-start> --to <pilot-end> --limit 100
   ```
3. Have them run trust-gate dry-run:
   ```bash
   npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <pilot-start> --window-to <pilot-end> --trigger beta-pilot
   ```

### 1.2 Capture SLO metrics

```bash
npm run run:slo-rollup -- --mode production --from <pilot-start> --to <pilot-end> --limit 100
```

### 1.3 Run beta readiness report

```bash
npm run run:beta-readiness -- --mode dry-run --from <pilot-start> --to <pilot-end>
npm run run:beta-readiness -- --mode production --from <pilot-start> --to <pilot-end> --output artifacts/beta-readiness-report.json
```

### 1.4 Interpret go/no-go

The readiness report emits a `go_no_go` field. Rules from `docs/beta-pilot-plan.md`:
- `go`: all 8 required KPIs pass. Proceed to Phase 2.
- `blocked`: no KPI fails but one or more has insufficient data. Collect more traffic and rerun.
- `no-go`: one or more required KPIs fail. Investigate before proceeding.

### 1.5 Minimum traffic requirement

HUMAN GATE: Confirm >= 20 lifecycle events before treating results as valid:

```sql
SELECT COUNT(*) FROM install_lifecycle_audit
WHERE created_at BETWEEN '<pilot-start>' AND '<pilot-end>';
```

If count < 20, continue pilot traffic, then rerun steps 1.2 and 1.3.

## Phase 2: Triage (E10-S2)

Reference: `docs/beta-triage-playbook.md`

### 2.1 Triage workflow

For each failure observed during pilot:
1. Intake: capture failing command, output, environment, blocker string.
2. Classify: assign severity (`SEV0`-`SEV3`) and owner per `docs/beta-triage-playbook.md`.
3. Contain: for `SEV0`/`SEV1`, freeze affected release channel.
4. Diagnose: reproduce with deterministic commands.
5. Resolve: apply fix, rerun targeted tests, then rerun release gates.
6. Verify closure: confirm blocker is closed or explicitly deferred with owner/date/sign-off.

### 2.2 Required evidence per incident

1. Exact failing command + output summary.
2. Stage impact (discover/plan/install/verify).
3. Root cause summary.
4. Fix reference (commit/PR).
5. Re-validation commands and outcomes.
6. Deferred status (if not closed) with owner and target date.

### 2.3 Exit criteria

HUMAN GATE: Confirm all three before proceeding:
1. No unresolved `SEV0`.
2. All `SEV1` issues are closed or explicitly deferred with sign-off.
3. Triage evidence is attached to GA readiness review artifacts.

## Phase 3: GA Decision (E10-S3)

Reference: `docs/ga-launch-report-template.md`, `docs/ga-readiness-review-template.md`

### 3.1 Validate release evidence

```bash
node scripts/validate-release-evidence.mjs --file docs/release-evidence.md --expected-version 0.2.0-rc.1 --require-approved-status --require-complete-signoffs
```

This will fail if `STATUS:` is still `DRAFT` or sign-offs contain placeholders. That is expected until step 3.3.

### 3.2 Populate GA launch report

HUMAN GATE: Copy template, fill every section with actual pilot outcomes, gate results, blocker table, and risk assessment. Reference `artifacts/beta-readiness-report.json` for beta data.

```bash
cp docs/ga-launch-report-template.md docs/ga-launch-report.md
```

### 3.3 Collect sign-offs

HUMAN GATE: Obtain approval from all four required roles, then apply:

```bash
npm run release:apply-signoffs -- --file docs/release-evidence.md --release-manager "<name>" --security-reviewer "<name>" --qa-owner "<name>" --platform-owner "<name>" --approve --expected-version 0.2.0-rc.1
```

This promotes `docs/release-evidence.md` from `STATUS: DRAFT` to `STATUS: APPROVED`.

### 3.4 Release preflight

```bash
npm run release:prepare -- --mode preflight --channel candidate --version 0.2.0-rc.1 --evidence docs/release-evidence.md
```

Preflight checks evidence completeness, version consistency, and gate status. Fix any reported issues before proceeding.

## Phase 4: Release Packaging

Reference: `docs/release-checklist.md`

### 4.1 Package the release

```bash
npm run release:prepare -- --mode package --channel candidate --version 0.2.0-rc.1 --evidence docs/release-evidence.md
```

Expected outputs:
- `artifacts/forge-candidate-0.2.0-rc.1-<sha>.tar.gz`
- `artifacts/release.sha256`
- `artifacts/distribution-manifest.json`

### 4.2 CI workflow dispatch for signing

HUMAN GATE: Trigger the CI release workflow for GPG signing. The key (`FORGE_RELEASE_GPG_PRIVATE_KEY_B64`) is a CI-only secret.

Expected CI outputs:
- `artifacts/release.sha256.asc` (detached GPG signature)
- Signature verification pass within the workflow

### 4.3 Artifact verification

```bash
node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0-rc.1
node scripts/validate-release-evidence.mjs --file docs/release-evidence.md --expected-version 0.2.0-rc.1 --require-approved-status --require-complete-signoffs
```

Confirm all three artifact files exist in `artifacts/` and checksums match.

## Human Gates Checklist

| # | Gate | Phase | Description |
|---|------|-------|-------------|
| 1 | Cohort onboarding | 1.1 | Distribute signed artifacts to pilot cohorts |
| 2 | Minimum traffic | 1.5 | Confirm >= 20 lifecycle events before accepting readiness results |
| 3 | Triage sign-off | 2.3 | Confirm SEV0 resolved, SEV1 closed or deferred with sign-off |
| 4 | GA launch report | 3.2 | Fill GA launch report with actual pilot data |
| 5 | Role sign-offs | 3.3 | Release Manager, Security Reviewer, QA Owner, Platform Owner approve |
| 6 | CI signing | 4.2 | Trigger CI workflow for GPG signing with release key |
| 7 | Final artifact check | 4.3 | Verify bundle, checksum, signature, and distribution manifest |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Readiness shows `blocked`, all `insufficient_data` | No pilot traffic | Onboard cohorts, generate >= 20 lifecycle events, rerun SLO rollup and readiness |
| `validate-release-evidence.mjs` fails on status | `STATUS: DRAFT` | Complete sign-offs with `release:apply-signoffs` first |
| `validate-release-evidence.mjs` fails on sign-offs | Placeholder values remain | Collect real names from all four required roles |
| Preflight reports version mismatch | Evidence `Release:` line wrong | Update `docs/release-evidence.md` to match `--version` |
| Package fails on dirty worktree | Uncommitted changes | Commit or stash; package requires clean committed revision |
| GPG signature missing after CI | Signing key not configured | Confirm `FORGE_RELEASE_GPG_PRIVATE_KEY_B64` in CI environment |
| SLO rollup shows 0 metrics | DB or empty window | Verify `FORGE_DATABASE_URL` and window covers actual pilot traffic |
| Trust-gate returns `decision_type=hold` | Initial rollout posture | Normal for pre-GA; does not block if KPIs pass |
| `npm run check` fails | Governance, typecheck, or test | Run `check:governance`, `typecheck`, `test` individually to isolate |
