**1) What Was Implemented Per Step Number**
1. Step 1: Added runtime composition/bootstrap with feature-flag gating for local supervisor, remote SSE/streamable-http, and scope sidecar guard; preserved deterministic disabled reason paths.
2. Step 2: Replaced `oauth2_client_credentials` bearer passthrough with token endpoint exchange + in-memory expiry-aware token cache; kept `api-key` and `bearer` behavior unchanged.
3. Step 3: Added concrete retrieval bootstrap/service that validates Qdrant vector size at startup and fail-closes on mismatch before search is available.
4. Step 4: Added concrete Postgres outbox job store (`claimPending`, `markCompleted`, `markFailed`, `isProcessed`, `markProcessed`) and production runner script with `dry-run`/`shadow`/`production`.
5. Step 5: Added migration `008` freshness guard for reporter metrics readiness and updated readiness adapter behavior to support stale/fresh windows.
6. Step 6: Added runnable HTTP app composition wiring for `POST /v1/events`, `POST /v1/security/reports`, plus health/readiness routes and Node listener adapter.
7. Step 7: Added real Postgres integration suite (`tests/integration-db`) and dockerized execution path.
8. Step 8: Added structured logging hooks for retrieval startup validation failures, OAuth token exchange failures, and outbox claim/dispatch failure classes; added no-secret assertions.
9. Step 9: Updated runbooks + decision log to document new runtime/bootstrap/retrieval/outbox/integration-db operations.

**2) Exact Files Created/Updated**
- Created: [apps/runtime-daemon/src/oauth-token-client.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/oauth-token-client.ts)
- Created: [apps/runtime-daemon/src/runtime-bootstrap.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/runtime-bootstrap.ts)
- Updated: [apps/runtime-daemon/src/remote-connectors.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/remote-connectors.ts)
- Updated: [apps/runtime-daemon/src/index.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/src/index.ts)
- Updated: [apps/runtime-daemon/package.json](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/package.json)
- Created: [apps/runtime-daemon/tests/oauth-token-client.test.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/tests/oauth-token-client.test.ts)
- Created: [apps/runtime-daemon/tests/runtime-bootstrap.test.ts](/home/azureuser/ai-cli-web-funnel/apps/runtime-daemon/tests/runtime-bootstrap.test.ts)
- Created: [packages/ranking/src/retrieval-service.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/src/retrieval-service.ts)
- Updated: [packages/ranking/src/index.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/src/index.ts)
- Created: [packages/ranking/tests/retrieval-service.test.ts](/home/azureuser/ai-cli-web-funnel/packages/ranking/tests/retrieval-service.test.ts)
- Created: [packages/security-governance/src/postgres-job-store.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/postgres-job-store.ts)
- Created: [packages/security-governance/src/postgres-reporter-score-adapters.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/postgres-reporter-score-adapters.ts)
- Updated: [packages/security-governance/src/jobs.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/jobs.ts)
- Updated: [packages/security-governance/src/index.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/src/index.ts)
- Updated: [packages/security-governance/package.json](/home/azureuser/ai-cli-web-funnel/packages/security-governance/package.json)
- Created: [packages/security-governance/tests/postgres-job-store.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/postgres-job-store.test.ts)
- Created: [packages/security-governance/tests/postgres-reporter-score-adapters.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/postgres-reporter-score-adapters.test.ts)
- Updated: [packages/security-governance/tests/jobs.test.ts](/home/azureuser/ai-cli-web-funnel/packages/security-governance/tests/jobs.test.ts)
- Created: [apps/control-plane/src/http-app.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/http-app.ts)
- Updated: [apps/control-plane/src/index.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/src/index.ts)
- Updated: [apps/control-plane/package.json](/home/azureuser/ai-cli-web-funnel/apps/control-plane/package.json)
- Created: [apps/control-plane/tests/http-app.test.ts](/home/azureuser/ai-cli-web-funnel/apps/control-plane/tests/http-app.test.ts)
- Created: [infra/postgres/migrations/008_security_reporter_metrics_freshness_guard.sql](/home/azureuser/ai-cli-web-funnel/infra/postgres/migrations/008_security_reporter_metrics_freshness_guard.sql)
- Created: [scripts/run-outbox-processor.mjs](/home/azureuser/ai-cli-web-funnel/scripts/run-outbox-processor.mjs)
- Created: [scripts/run-integration-db-docker.mjs](/home/azureuser/ai-cli-web-funnel/scripts/run-integration-db-docker.mjs)
- Created: [tests/integration-db/helpers/postgres.ts](/home/azureuser/ai-cli-web-funnel/tests/integration-db/helpers/postgres.ts)
- Created: [tests/integration-db/postgres-adapters.integration-db.test.ts](/home/azureuser/ai-cli-web-funnel/tests/integration-db/postgres-adapters.integration-db.test.ts)
- Created: [tests/integration-db/README.md](/home/azureuser/ai-cli-web-funnel/tests/integration-db/README.md)
- Updated: [tests/integration/README.md](/home/azureuser/ai-cli-web-funnel/tests/integration/README.md)
- Updated: [README.md](/home/azureuser/ai-cli-web-funnel/README.md)
- Updated: [docs/runbooks/runtime-preflight-and-adapter-contracts.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/runtime-preflight-and-adapter-contracts.md)
- Updated: [docs/runbooks/semantic-retrieval-incident-fallback.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/semantic-retrieval-incident-fallback.md)
- Updated: [docs/runbooks/cron-failure-triage-and-replay-recovery.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/cron-failure-triage-and-replay-recovery.md)
- Updated: [docs/runbooks/README.md](/home/azureuser/ai-cli-web-funnel/docs/runbooks/README.md)
- Updated: [DECISION_LOG.md](/home/azureuser/ai-cli-web-funnel/DECISION_LOG.md)
- Updated: [package.json](/home/azureuser/ai-cli-web-funnel/package.json)
- Updated: [package-lock.json](/home/azureuser/ai-cli-web-funnel/package-lock.json)

