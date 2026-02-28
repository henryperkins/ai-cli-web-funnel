# Forge Decision Log

This log captures implementation-time decisions taken while AQ/MQ items are still open.

## DLOG-0001 (2026-02-26)

- Scope: Step 0 monorepo scaffold and governance setup.
- Decision: Establish a TypeScript/npm workspace monorepo with placeholder service packages and one implemented shared-contracts package.
- Rationale: Enables incremental delivery and CI-style checks while architecture details continue to close.
- Related: AQ-050, MQ-035.

## DLOG-0002 (2026-02-26)

- Scope: Step 1 canonical identity implementation.
- Decision: Use UUIDv5 over canonical locator `<github_repo_id>:<subpath_or_root>:<tool_kind>:<primary_registry_name_or_none>` with a dedicated `FORGE_PACKAGE_NAMESPACE` constant in code.
- Rationale: Matches DR-003 deterministic identity contract and supports monorepos.
- Related: AQ-014, MQ-001, DR-003.

## DLOG-0003 (2026-02-26)

- Scope: Open-question safe defaults.
- Decision: Implement feature flags with conservative defaults (`false` for unresolved behavior that can increase risk or product scope).
- Rationale: Prevents silent hardcoding and preserves reversibility until approvals are finalized.
- Related: AQ-007, AQ-013, AQ-057, MQ-012, MQ-017, MQ-023, MQ-034.

## DLOG-0004 (2026-02-26)

- Scope: second-pass documentation reconciliation.
- Decision: implement registry mapping fallback, manual-review conflict payloads, and provisional-to-canonical promotion helpers in identity contracts.
- Rationale: closes DR-003 fallback/promotion gaps and removes silent identity failure modes.
- Related: AQ-014, MQ-001, MQ-002, DR-003.

## DLOG-0005 (2026-02-26)

- Scope: second-pass schema hardening.
- Decision: add fork lineage fields, identity conflict review SLA fields, and MQ-029 reporter-metrics guard functions.
- Rationale: align schema with redline lineage requirements and eliminate unguarded scoring dependency.
- Related: Redline §9, AQ-049, MQ-029, DR-003.

## DLOG-0006 (2026-02-27)

- Scope: Step 2 event schema and ingestion foundation.
- Decision: adopt event schema v1 shared contracts with explicit runtime event additions, privacy-safe validation helpers, and fail-closed ingestion normalization before persistence.
- Rationale: enables deterministic raw-event ingestion while preventing unresolved privacy/security behavior from being silently hardcoded.
- Related: DR-010, DR-011, AQ-050, MQ-035, MQ-038.

## DLOG-0007 (2026-02-27)

- Scope: Step 3 fraud/preflight/runtime contract scaffolding.
- Decision: implement projection-first policy preflight and flagged-vs-blocked behavior as typed contracts, with strict-mode flagged blocking gated off by default.
- Rationale: preserves conservative AQ-057 posture while enabling deterministic integration between governance and runtime layers.
- Related: DR-008, DR-009, DR-017, AQ-057, MQ-019, MQ-021, MQ-033.

## DLOG-0008 (2026-02-27)

- Scope: Step 2/3 event-fraud migration baseline.
- Decision: add additive `003_event_and_fraud_foundations.sql` with `raw_events`, `event_flags`, and `trusted_metrics_staging`, preserving compatibility FKs to `registry_packages`.
- Rationale: establishes durable schema contracts now while maintaining DR-018 transition posture and avoiding destructive migration patterns.
- Related: DR-014, DR-018, AQ-049, MQ-011, MQ-012, MQ-034.

## DLOG-0009 (2026-02-27)

- Scope: event ingestion idempotency hardening (Wave 2).
- Decision: enforce hash-consistent idempotency replay semantics (`same key + different request hash => conflict`) and scope DB uniqueness by `(idempotency_scope, idempotency_key)`.
- Rationale: closes replay-collision correctness gaps without introducing destructive schema rewrites.
- Related: DR-011, AQ-050, MQ-035.

## DLOG-0010 (2026-02-27)

- Scope: DR-016 runtime implementation slice (Wave 2).
- Decision: implement executable signed reporter ingestion runtime path with canonical-string/body-hash validation, timestamp skew bounds, nonce replay TTL checks, signature hook, and evaluator-backed submit flow.
- Rationale: moves security intake from contract-only status to runnable behavior while keeping unresolved policy decisions in fail-closed posture.
- Related: DR-016, MQ-023, MQ-024, MQ-025, MQ-028, MQ-029.

## DLOG-0011 (2026-02-27)

