# Copilot Instructions — Forge Monorepo

## Build, Test, and Lint

```bash
npm install
npm run typecheck          # TypeScript type checking across all workspaces
npm run test               # Build + workspace tests + integration/contract tests
npm run check              # typecheck + test combined

# Individual test tiers
npm run test:workspaces                    # Unit tests in apps/*/tests and packages/*/tests
npm run test:unit                          # Root-level unit tests (vitest run)
npm run test:integration-contract          # Contract + integration tests (no real DB)
npm run test:integration-db:docker         # Real Postgres via ephemeral Docker container
npm run test:e2e-local                     # End-to-end: discover → plan → install → verify

# Run a single test file
npx vitest run path/to/file.test.ts

# Run a single integration-db test (serial execution required)
npx vitest run tests/integration-db/some.test.ts --maxWorkers=1

# Migration verification
npm run verify:migrations:dr018
```

## Architecture

Forge is a CLI addon manager (MCP servers, skills, plugins) with a **Discover → Plan → Install → Verify** lifecycle. It's an npm workspaces monorepo with three apps and five packages.

### Apps

- **`apps/control-plane`** — Main HTTP API server. Composition root that wires all packages together via `createForgeHttpAppFromPostgres()` in `http-app.ts`. Raw `node:http` routing (no framework). Entry point: `src/server-main.ts`.
- **`apps/runtime-daemon`** — Runtime lifecycle pipeline for starting/connecting MCP servers. Pipeline stages: `policy_preflight → trust_gate → preflight_checks → start_or_connect → remote_connect → health_validate → supervise`.
- **`apps/copilot-vscode-adapter`** — Filesystem-backed VS Code adapter. Atomic writes (temp → fsync → rename) with `.bak` rollback. Ordered scope resolution: `workspace > user_profile > daemon_default`.

### Packages

- **`packages/shared-contracts`** — Pure types and deterministic logic. No I/O. The integration backbone used by all other packages. Contains identity (UUIDv5), event types, feature flags, merge precedence, trust/fraud types, and privacy enforcement.
- **`packages/catalog`** — Catalog ingest: multi-source merge into canonical package records. Pure domain + separate postgres adapters.
- **`packages/policy-engine`** — Single pure function: `evaluatePolicyPreflight(input, gates)`.
- **`packages/ranking`** — BM25 + Qdrant hybrid retrieval with deterministic scoring formula and ranking lineage metadata.
- **`packages/security-governance`** — Security report ingestion, enforcement projection, outbox processing, dead-letter requeue, reporter trust scoring.

### Dependency Flow

```
shared-contracts  (no deps, pure types)
    ↑
    ├── policy-engine
    ├── catalog
    ├── ranking
    ├── security-governance
    └── control-plane (composition root — wires everything)
```

## Key Conventions

### Hexagonal Architecture (Ports & Adapters)

Domain logic is pure (no I/O) and lives in each package's `src/index.ts`. Postgres adapters are in separate `postgres-adapters.ts` files. Services are created via **factory functions** returning object literals — no classes for services. The single exception is `CopilotFilesystemAdapterError`.

```typescript
// Pattern: factory function with injected dependencies
const service = createCatalogIngestService();
const adapter = createPostgresIdempotencyAdapter({ db });
```

### Database Access

Raw SQL with parameterized queries — no ORM. All adapters accept a `PostgresQueryExecutor` interface:

```typescript
interface PostgresQueryExecutor {
  query<Row>(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}
```

Transaction support via `PostgresTransactionalQueryExecutor` with `withTransaction()` using `BEGIN/COMMIT/ROLLBACK`.

### Idempotency

All write paths use `dedupe_key` + `request_hash`:
- Same key + same hash → **replayed** (return previous result)
- Same key + different hash → **conflict** (409)
- New key → **accepted**

Database uses `ON CONFLICT` patterns extensively for idempotency.

### Error Handling

- **Result types** for validation: `{ ok: true, value } | { ok: false, issues }`
- **Prefixed error strings**: `'idempotency_conflict:'`, `'plan_not_found:'`, `'catalog_ingest_invalid:'`
- HTTP error mapping in `http-app.ts` matches on `error.message.includes('prefix')` to select status codes

### Privacy by Design

SQL CHECK constraints enforce no PII in payloads (`ip`, `fingerprint`, `raw_user_agent`, `install_command`). Validation layer scans payloads recursively. Only `secret_ref` is persisted, never plaintext secrets.

### Outbox Pattern

Transactional outbox via `ingestion_outbox` table. Processor modes: `dry-run`, `shadow`, `production`. Dead-letter replay via `scripts/run-outbox-dead-letter-replay.mjs`.

### Migrations

Forward-only additive SQL migrations in `infra/postgres/migrations/`. Each migration has a comment header documenting purpose, lock-risk analysis, and rollback playbook. Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency. Verified by DR-018 guard script.

### TypeScript

- ESM-only (`"type": "module"`, NodeNext module resolution)
- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- `snake_case` for DB columns and API payloads, `camelCase` for TypeScript domain code
- Barrel exports via `src/index.ts` in every package
- Multi-entrypoint packages via `exports` in `package.json` (e.g., `@forge/catalog/postgres-adapters`)

### Testing

Vitest 3.x with globals. Tests use in-memory adapters (Maps/arrays) injected via the same factory functions used in production — no mocking libraries. Security-governance exports dedicated in-memory adapters (`InMemoryReporterDirectory`, etc.).

### Feature Flags

Type-safe nested `ForgeFeatureFlags` with categories: `product`, `ingest`, `data`, `fraud`, `security`, `runtime`. All default to `false`/safe values. Resolved via `resolveFeatureFlags(overrides)` deep merge.

### Governance

DR/AQ/MQ statuses must remain `Proposed`/`Open` unless explicitly approved — no silent status promotions.
