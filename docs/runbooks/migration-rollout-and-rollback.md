# Migration Rollout and Rollback Runbook

## Scope
Operational checklist for applying forward-only schema migrations, including async-boundary tables, reporter freshness guards, and install lifecycle persistence.

## Migrations in scope
1. `infra/postgres/migrations/005_registry_packages_cutover.sql`
2. `infra/postgres/migrations/006_security_reporter_runtime.sql`
3. `infra/postgres/migrations/007_async_boundaries_and_projection_snapshots.sql`
4. `infra/postgres/migrations/008_security_reporter_metrics_freshness_guard.sql`
5. `infra/postgres/migrations/009_install_lifecycle_foundations.sql`
6. `infra/postgres/migrations/015_security_appeals_and_trust_gates.sql`

## Preflight
1. Run contract verification:
   - `npm run verify:migrations:dr018`
2. Run full CI-equivalent checks:
   - `npm run check`
3. Confirm DB backup/PITR checkpoint exists before applying any migration.

## Rollout steps
1. Apply migrations in numeric order (`005 -> 006 -> 007 -> 008 -> 009 -> 015`).
2. After apply, verify required relations:
   - `registry.packages`
   - `public.registry_packages` (compatibility view)
   - `security_reports`
   - `security_enforcement_actions`
   - `security_enforcement_projections`
   - `security_enforcement_rollout_state`
   - `security_enforcement_promotion_decisions`
   - `security_appeals` (priority/reviewer fields populated)
   - `ingestion_idempotency_records`
   - `ingestion_outbox`
   - `install_plans`
   - `install_plan_actions`
   - `install_plan_audit`
   - `install_apply_attempts`
   - `install_verify_attempts`
3. Run smoke verification:
   - replay semantics for `/v1/events` idempotency
   - signed reporter ingestion accept/reject path
   - outbox dedupe on duplicate dispatch requests
   - lifecycle idempotency replay/conflict paths (`plan`/`apply`/`verify`)

## Lock-risk notes
1. Migration `005` includes `ALTER TABLE ... SET SCHEMA` and rename operations (short ACCESS EXCLUSIVE lock expected).
2. Migration `007` only adds tables/indexes (`CREATE TABLE/INDEX IF NOT EXISTS`) with brief catalog locks.
3. Migration `008` is function/table additive and metadata-level (no table rewrite expected).
4. Migration `009` is additive table/index creation only (`CREATE TABLE/INDEX IF NOT EXISTS`) with brief catalog locks and no table rewrites.
5. Migration `015` is additive enum/table/function/index DDL plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` metadata locks on `security_appeals`.

## Rollback playbook (forward compensation only)
1. Do not run destructive down migrations.
2. If a migration introduces runtime issues:
   - pause writers to affected paths;
   - create compensating migration to isolate problematic behavior (for example, redirect readers back to compatibility views, or disable new write path behind feature gate);
   - backfill/repair data into compensating structures;
   - resume traffic incrementally.
3. Keep `public.registry_packages` compatibility view in place until explicit DR-018 approval allows removal.
4. For lifecycle rollback incidents, stop lifecycle writers first, archive `install_*` tables, and deploy compensating migration rather than dropping in-place.