- Scope: DR-018 migration readiness (Wave 2).
- Decision: introduce canonical `registry.packages` cutover migration plus `public.registry_packages` compatibility view bridge; add verification script/tests for compatibility reads, FK posture, and idempotent rerun guards.
- Rationale: advances canonical FK strategy with forward-only, compatibility-preserving mechanics.
- Related: DR-018, AQ-049, MQ-034, MQ-036, MQ-037.

## DLOG-0012 (2026-02-27)

- Scope: DB-backed ingestion and signed-reporter runtime wiring (Wave 3).
- Decision: replace in-memory persistence surfaces with Postgres adapters (`idempotency`, `raw_events`, `report_nonces`, `security_reports`, `security_enforcement_projections`) and add HTTP handlers for `/v1/events` and `/v1/security/reports`.
- Rationale: closes scaffold-only risk and enables deterministic replay/conflict behavior with production storage contracts.
- Related: DR-011, DR-016, DR-018, AQ-050, MQ-023, MQ-035.

## DLOG-0013 (2026-02-27)

- Scope: deterministic async boundaries and runtime transport/supervision hardening (Wave 3).
- Decision: add outbox-backed publish hooks on accepted ingestion/report paths, bounded local stdio supervisor hooks with restart/backoff, remote connector implementations for `sse` and `streamable-http`, and scope-sidecar ownership conflict protection.
- Rationale: enables replay-safe downstream fanout and removes runtime contract gaps while keeping conservative defaults intact.
- Related: DR-011, DR-016, DR-017, AQ-057, MQ-019, MQ-033.

## DLOG-0014 (2026-02-27)

- Scope: DR-012 semantic retrieval foundation and ranking lineage expansion (Wave 3).
- Decision: implement hybrid retrieval (`0.6 * bm25 + 0.4 * semantic`) with strict startup validation for Qdrant/embedding config, fail-closed dimension checks, and BM25-only fallback markers; extend ranking lineage with embedding and vector collection versions plus `semantic_fallback`.
- Rationale: enables semantic retrieval incrementally without compromising deterministic ranking behavior during semantic outages.
- Related: DR-012, MQ-011, MQ-012, MQ-033.

## DLOG-0015 (2026-02-27)

- Scope: operational reliability jobs and runbook closure (Wave 3).
- Decision: add mode-aware job runners (`dry-run`, `shadow`, `production`) for reporter score recompute, enforcement expiry reconciliation, and outbox processing with duplicate-run and partial-failure replay guards; publish migration/cron/semantic fallback runbooks.
- Rationale: converts implementation slices into repeatable production operations with explicit failure recovery paths.
- Related: DR-016, DR-018, MQ-024, MQ-029, MQ-038.

## DLOG-0016 (2026-02-27)

- Scope: runtime daemon executable composition hardening (Wave 4 Step 1/2).
- Decision: introduce `runtime-bootstrap` feature-gated composition over local supervisor, remote connectors, and scope sidecar guards; replace `oauth2_client_credentials` bearer passthrough with token-endpoint exchange + in-memory expiry-aware cache.
- Rationale: closes scaffold gap by making runtime startup executable while preserving deterministic disabled reason codes and non-persistent credential handling.
- Related: DR-017, AQ-057, MQ-019, MQ-033.

## DLOG-0017 (2026-02-27)

- Scope: retrieval bootstrap fail-closed readiness and observability (Wave 4 Step 3/8).
- Decision: add concrete retrieval startup service that validates Qdrant vector dimensions before serving search; wire HTTP inspector and structured startup failure logs (`retrieval.startup.validation_failed`).
- Rationale: prevents serving queries under misconfigured semantic retrieval while keeping failure diagnosis explicit and non-secretive.
- Related: DR-012, MQ-011, MQ-012, MQ-033.

## DLOG-0018 (2026-02-27)

- Scope: outbox production execution and reporter-metrics freshness guard (Wave 4 Step 4/5/8).
- Decision: add Postgres-backed outbox job store + runner (`scripts/run-outbox-processor.mjs`) with retry/dead-letter controls and structured claim/dispatch failure logs; add migration `008_security_reporter_metrics_freshness_guard.sql` enforcing stale-metrics fail-closed readiness.
- Rationale: turns async processing into production-safe execution and blocks stale reporter-score recompute paths by contract.
- Related: DR-016, DR-018, MQ-024, MQ-029, MQ-038.

## DLOG-0019 (2026-02-27)

