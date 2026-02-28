# Profile Lifecycle Operations

## Scope
Operator runbook for profile lifecycle management: create, list, get, export, import, install, and install-run inspection.

Implemented in:
1. `apps/control-plane/src/http-app.ts` — HTTP route wiring
2. `packages/shared-contracts/src/index.ts` — profile types and validation
3. `infra/postgres/migrations/` — profile tables (`profiles`, `profile_install_runs`, `profile_install_run_plans`, `profile_audit`)

## Overview
A profile encodes a curated set of addon packages with install ordering. The lifecycle is:

1. **Create** — register a new profile with a name, description, and ordered package list.
2. **List** — enumerate all profiles.
3. **Get** — retrieve a single profile by ID.
4. **Export** — serialize a profile to a portable JSON format.
5. **Import** — hydrate a profile from a previously exported payload.
6. **Install** — execute the profile's package list in order (`plan_only` or `apply_verify` mode).
7. **Get install run** — inspect the status and per-plan results of an install run.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/profiles` | Create a new profile |
| GET | `/v1/profiles` | List all profiles |
| GET | `/v1/profiles/:id` | Get a single profile by ID |
| GET\|POST | `/v1/profiles/:id/export` | Export profile as portable JSON (GET preferred; POST supported for compatibility) |
| POST | `/v1/profiles/import` | Import a profile from exported JSON |
| POST | `/v1/profiles/:id/install` | Install a profile (plan_only or apply_verify) |
| GET | `/v1/profiles/install-runs/:run_id` | Get install run status and per-plan results |

## Common operations

1. Create a profile:
   ```bash
   curl -s -X POST http://localhost:3000/v1/profiles \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "my-dev-profile",
       "description": "Development MCP servers",
       "packages": [
         { "package_id": "pkg-uuid-1", "install_order": 1 },
         { "package_id": "pkg-uuid-2", "install_order": 2 }
       ]
     }' | jq .
   ```

2. List all profiles:
   ```bash
   curl -s http://localhost:3000/v1/profiles | jq .
   ```

3. Get a single profile:
   ```bash
   curl -s http://localhost:3000/v1/profiles/<profile_id> | jq .
   ```

4. Export a profile (GET preferred; POST also supported for compatibility):
   ```bash
   curl -s http://localhost:3000/v1/profiles/<profile_id>/export | jq . > profile-export.json
   ```

5. Import a profile:
   ```bash
   curl -s -X POST http://localhost:3000/v1/profiles/import \
     -H 'Content-Type: application/json' \
     -d @profile-export.json | jq .
   ```

6. Install a profile (plan_only mode):
   ```bash
   curl -s -X POST http://localhost:3000/v1/profiles/<profile_id>/install \
     -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: <unique-key>' \
     -d '{ "mode": "plan_only" }' | jq .
   ```

7. Install a profile (apply_verify mode):
   ```bash
   curl -s -X POST http://localhost:3000/v1/profiles/<profile_id>/install \
     -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: <unique-key>' \
     -d '{ "mode": "apply_verify" }' | jq .
   ```

8. Get install run status:
   ```bash
   curl -s http://localhost:3000/v1/profiles/install-runs/<run_id> | jq .
   ```

## Symptom → cause → fix

| Symptom | Cause | Fix |
|---------|-------|-----|
| 400 on create | Missing required field or duplicate `install_order` in packages array | Check payload: ensure `name`, `packages` are present and each `install_order` is unique |
| 404 on get | Profile not found | Verify the `profile_id` exists via the list endpoint |
| 409 on install | Idempotency conflict — same key, different request hash | Use a new `Idempotency-Key` value for each distinct install request |
| Install run shows `partially_failed` | Some packages failed during `apply_verify` | Check per-plan statuses via the install-run endpoint (`GET /v1/profiles/install-runs/:run_id`) |

## Database inspection queries

1. List recent install runs:
   ```sql
   SELECT run_id, profile_id, mode, status, created_at, completed_at
   FROM profile_install_runs
   ORDER BY created_at DESC
   LIMIT 20;
   ```

2. Inspect per-plan results for a run:
   ```sql
   SELECT run_id, plan_id, package_id, install_order, status, error_message
   FROM profile_install_run_plans
   WHERE run_id = '<run_id>'
   ORDER BY install_order;
   ```

3. Review profile audit trail:
   ```sql
   SELECT profile_id, action, actor, details, created_at
   FROM profile_audit
   ORDER BY created_at DESC
   LIMIT 50;
   ```

## Validation checks
1. `npm run test:workspaces`
2. `npm run test:integration-contract`
