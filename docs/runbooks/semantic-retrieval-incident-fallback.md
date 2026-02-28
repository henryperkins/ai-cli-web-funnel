# Semantic Retrieval Incident Fallback Runbook

## Scope
Operational fallback for DR-012 hybrid retrieval (`BM25 + semantic`) plus Wave 7 retrieval-sync freshness operations:
1. `packages/ranking/src/postgres-bm25-retriever.ts`
2. `packages/ranking/src/qdrant-semantic-retriever.ts`
3. `packages/ranking/src/embedding-provider.ts`
4. `packages/ranking/src/retrieval-sync.ts`
5. `apps/control-plane/src/retrieval-bootstrap.ts`
6. `scripts/run-retrieval-sync.mjs`
7. `scripts/run-outbox-processor.mjs`

## Required configuration
1. `QDRANT_URL`
2. `QDRANT_API_KEY`
3. `QDRANT_COLLECTION`
4. `EMBEDDING_MODEL`
5. `EMBEDDING_DIMENSIONS`
6. `EMBEDDING_API_KEY` or `OPENAI_API_KEY`
7. Optional: `EMBEDDING_API_BASE_URL`
8. Optional outbox ranking sync bound: `OUTBOX_RANKING_SYNC_LIMIT`

Startup fails closed when:
1. required retrieval env vars are missing while `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true`;
2. `EMBEDDING_DIMENSIONS` is invalid or mismatched with Qdrant vector size.

## Normal behavior
1. Bootstrap validates config with Qdrant vector-size inspection.
2. BM25 and semantic retrieval run in parallel.
3. Fusion contract is deterministic: `fused_score = 0.6 * bm25_score + 0.4 * semantic_score`.
4. Tie-break is deterministic (`id` ascending).
5. Retrieval sync skips unchanged documents using `retrieval_sync_documents.payload_sha256`.

## Fallback behavior
1. If semantic retrieval fails/timeouts, response returns BM25-only.
2. `semantic_fallback=true` is set in search response + ranking lineage.
3. Service remains available for discover/search even during semantic outages.
4. Retrieval sync failures are surfaced as explicit operator failures (no silent skip) in:
   - `retrieval_sync.run_failed`
   - `outbox.ranking_sync.failed`

## Startup and triage commands
1. Start control-plane with required retrieval bootstrap:
   - `FORGE_REQUIRE_RETRIEVAL_BOOTSTRAP=true npm run run:control-plane`
2. Validate readiness:
   - `curl -sS http://127.0.0.1:8787/ready | jq .`
3. Preview retrieval sync without writes:
   - `npm run run:retrieval-sync -- --mode dry-run --limit 25`
4. Apply retrieval sync:
   - `npm run run:retrieval-sync -- --mode apply --limit 100`
5. Run retrieval package tests:
   - `npm run --workspace @forge/ranking test`
6. Run control-plane retrieval wiring tests:
   - `npm run --workspace @forge/control-plane test -- --run tests/retrieval-bootstrap.test.ts`

## Symptom -> cause -> fix
1. `retrieval_bootstrap_failed:retrieval_config_invalid:*`
   - Cause: missing/malformed retrieval env values.
   - Fix: set required env vars and restart control-plane.
2. `retrieval_bootstrap_failed:*does not match qdrant collection vector size*`
   - Cause: `EMBEDDING_DIMENSIONS` mismatches collection vector size.
   - Fix: align `EMBEDDING_DIMENSIONS` with Qdrant collection schema.
3. `retrieval_sync_config_invalid:*`
   - Cause: retrieval sync apply path missing Qdrant or embedding env.
   - Fix: set required env vars, rerun `run:retrieval-sync` in dry-run then apply mode.
4. search response has `semantic_fallback=true` with no startup failure
   - Cause: runtime semantic query/embedding outage while BM25 is healthy.
   - Fix: keep service in fallback mode, restore semantic dependency, confirm `semantic_fallback=false` after recovery.
5. `outbox.ranking_sync.failed`
   - Cause: ranking sync outbox handler failed during semantic sync execution.
   - Fix: inspect `failure_class` + `error_message`, correct dependency/config issue, then rerun outbox and/or dead-letter requeue flow.