- Scope: HTTP composition and real Postgres integration validation (Wave 4 Step 6/7).
- Decision: add thin route composition for `/v1/events`, `/v1/security/reports`, and health/readiness endpoints with dependency injection for DB/query executor and signature verification; add dedicated `tests/integration-db` suite and dockerized runner command.
- Rationale: upgrades module-level contracts into runnable service wiring with explicit real-DB validation path while retaining fast fake-db tests.
- Related: DR-011, DR-016, DR-018, AQ-050, MQ-023, MQ-035.

## DLOG-0020 (2026-02-28)

- Scope: Wave 5 discover/plan/apply/verify lifecycle slice.
- Decision: introduce catalog ingest domain + Postgres adapters and expose catalog read/search routes; add lifecycle planning/apply/verify services with new migration `009_install_lifecycle_foundations.sql`.
- Rationale: delivers first end-to-end user-visible install lifecycle while keeping migration changes additive and compatibility-safe.
- Related: DR-003, DR-011, DR-017, DR-018, AQ-049, AQ-050, MQ-034, MQ-035.

## DLOG-0021 (2026-02-28)

- Scope: lifecycle idempotency and replay behavior hardening.
- Decision: enforce route-scoped idempotency keys for `POST /v1/install/plans`, `POST /v1/install/plans/:id/apply`, and `POST /v1/install/plans/:id/verify` using existing `ingestion_idempotency_records` with request-hash conflict semantics.
- Rationale: prevents cross-endpoint key collisions and preserves deterministic replay/conflict behavior under retries.
- Related: DR-011, AQ-050, MQ-035.

## DLOG-0022 (2026-02-28)

- Scope: VS Code Copilot local apply path.
- Decision: replace in-memory adapter persistence with filesystem-backed scope files using atomic temp-write + fsync + rename and rollback-to-backup on failures; enforce daemon ownership before mutation.
- Rationale: enables durable local apply behavior with explicit failure taxonomy and safer crash-path recovery.
- Related: DR-017, AQ-057, MQ-019, MQ-033.

## DLOG-0023 (2026-02-28)

- Scope: Wave 5 production wiring and async boundaries.
- Decision: add runnable control-plane server bootstrap with fail-closed readiness probes, DB-backed reporter key verifier (active/revoked semantics), and deterministic outbox dispatcher support for install lifecycle event types.
- Rationale: moves lifecycle from test-only composition into runnable service behavior while retaining governance-safe replay and verification guarantees.
- Related: DR-011, DR-016, DR-017, MQ-023, MQ-024, MQ-038.

## DLOG-0024 (2026-02-28)

- Scope: Wave 6 scope lock and acceptance-gate baseline.
- Decision: lock Wave 6 execution to concrete retrieval wiring, deterministic ingest/outbox runtime operations, and env-driven runtime gating with additive migration posture only.
- Rationale: keeps implementation auditable against explicit Step 1..12 gates while preserving governance boundary semantics (Open/Proposed unchanged unless separately approved).
- Related: DR-011, DR-012, DR-017, DR-018, AQ-049, AQ-050, MQ-011, MQ-012, MQ-019, MQ-024, MQ-033, MQ-035, MQ-038.

## DLOG-0025 (2026-02-28)

- Scope: Wave 6 retrieval provider execution path.
- Decision: implement concrete Postgres BM25 retriever + Qdrant semantic retriever + OpenAI-compatible embedding provider, and wire control-plane retrieval bootstrap from env with fail-closed startup readiness behavior.
- Rationale: closes interface-only retrieval gap while preserving deterministic fallback (`semantic_fallback=true`) and non-secret startup diagnostics.
- Related: DR-012, MQ-011, MQ-012, MQ-033.

## DLOG-0026 (2026-02-28)

- Scope: Wave 6 runtime gate and remote auth wiring.
- Decision: replace hardcoded runtime gate assumptions in control-plane default bootstrap with env-driven feature-flag resolution; add env-backed remote resolver + secret-ref mapping + OAuth token client integration.
- Rationale: keeps conservative defaults while enabling controlled remote transport rollout and deterministic failure codes for missing secrets/token exchange failures.
- Related: DR-017, AQ-057, MQ-019, MQ-033.

## DLOG-0027 (2026-02-28)

- Scope: Wave 6 outbox internal dispatch hardening.
- Decision: replace internal no-op dispatch handlers with Postgres-backed deterministic handlers that persist replay-safe execution records in additive migration `010_outbox_internal_dispatch_runs.sql`.
- Rationale: turns internal dispatch mode into auditable real execution while preserving idempotent replay behavior and dead-letter semantics.
- Related: DR-011, DR-018, MQ-024, MQ-038.

