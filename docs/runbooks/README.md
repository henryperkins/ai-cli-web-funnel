# Runbooks

This directory holds operational runbooks for migration, policy, ingestion, and runtime reliability paths.

- [Event Ingestion and Fraud Baseline](./event-ingestion-fraud-baseline.md)
- [Runtime Preflight and Adapter Contracts](./runtime-preflight-and-adapter-contracts.md)
- [Install Lifecycle (VS Code Copilot Local)](./install-lifecycle-vscode-copilot-local.md)
- [Migration Rollout and Rollback](./migration-rollout-and-rollback.md)
- [Cron Failure Triage and Replay-Safe Recovery](./cron-failure-triage-and-replay-recovery.md)
- [Semantic Retrieval Incident Fallback](./semantic-retrieval-incident-fallback.md)

Current migration verification helper:
- `node scripts/verify-dr018-migration.mjs` (checks DR-018 cutover compatibility view, FK posture, and idempotent guard rails).

Integration-db validation helpers:
- `npm run test:integration-db` (requires `FORGE_INTEGRATION_DB_URL`).
- `npm run test:integration-db:docker` (provisions ephemeral Postgres, applies migrations `001..009`, and runs `tests/integration-db`).

Lifecycle/runtime validation helpers:
- `npm run test:e2e-local` (filesystem-backed local lifecycle flow coverage).
- `npm run run:control-plane` (starts the real control-plane server from env).
