#!/usr/bin/env bash
#
# psql к базе notice того контура, чью панель открывают.
#
# Параметры подключения не зашиты и не набираются руками: они уже лежат в
# app.db_connection у самого контура — там же, откуда их берёт доставка шаблонов.
# Разбор адреса — в scripts/lib-notice-conn.sh, общий с остальными скриптами.
#
# Использование:
#   bash scripts/notice-psql.sh scripts/sms-approved-backfill.sql
#   bash scripts/notice-psql.sh scripts/sms-approved-backfill.sql -v apply=1
#   NOTICE_ENV=prod bash scripts/notice-psql.sh -c 'SELECT count(*) FROM notice.d_com_sms_template'
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
. scripts/lib-notice-conn.sh

notice_conn || exit $?
echo "→ ${NOTICE_ENV_NAME}: ${NOTICE_HOST}:${NOTICE_PORT}/${NOTICE_DB}, пользователь ${NOTICE_USER}" >&2

# Первый аргумент — файл со скриптом, если это существующий файл. Иначе всё уходит
# в psql как есть (например -c '...').
sql_file=""
if [ $# -gt 0 ] && [ -f "$1" ]; then
    sql_file="$1"
    shift
fi

if [ -n "$sql_file" ]; then
    # psql внутри контейнера хозяйскую файловую систему не видит — подаём скрипт на stdin
    notice_psql "$@" < "$sql_file"
else
    notice_psql "$@" </dev/null
fi