## DLOG-0028 (2026-02-28)

- Scope: Wave 7 scope lock and acceptance-gate baseline.
- Decision: lock Wave 7 implementation to retrieval-sync execution, internal outbox side effects, dead-letter replay operations, runtime secret/env hardening, and CI verification automation, with additive migrations only.
- Rationale: keeps Wave 7 auditable against explicit Step 1..12 gates while preserving governance boundary semantics (Open/Proposed unchanged unless separately approved).
- Related: DR-011, DR-012, DR-017, DR-018, AQ-049, AQ-050, MQ-019, MQ-024, MQ-033, MQ-035, MQ-038.

## DLOG-0029 (2026-02-28)

- Scope: Retrieval sync and ranking outbox execution path.
- Decision: implement deterministic retrieval sync projection + fingerprint skipping (`retrieval_sync_documents`) and wire `ranking.sync.requested` internal handler path to execute semantic index sync via bounded package-targeted runs.
- Rationale: closes Wave 6 deferred sync gap and moves ranking sync from ledger-only to runnable operational behavior.
- Related: DR-012, MQ-011, MQ-012, MQ-033, MQ-038.

## DLOG-0030 (2026-02-28)

- Scope: Outbox internal handler side effects and dead-letter replay tooling.
- Decision: add `outbox_internal_dispatch_effects` for deterministic side-effect records across handler families and introduce dead-letter list/requeue service + audit log (`outbox_dead_letter_replay_audit`) with explicit operator confirmation.
- Rationale: improves replay/recovery observability and gives operators a safe, auditable requeue mechanism without destructive state edits.
- Related: DR-011, DR-018, MQ-024, MQ-038.

## DLOG-0031 (2026-02-28)

- Scope: Runtime secret resolution and startup env hardening.
- Decision: add provider-first secret resolver abstraction with env-map fallback, redact secret-like oauth failure log fragments, and enforce deterministic startup env validation for retrieval/runtime combinations.
- Rationale: reduces production misconfiguration risk while preserving deterministic failure signatures and non-secret diagnostics.
- Related: DR-017, AQ-057, MQ-019, MQ-033.

## DLOG-0032 (2026-02-28)

- Scope: Wave 7 CI and operator/runbook closure.
- Decision: add GitHub Actions workflow running baseline checks plus integration-db docker flow, and update runbooks for retrieval sync recovery and dead-letter replay operations.
- Rationale: converts Wave 7 hardening into continuously enforced validation and reproducible operator playbooks.
- Related: DR-018, AQ-050, MQ-024, MQ-038.

## DLOG-0033 (2026-02-28)

- Scope: Wave 9 scope lock and acceptance-gate baseline.
- Decision: lock Wave 9 implementation to profile orchestration closure (validation, run-plan linkage, execution modes), SLO rollup foundations + operator runner, event-family ownership codification, hermetic local stack, and governance-automation closure, with additive migrations only.
- Rationale: keeps implementation auditable against explicit Step 1..12 gates while preserving governance boundary semantics (Open/Proposed unchanged unless separately approved).
- Related: AQ-054, AQ-056, DR-011, DR-017, DR-018, MQ-024, MQ-029, MQ-033, MQ-035, MQ-038.

## DLOG-0034 (2026-02-28)

- Scope: Wave 9 SLO rollup, local stack, and governance automation implementation.
- Decision: implement operational SLO rollup service with 7 metric families (outbox dead-letter rate, retrieval semantic fallback rate, install apply/verify success rate, lifecycle replay ratio, profile run success rate, governance recompute dispatch rate), additive migration 013, hermetic docker-compose local stack (Postgres 16 + Qdrant), and governance drift checker script.
- Rationale: closes observability and operator-readiness gaps while preserving existing replay/idempotency invariants and governance status boundaries.
- Related: AQ-054, AQ-056, MQ-033, MQ-038.

## DLOG-0035 (2026-02-28)

- Scope: Wave 9 closure consistency for Step 10 CI expansion.
- Decision: defer profile-specific e2e scenario and DB-backed ops smoke GitHub workflow for this wave; keep them as explicit follow-up items while retaining required CI baseline + integration-db docker gates.
- Rationale: shipped behavior already has direct coverage (unit + contract + integration-db + existing e2e-local), while ops smoke automation requires additional CI runtime/secret posture work not scoped for this closure pass.
- Related: AQ-050, DR-018, MQ-038.

## DLOG-0036 (2026-02-28)

