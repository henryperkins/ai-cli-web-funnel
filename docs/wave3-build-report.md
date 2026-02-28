**Implemented**
1. **Steps 1-3 (DB adapters + HTTP handlers)**
- Added Postgres-backed adapters for control-plane idempotency/raw-event/fraud/outbox.
- Added Postgres-backed adapters for security-governance reporter directory/nonce/report persistence/enforcement projection/outbox.
- Added HTTP handlers for `/v1/events` and `/v1/security/reports`.
- Kept replay semantics strict: same key+hash replays stored body, same key+different hash conflicts.

2. **Step 4 (deterministic async boundary)**
- Added outbox publisher hooks on accepted ingestion/report flows only.
- Added dedupe-key-based no-duplicate semantics.
- Added tests for replay-safe behavior and partial failure reruns.

3. **Step 5 (migration expansion)**
- Added migration `007_async_boundaries_and_projection_snapshots.sql` with:
  - `ingestion_idempotency_records`
  - `ingestion_outbox`
  - `security_enforcement_projections`
- Added contract test coverage for migration wave 3 table/lock-risk presence.

4. **Steps 6-8 (runtime daemon reliability)**
- Added local stdio supervisor hooks with bounded restart/backoff + runtime event emission.
- Added remote `sse` / `streamable-http` connector implementations with `api-key`/`bearer`/`oauth2_client_credentials` secret_ref-based auth.
- Added scope sidecar ownership metadata read/write with overwrite protection for non-daemon-owned entries.

5. **Steps 9-10 (DR-012 retrieval + ranking metadata)**
- Added hybrid retrieval module (BM25 + semantic parallel execution).
- Added deterministic fusion formula `0.6 * bm25 + 0.4 * semantic`.
- Added strict config validation and fail-closed dimension mismatch checks.
- Added semantic failure fallback marker and extended ranking lineage metadata (`embedding_model_version`, `vector_collection_version`, `semantic_fallback`).

6. **Step 11 (operational jobs)**
- Added mode-aware jobs (`dry-run`, `shadow`, `production`) for:
  - reporter score recompute
  - enforcement expiry reconciliation
  - outbox processor
- Added tests for missed run/duplicate run/partial failure rerun behavior.

7. **Step 12 (runbooks + decision log)**
- Updated existing runbooks to reflect implemented behavior.
- Added new runbooks for migration rollback, cron replay-safe recovery, and semantic fallback.
- Added decision log entries DLOG-0012..DLOG-0015.

**Files Created**
- [apps/control-plane/src/http-handler.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/http-handler.ts)
- [apps/control-plane/src/postgres-adapters.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/postgres-adapters.ts)
- [apps/control-plane/tests/http-handler.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/http-handler.test.ts)
- [apps/control-plane/tests/postgres-adapters.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/postgres-adapters.test.ts)
- [apps/runtime-daemon/src/local-supervisor.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/local-supervisor.ts)
- [apps/runtime-daemon/src/remote-connectors.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/remote-connectors.ts)
- [apps/runtime-daemon/src/scope-sidecar.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/scope-sidecar.ts)
- [apps/runtime-daemon/tests/local-supervisor.test.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/tests/local-supervisor.test.ts)
- [apps/runtime-daemon/tests/remote-connectors.test.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/tests/remote-connectors.test.ts)
- [apps/runtime-daemon/tests/scope-sidecar.test.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/tests/scope-sidecar.test.ts)
- [infra/postgres/migrations/007_async_boundaries_and_projection_snapshots.sql](/home/azureuser/ai-cli-web-funnel/infra/postgres/migrations/007_async_boundaries_and_projection_snapshots.sql)
- [packages/ranking/src/hybrid-retrieval.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/src/hybrid-retrieval.ts)
- [packages/ranking/tests/hybrid-retrieval.test.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/tests/hybrid-retrieval.test.ts)
- [packages/security-governance/src/http-handler.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/http-handler.ts)
- [packages/security-governance/src/jobs.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/jobs.ts)
- [packages/security-governance/src/postgres-adapters.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/postgres-adapters.ts)
- [packages/security-governance/tests/http-handler.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/http-handler.test.ts)
- [packages/security-governance/tests/jobs.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/jobs.test.ts)
- [packages/security-governance/tests/postgres-adapters.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/postgres-adapters.test.ts)
- [docs/runbooks/cron-failure-triage-and-replay-recovery.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/cron-failure-triage-and-replay-recovery.md)
- [docs/runbooks/migration-rollout-and-rollback.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/migration-rollout-and-rollback.md)
- [docs/runbooks/semantic-retrieval-incident-fallback.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/semantic-retrieval-incident-fallback.md)
- [tests/contract/migration-wave3.contract.test.ts](/home/azureuser/ai-cli-web-funnel/tests/contract/migration-wave3.contract.test.ts)
- [tests/integration/event-ingestion-db-adapters.integration.test.ts](/home/azureuser/ai-cli-web-funnel/tests/integration/event-ingestion-db-adapters.integration.test.ts)
- [tests/integration/security-governance-db-adapters.integration.test.ts](/home/azureuser/ai-cli-web-funnel/tests/integration/security-governance-db-adapters.integration.test.ts)

