# Docs Index

## Product Intent

Forge is intended to be an install broker for CLI addons (MCP servers, skills, plugins, and related integrations).
The goal is to replace ad-hoc search + copy/paste setup with a deterministic flow:
1. discover
2. plan
3. install
4. verify

Operational target: CurseForge-style addon management behavior for CLI ecosystems.
1. catalog and discovery
2. one-path install/update/remove
3. profile-aware config management
4. post-install verification and recovery guidance

Primary product framing is documented in the repository root README.
Detailed decision records remain in `application_decision_records.md`.

## Existing Platform Work and Why It Matters

1. Ingestion and idempotency logic supports reliable install/runtime telemetry and replay-safe operations.
2. Security governance and signed reporter ingestion provide abuse/intake controls for catalog and runtime risk.
3. Runtime preflight/trust gates provide deterministic allow/deny checks before addon startup.
4. Migration guardrails support compatibility-preserving schema evolution while product surface expands.

## Governance and Decision Records

1. ADRs: `docs/adr/`
2. Application decision records: `application_decision_records.md`
3. Open questions: `application_master_open_questions.md`, `master_open_questions.md`
4. Guardrail tracker: `OPEN_QUESTIONS_TRACKER.md`
5. Implementation-time decision log: `DECISION_LOG.md`
6. CI verification contract: `docs/ci-verification.md`

## Runbooks

1. `docs/runbooks/event-ingestion-fraud-baseline.md`
2. `docs/runbooks/runtime-preflight-and-adapter-contracts.md`
3. `docs/runbooks/install-lifecycle-vscode-copilot-local.md`
4. `docs/runbooks/semantic-retrieval-incident-fallback.md`
5. `docs/runbooks/cron-failure-triage-and-replay-recovery.md`
6. `docs/runbooks/retrieval-sync-backfill-and-recovery.md`
7. `docs/runbooks/outbox-dead-letter-requeue.md`

## Wave Reports

1. `docs/wave3-build-report.md`
2. `docs/wave4-build-report.md`
3. `docs/wave5-build-report.md`
4. `docs/wave6-build-report.md`
5. `docs/wave7-build-report.md`
