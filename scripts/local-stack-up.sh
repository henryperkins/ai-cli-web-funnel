#!/usr/bin/env bash
set -euo pipefail
# Bootstrap local dev stack: Postgres + Qdrant
# After Postgres is healthy, applies all migrations.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Starting local stack..."
docker compose -f "$REPO_ROOT/docker-compose.yml" up -d --wait

echo "Applying migrations..."
MIGRATION_DIR="$REPO_ROOT/infra/postgres/migrations"
LOCAL_DB_URL="postgresql://forge:forge_local@localhost:5432/forge_dev"

for migration in "$MIGRATION_DIR"/*.sql; do
  echo "  Applying $(basename "$migration")..."
  psql "$LOCAL_DB_URL" -f "$migration" --quiet 2>/dev/null || true
done

echo "Local stack ready."
echo "  Postgres: postgresql://forge:forge_local@localhost:5432/forge_dev"
echo "  Qdrant:   http://localhost:6333"
