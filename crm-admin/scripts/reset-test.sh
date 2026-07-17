#!/usr/bin/env bash
# Сброс среды TEST к начальному состоянию: сносим её БД и поднимаем заново
# (Flyway пересоздаст схему и зальёт сиды). PROD и PREPROD не трогаются.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose rm -sf app-test db-test
docker volume rm -f crm-admin_crm_db_test 2>/dev/null || true
docker compose up -d db-test app-test

echo "TEST сброшена: чистая схема + сид-данные. http://localhost:${APP_PORT_TEST:-8082}"
