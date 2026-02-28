#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Stopping local stack..."
docker compose -f "$REPO_ROOT/docker-compose.yml" down
echo "Local stack stopped. Data volumes preserved. Use 'docker compose down -v' to remove data."
