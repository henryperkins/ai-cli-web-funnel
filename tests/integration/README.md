# Integration Tests

Fast integration/contract tests in this folder use fake query executors and run as part of `npm run test`.

Real Postgres integration tests live under `tests/integration-db/` and are run separately via:
1. `npm run test:integration-db`
2. `npm run test:integration-db:docker`
