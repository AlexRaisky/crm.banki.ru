#!/usr/bin/env bash
# Обновление PREPROD копией боевых данных: pg_dump с db-prod -> restore в db-preprod.
# Данные PREPROD затираются (это её назначение — реалистичная копия прода).
set -euo pipefail
cd "$(dirname "$0")/.."

DB_USER="${DB_USER:-crm}"
DB_NAME="${DB_NAME:-crm}"

echo "Копирую данные prod -> preprod..."
docker compose exec -T db-prod pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | docker compose exec -T db-preprod psql -q -U "$DB_USER" -d "$DB_NAME"

docker compose restart app-preprod
echo "PREPROD обновлена с прода. http://localhost:${APP_PORT_PREPROD:-8081}"
