# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm install
npm run typecheck          # TypeScript check across all workspaces
npm run test               # Build + workspace tests + integration/contract tests
npm run check              # Governance check + typecheck + test combined
npm run verify:migrations:dr018   # Forward-only migration guard

# Individual test tiers
npm run test:workspaces                    # Unit tests (apps/*/tests, packages/*/tests)
npm run test:unit                          # Root-level unit tests
npm run test:integration-contract          # Contract + integration tests (no real DB)
npm run test:integration-db:docker         # Real Postgres via ephemeral Docker container
npm run test:e2e-local                     # End-to-end: discover → plan → install → verify

# Single test file
npx vitest run path/to/file.test.ts

# Integration-db tests require serial execution
npx vitest run tests/integration-db/some.test.ts --maxWorkers=1

# Operator scripts (all support --mode dry-run)
npm run run:catalog-ingest -- --mode dry-run --input catalog.json
npm run run:retrieval-sync -- --mode dry-run --limit 25
npm run run:outbox -- --mode dry-run --limit 25
npm run run:outbox-dead-letter -- --action list --limit 25
npm run run:slo-rollup -- --mode dry-run
npm run run:control-plane    # HTTP server (requires FORGE_DATABASE_URL)
```

## Architecture

Forge is a CLI addon manager (MCP servers, skills, plugins) with a **Discover → Plan → Install → Verify** lifecycle. npm workspaces monorepo.

### Apps

- **`apps/control-plane`** — Main HTTP API server and composition root. Raw `node:http` routing (no framework). Wires all packages via `createForgeHttpAppFromPostgres()`. Entry: `src/server-main.ts` → `src/server.ts` → `src/http-app.ts`.
- **`apps/runtime-daemon`** — Runtime lifecycle pipeline: `policy_preflight → trust_gate → preflight_checks → start_or_connect → remote_connect → health_validate → supervise`.
- **`apps/copilot-vscode-adapter`** — Filesystem-backed VS Code adapter. Atomic writes (temp → fsync → rename) with `.bak` rollback. Scope: `workspace > user_profile > daemon_default`.

### Packages

- **`packages/shared-contracts`** — Pure types, no I/O. Identity (UUIDv5), event types, feature flags, profiles, trust/fraud.
- **`packages/catalog`** — Multi-source catalog ingest merge logic. Pure domain + postgres adapters.
- **`packages/policy-engine`** — Single pure function: `evaluatePolicyPreflight(input, gates)`.
- **`packages/ranking`** — BM25 + Qdrant hybrid retrieval, deterministic scoring, retrieval sync/backfill.
- **`packages/security-governance`** — Security report ingestion, enforcement projection, outbox processing, SLO rollup, dead-letter requeue.

### Dependency Flow

```
shared-contracts  (no deps, pure types)
    ↑
    ├── policy-engine
    ├── catalog
    ├── ranking
    ├── security-governance
    └── control-plane (composition root)
```

## Key Conventions

**Hexagonal architecture**: Domain logic is pure (no I/O) in `src/index.ts`. Postgres adapters in separate `postgres-adapters.ts`. Services via factory functions returning object literals — no classes.

**Database access**: Raw parameterized SQL (no ORM). All adapters accept `PostgresQueryExecutor` interface. Transactions via `withTransaction()` using `BEGIN/COMMIT/ROLLBACK`.

**Idempotency everywhere**: All write paths use `dedupe_key` + `request_hash`. Same key + same hash → replay. Same key + different hash → 409 conflict. Database enforces via `ON CONFLICT`.

**Error handling**: Result types `{ ok: true, value } | { ok: false, issues }`. Prefixed error strings (`'plan_not_found:'`, etc.) matched via `error.message.includes()` in `http-app.ts` for HTTP status mapping.

**Privacy**: SQL CHECK constraints prevent raw PII. Only `secret_ref` persisted, never plaintext secrets. Validation layer scans payloads recursively.

**Outbox pattern**: Transactional outbox in `ingestion_outbox` table. Processor modes: `dry-run`/`shadow`/`production`. Supported event families: `lifecycle.*`, `ranking.sync.requested`, `security.report.accepted`, `security.enforcement.recompute.requested`.

**Migrations**: Forward-only additive SQL in `infra/postgres/migrations/` (001-013). Each has a comment header with purpose, lock-risk, and rollback notes. Use `IF NOT EXISTS` for idempotency. Verified by DR-018 guard.

**TypeScript**: ESM-only, NodeNext resolution, strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. `snake_case` for DB/API payloads, `camelCase` for TypeScript. Multi-entrypoint packages via `exports` in `package.json`.

**Testing**: Vitest 3.x with globals. In-memory adapters (Maps/arrays) injected via same factory functions — no mocking libraries. Security-governance exports dedicated in-memory adapters.

**Feature flags**: Type-safe nested `ForgeFeatureFlags` with categories (`product`, `ingest`, `data`, `fraud`, `security`, `runtime`). All default `false`. Resolved via `resolveFeatureFlags(overrides)`.

**Governance**: DR/AQ/MQ statuses remain `Proposed`/`Open` unless explicitly approved. No silent status promotions. Track in `DECISION_LOG.md`.

## Key File Locations

| Area | Files |
|------|-------|
| HTTP routing & error mapping | `apps/control-plane/src/http-app.ts` |
| Install lifecycle | `apps/control-plane/src/install-lifecycle.ts` |
| Profile routes & adapters | `apps/control-plane/src/profile-routes.ts`, `profile-postgres-adapters.ts` |
| Catalog routes | `apps/control-plane/src/catalog-routes.ts` |
| Event ingestion | `apps/control-plane/src/http-handler.ts` |
| Runtime config | `apps/control-plane/src/runtime-feature-flags.ts`, `runtime-remote-config.ts` |
| Retrieval bootstrap | `apps/control-plane/src/retrieval-bootstrap.ts` |
| SLO rollup | `packages/security-governance/src/slo-rollup.ts` |
| Outbox dispatcher | `packages/security-governance/src/outbox-dispatcher.ts` |
| Shared types & profiles | `packages/shared-contracts/src/profiles.ts`, `event-types.ts` |
| Operator scripts | `scripts/run-*.mjs` |
| Wave build reports | `docs/wave{3-7}-build-report.md` |
| Decision records | `application_decision_records.md`, `DECISION_LOG.md` |
| Runbooks | `docs/runbooks/` |