**3) Migration List With Lock-Risk and Rollback Notes**
1. [008_security_reporter_metrics_freshness_guard.sql](/home/azureuser/ai-cli-web-funnel/infra/postgres/migrations/008_security_reporter_metrics_freshness_guard.sql)
2. Lock risk: `CREATE TABLE IF NOT EXISTS` brief catalog lock; `CREATE OR REPLACE FUNCTION` metadata-level update (no table rewrite).
3. Rollback notes: prefer forward compensating migration; if emergency rollback is needed, pause recompute jobs before altering freshness guard functions.

**4) Test Commands Executed With Pass/Fail Summary**
1. `npm run --workspace @forge/runtime-daemon typecheck && npm run --workspace @forge/runtime-daemon test` -> Pass.
2. `npm run --workspace @forge/ranking typecheck && npm run --workspace @forge/ranking test` -> Pass.
3. `npm run --workspace @forge/control-plane typecheck && npm run --workspace @forge/control-plane test` -> Pass.
4. `npm run --workspace @forge/security-governance typecheck && npm run --workspace @forge/security-governance test` -> Pass.
5. `npm run typecheck && npm run test && npm run verify:migrations:dr018` -> Pass.
6. `npm run check && npm run verify:migrations:dr018` -> Pass.
7. `npm run test:integration-db:docker` -> Pass (migrations `001..008` applied and `tests/integration-db` passed).

**5) Deferred Items With Rationale**
1. None. All Wave 4 steps from the provided prompt were implemented and validated.

**6) DR/AQ/MQ Status Confirmation**
1. Confirmed: no DR/AQ/MQ status fields were silently changed to `Approved`; governance statuses were left unchanged.

**7) discover/plan/apply/verify Coverage Map**
1. discover: audited existing runtime, ranking, security-governance, migration, and test surfaces before edits.
2. plan: executed Wave 4 steps in sequence via tracked implementation plan.
3. apply: implemented runtime bootstrap/auth, retrieval bootstrap, outbox store/runner, migration 008 guard, HTTP composition, integration-db suite, logging hooks, docs/governance updates.
4. verify: ran package-level and repo-level typecheck/tests, DR-018 migration verifier, and dockerized real-Postgres integration-db run.

<oai-mem-citation>
<citation_entries>
MEMORY.md:305-318|note=[used prior ai-cli-web-funnel qdrant/governance context to avoid conflicting status assumptions]
</citation_entries>
<rollout_ids>
019c9b2c-1bee-7391-9c0a-f47ccca4d019
</rollout_ids>
</oai-mem-citation>
