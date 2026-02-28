# Wave 8 Build Report

Date: 2026-02-28  
Scope: Profile/bundle orchestration foundations and security event family expansion.

## 1) Step-by-step implementation summary (Step 1..12)

Wave 8 was not executed as a formally scoped wave with a numbered step matrix. Instead, profile/bundle foundations were built incrementally during the gap between Wave 7 closure and Wave 9 scope lock. The following capabilities were delivered:

1. Profile/bundle contract types: added `packages/shared-contracts/src/profiles.ts` with `ProfileInstallMode`, `ProfilePackageInput`, `ProfileCreateInput`, `ProfileExportPayload`, and related types.
2. Profile API routes: `GET/POST /v1/profiles`, `GET /v1/profiles/:id`, `GET|POST /v1/profiles/:id/export` (GET preferred; POST retained for compatibility), `POST /v1/profiles/import`, `POST /v1/profiles/:id/install`, `GET /v1/profiles/install-runs/:run_id` in `apps/control-plane/src/profile-routes.ts`.
3. Profile API validation: strict input validation (UUID format, bounds checks, enum enforcement, `MAX_PROFILE_PACKAGES=200`) and error taxonomy matching existing API style in `apps/control-plane/src/http-app.ts`.
4. Profile Postgres adapters: `apps/control-plane/src/profile-postgres-adapters.ts` with install-run persistence, run-plan linkage, and status progression.
5. Profile install-run orchestration: `profile_install_run_plans` linkage for each created install plan, per-plan status advancement (`planned -> applied -> verified` or `failed/skipped`), aggregate counts derived from persisted per-plan outcomes.
6. Profile install execution modes: `plan_only` (default) and `apply_verify` modes with deterministic idempotency and persisted attempt linkage.
7. Additive migration `012_profile_bundle_foundations.sql`: introduces `profiles`, `profile_packages`, `profile_install_runs`, `profile_install_run_plans`, and `profile_audit` tables.
8. Integration-db profile bundle coverage: `tests/integration-db/profile-bundle.integration-db.test.ts` with 5 tests covering create, export/import round-trip, install lifecycle wiring, optional package skipping, and filtering.
9. Wave 8 migration contract test: `tests/contract/migration-wave8.contract.test.ts` validating migration 012 structure.
10. Security event family expansion: deterministic outbox dispatcher now supports `security.report.accepted` event type.

## 2) Exact files created/updated

Created:
1. `apps/control-plane/src/profile-postgres-adapters.ts`
2. `apps/control-plane/src/profile-routes.ts`
3. `infra/postgres/migrations/012_profile_bundle_foundations.sql`
4. `packages/shared-contracts/src/profiles.ts`
5. `tests/contract/migration-wave8.contract.test.ts`
6. `tests/integration-db/profile-bundle.integration-db.test.ts`

Updated:
1. `apps/control-plane/src/http-app.ts` (profile route wiring + error mapping)
2. `packages/shared-contracts/src/index.ts` (profile type exports)
3. `packages/security-governance/src/outbox-dispatcher.ts` (security.report.accepted support)
4. `tests/integration-db/helpers/postgres.ts` (profile table resets)

## 3) Migration list with lock-risk and rollback notes

1. `012_profile_bundle_foundations.sql`
   - Lock risk: catalog locks only for additive table/index creation; no table rewrites.
   - Rollback strategy: forward compensation preferred; if emergency rollback is required, stop profile API handlers first, archive rows, then drop new relations.

## 4) Commands executed with pass/fail results

1. `npm run typecheck` -> PASS
2. `npm run test` -> PASS
3. `npm run check` -> PASS
4. `npm run verify:migrations:dr018` -> PASS
5. `npm run test:e2e-local` -> PASS
6. `npm run test:integration-db:docker` -> PASS

## 5) Deferred items with explicit rationale

1. No formal Wave 8 execution plan was published — foundations were built incrementally and scoped post-hoc.
2. SLO rollup for profile install run success rate was deferred to Wave 9.
3. Event ownership matrix and `metrics.aggregate.requested` disposition codification deferred to Wave 9.
4. Profile lifecycle runbook deferred to Wave 9.

## 6) Explicit governance statement

No AQ/MQ/DR status was silently changed from Open/Proposed to Approved during Wave 8 work.

## 7) Updated discover/plan/install/verify coverage matrix

1. Discover: no changes (catalog search and ranking lineage from Wave 7).
2. Plan: profile-based multi-package install planning with per-package plan creation and run-plan linkage.
3. Install/Apply: `plan_only` and `apply_verify` execution modes with per-plan status progression and aggregate run outcome tracking.
4. Verify: install verification integrated into profile `apply_verify` mode with per-plan verify attempt linkage.

## 8) Operational readiness notes

Production-ready now:
1. Profile CRUD operations (create, list, get, export, import).
2. Profile install orchestration with `plan_only` default mode.
3. Profile install with `apply_verify` mode (full lifecycle per package).

Still gated:
1. Profile operations require a configured DB with migration 012 applied.

## 9) Environment requirement matrix

| Command / Service | Required env | Optional env |
| --- | --- | --- |
| Profile API endpoints | `FORGE_DATABASE_URL` or `DATABASE_URL` | `FORGE_HOST`, `FORGE_PORT` |