- Scope: E9-S1 profile-specific e2e scenario implementation.
- Decision: implement `tests/e2e/profile-lifecycle-local.e2e.test.ts` covering create/get/list/export/import/install(plan_only)/install(apply_verify)/optional-skip flows using in-memory adapters.
- Rationale: closes DLOG-0035 deferral for profile e2e; runs as part of `npm run test:e2e-local` without DB dependency.
- Related: AQ-050, MQ-038.

## DLOG-0037 (2026-02-28)

- Scope: E9-S2 ops smoke workflow implementation.
- Decision: add `.github/workflows/forge-ops-smoke.yml` as non-blocking `workflow_dispatch` + nightly cron workflow running retrieval-sync, outbox, dead-letter, and SLO rollup in dry-run mode against ephemeral Postgres service container.
- Rationale: closes DLOG-0035 deferral for ops smoke automation; uses `continue-on-error` + artifact uploads for triage without blocking merges.
- Related: AQ-050, DR-018, MQ-038.

## DLOG-0038 (2026-02-28)

- Scope: E2-S1 GitHub source connector for catalog ingest.
- Decision: implement `packages/catalog/src/sources/github-connector.ts` with pure normalization function (`normalizeGitHubRepos`), fetch layer (`fetchGitHubRepos`), and entry point (`runGitHubConnector`). Wire into `scripts/run-catalog-ingest.mjs` via `--source github` flag. Export as `@forge/catalog/sources/github-connector`.
- Rationale: preserves hexagonal architecture (pure normalization separated from I/O fetch), deterministic replay via fixture-based testing, and idempotent ingest pipeline integration. Skips archived/forked repos, normalizes topics, extracts license/release metadata.
- Related: E2-S1, AQ-056.

## DLOG-0039 (2026-02-28)

- Scope: E3-S1 dependency graph expansion and transitive resolution.
- Decision: add shared dependency graph contracts/resolver (`packages/shared-contracts/src/dependency-graph.ts`) with deterministic topological ordering, cycle/missing/duplicate conflict taxonomy; integrate dependency resolution into install plan creation with optional request inputs (`dependency_edges`, `known_package_ids`) and response projection (`dependency_resolution`).
- Rationale: ensures dependency expansion is deterministic and machine-readable, while preserving existing idempotency/replay semantics and explicit 422 conflict mapping (`dependency_resolution_failed:`).
- Related: E3-S1, AQ-050, MQ-038.

## DLOG-0040 (2026-02-28)

- Scope: E5-S1 update lifecycle prototype.
- Decision: implement prototype update path via `updatePlan` service and `POST /v1/install/plans/:plan_id/update` endpoint; reuse existing idempotency + audit model and persist update attempts through `install_apply_attempts` with `details.operation = "update"`.
- Rationale: provides replay-safe update capability without introducing destructive schema changes; keeps prototype constraints explicit for follow-on remove/rollback stories (`E5-S2`, `E5-S3`).
- Related: E5-S1, DR-011, DR-017.

## DLOG-0041 (2026-02-28)

- Scope: DR-020 launch-contract closure (`discover -> choose -> install proxy -> validate`).
- Decision: add launch-baseline registry connectors (`npm`, `pypi`) for catalog ingest (`packages/catalog/src/sources/npm-connector.ts`, `packages/catalog/src/sources/pypi-connector.ts`) and wire `scripts/run-catalog-ingest.mjs --source npm|pypi`; extend operational SLO rollups with DR-002 funnel KPIs (`funnel.ttfsc.p90_seconds`, `funnel.cold_start.success_rate`, `funnel.retryless.success_rate`).
- Rationale: closes remaining DR-020 acceptance gaps by ensuring Tier-3 feed degradation does not block launch-critical ingestion and by making weekly KPI reporting cover `search -> first successful runtime call` outcomes.
- Related: DR-002, DR-020, AQ-003, AQ-056, MQ-038.

## DLOG-0042 (2026-02-28)

- Scope: post-immediate P0 re-baseline before remaining implementation work.
- Decision: re-baseline docs/indexes to current code truth before new feature work, specifically:
  - lifecycle state includes update/remove/rollback routes + service path,
  - active migration range includes `014_install_lifecycle_remove_rollback_states.sql`,
  - Step 10 CI expansion is implemented (`forge-ci.yml` profile e2e coverage and non-blocking `forge-ops-smoke.yml`).
- Rationale: prevents stale documentation from masking real implementation gaps during remaining P0 execution and keeps release/readiness reporting deterministic.
- Related: E1, E2-S2/S3, E3-S2/S3, E5-S2/S3, E9-S3.
