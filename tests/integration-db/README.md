# Integration DB Tests

These tests run key adapter flows against a real PostgreSQL instance.

## Prerequisites

1. PostgreSQL 16+ with Forge migrations applied.
2. `FORGE_INTEGRATION_DB_URL` environment variable set to the test database URL.

## Commands

1. Run against an existing database:
   - `npm run test:integration-db`
2. Run with an ephemeral Dockerized database:
   - `npm run test:integration-db:docker`

The Docker command applies all SQL files in `infra/postgres/migrations/` before running the suite.
