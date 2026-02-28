# Beta Pilot Plan (E10-S1)

Status: Ready for execution
Date: 2026-02-28
Owners: Product (pilot), Platform (operations), Security (trust gates)

## Objective

Run a closed beta that validates the discover/plan/install/verify loop under real usage while preserving governance and release safety constraints.

## Cohort Definition

1. Cohort A (internal operators): platform/security maintainers validating runbooks and incident response.
2. Cohort B (design partners): selected external users with mixed runtime environments.
3. Cohort C (compatibility stress): users with profile-heavy multi-package installs.

## Onboarding Path

1. Provide signed candidate artifact and checksum/signature verification instructions.
2. Complete environment preflight and DB prerequisites from runbooks.
3. Execute baseline smoke commands:
   - `npm run run:retrieval-sync -- --mode dry-run --limit 25`
   - `npm run run:outbox -- --mode dry-run --limit 25`
   - `npm run run:slo-rollup -- --mode dry-run --from <iso> --to <iso> --limit 100`
4. Execute trust-gate dry-run checks:
   - `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger beta-pilot`

## KPI Targets and Go/No-Go Thresholds

| KPI | Source | Target | Gate |
| --- | --- | --- | --- |
| install.apply.success_rate | `operational_slo_snapshots` | >= 0.98 | required |
| install.verify.success_rate | `operational_slo_snapshots` | >= 0.97 | required |
| profile.install_run.success_rate | `operational_slo_snapshots` | >= 0.95 | required |
| retrieval.semantic_fallback.rate | `operational_slo_snapshots` | <= 0.15 | required |
| outbox.dispatch.dead_letter_rate | `operational_slo_snapshots` | <= 0.01 | required |
| funnel.ttfsc.p90_seconds | `operational_slo_snapshots.metadata.p90_seconds_exact` | <= 300 | required |
| funnel.cold_start.success_rate | `operational_slo_snapshots` | >= 0.95 | required |
| funnel.retryless.success_rate | `operational_slo_snapshots` | >= 0.85 | required |

## Reporting Command

Generate readiness snapshots with:
1. `npm run run:beta-readiness -- --mode dry-run --from <iso> --to <iso>`
2. Optional persisted artifact:
   - `npm run run:beta-readiness -- --mode production --from <iso> --to <iso> --output artifacts/beta-readiness-report.json`

## Execution Cadence

1. Daily readiness snapshots during pilot week.
2. Mid-pilot triage review (E10-S2) for top failure classes.
3. End-of-pilot GA decision review using E10-S3 templates.

## Go/No-Go Rules

1. `go`: all required KPIs pass.
2. `blocked`: no failing KPI, but one or more KPIs have insufficient data.
3. `no-go`: one or more required KPIs fail.

## Required Artifacts

1. beta readiness report output (`beta_readiness.run_completed` payload or saved artifact).
2. unresolved blocker table with owner + target date.
3. signed release evidence bundle references.