**Files Updated**
- [apps/control-plane/package.json](/home/azureuser/ai-cli-web-funnel/apps/control-plane/package.json)
- [apps/control-plane/src/index.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/index.ts)
- [apps/control-plane/tests/ingestion.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/ingestion.test.ts)
- [apps/runtime-daemon/package.json](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/package.json)
- [packages/ranking/src/index.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/src/index.ts)
- [packages/ranking/tests/ranking.test.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/tests/ranking.test.ts)
- [packages/security-governance/package.json](/home/azureuser/ai-cli-web-funnel/packages/security-governance/package.json)
- [packages/security-governance/src/index.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/index.ts)
- [packages/security-governance/tests/signed-reporter-ingestion.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/signed-reporter-ingestion.test.ts)
- [packages/shared-contracts/src/feature-flags.ts](/home/azureuser/ai-cli-web-funnel/packages/shared-contracts/src/feature-flags.ts)
- [scripts/verify-dr018-migration.mjs](/home/azureuser/ai-cli-web-funnel/scripts/verify-dr018-migration.mjs)
- [tests/contract/migration-dr018.contract.test.ts](/home/azureuser/ai-cli-web-funnel/tests/contract/migration-dr018.contract.test.ts)
- [docs/runbooks/README.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/README.md)
- [docs/runbooks/event-ingestion-fraud-baseline.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/event-ingestion-fraud-baseline.md)
- [docs/runbooks/runtime-preflight-and-adapter-contracts.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/runtime-preflight-and-adapter-contracts.md)
- [DECISION_LOG.md](/home/azureuser/ai-cli-web-funnel/DECISION_LOG.md)

**Migrations and Lock Risk**
1. Added [007_async_boundaries_and_projection_snapshots.sql](/home/azureuser/ai-cli-web-funnel/infra/postgres/migrations/007_async_boundaries_and_projection_snapshots.sql).
2. Lock risk documented in-header:
- `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` only (brief catalog/DDL locks).
- No destructive rewrite path.
3. Rollback posture documented as forward-compensation only (no destructive down migration).
4. DR-018 verification still passes via `npm run verify:migrations:dr018`.

**Validation Run**
1. `npm run check` passed.
2. `npm run verify:migrations:dr018` passed.
3. Integration/contract suite now includes DB-adapter integration and wave3 migration contract test; all passing.

**Deferred / Intentional Gaps**
1. OAuth2 client credentials path currently treats resolved `secret_ref` as bearer token input and does not perform token endpoint exchange.
2. Hybrid retrieval config validation is implemented as explicit startup validator function; wiring it into a concrete process bootstrap entrypoint is deferred because this repo has no dedicated retrieval service bootstrap module yet.
3. Local supervisor and remote connectors are implemented as hook modules; wiring policy/feature-flag controlled runtime composition into a single daemon bootstrap factory is deferred to next orchestration slice.

**Governance Note**
No AQ/MQ/DR status values were silently changed in tracker/decision docs during this implementation.

**Discover/Plan/Apply/Verify Map**
1. `discover`: added DB handlers/adapters and retrieval/runtime modules to advance event/report intake and runtime health paths.
2. `plan`: enforced idempotency conflict/replay and outbox dedupe semantics for deterministic install/security planning inputs.
3. `apply`: implemented persistence + outbox + supervision/connectors + sidecar writes + migration additions.
4. `verify`: added/updated unit, integration, and contract tests; full `check` and migration verification pass.

<oai-mem-citation>
<citation_entries>
MEMORY.md:282-283|note=[used prior ai-cli-web-funnel qdrant-readiness context to align implementation wave]
MEMORY.md:291-291|note=[used referenced rollout id for related governance context]
</citation_entries>
<rollout_ids>
019c9b2c-1bee-7391-9c0a-f47ccca4d019
</rollout_ids>
</oai-mem-citation>
