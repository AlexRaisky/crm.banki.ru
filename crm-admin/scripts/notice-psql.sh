#!/usr/bin/env bash
#
# psql к базе notice того контура, чью панель открывают.
#
# Параметры подключения не зашиты и не набираются руками: они уже лежат в
# app.db_connection у самого контура — там же, откуда их берёт доставка шаблонов.
# Значит и адрес, и учётка всегда те же, что в бою, и не разъедутся с настройкой.
#
# Пароль передаётся контейнеру переменной окружения и в командной строке не светится
# (иначе он остался бы в истории шелла и в выводе ps у всех, кто на хосте).
#
# Использование:
#   bash scripts/notice-psql.sh scripts/sms-approved-backfill.sql
#   bash scripts/notice-psql.sh scripts/sms-approved-backfill.sql -v apply=1
#   NOTICE_ENV=preprod bash scripts/notice-psql.sh -c 'SELECT count(*) FROM notice.d_com_sms_template'
#
set -uo pipefail

ENV_NAME="${NOTICE_ENV:-test}"
DB_CONTAINER="crm-admin-db-${ENV_NAME}"
DB_USER="${DB_USER:-crm}"
DB_NAME="${DB_NAME:-crm}"

case "$ENV_NAME" in
    test|preprod|prod) ;;
    *) echo "Неизвестный контур: $ENV_NAME (ожидается test, preprod или prod)"; exit 2 ;;
esac

# Строка подключения из настроек контура. Разделитель — табуляция: в пароле может быть
# что угодно, включая пробел, а вот табуляции там не бывает.
conn=$(docker exec "$DB_CONTAINER" psql -qtAX -U "$DB_USER" -d "$DB_NAME" -F $'\t' -c \
    "SELECT jdbc_url, coalesce(username, ''), coalesce(password, '')
     FROM app.db_connection WHERE is_prod_sync AND is_active LIMIT 1" </dev/null) || {
    echo "Не удалось прочитать настройки из $DB_CONTAINER"; exit 1
}
[ -z "$conn" ] && { echo "В контуре $ENV_NAME не настроено подключение к прод-БД шаблонов"; exit 1; }

IFS=$'\t' read -r url user pass <<<"$conn"

# jdbc:postgresql://host[:port]/db[?params]  ->  host, port, db
# Сначала отрезаем базу, и только потом смотрим на порт: в адресе без порта
# двоеточия нет вовсе, и «всё до двоеточия» вернуло бы host вместе с базой.
addr="${url#jdbc:postgresql://}"
addr="${addr%%\?*}"                  # отбрасываем ?param=... если есть
hp="${addr%%/*}"                     # host[:port]
db="${addr#*/}"
case "$hp" in
    *:*) host="${hp%%:*}"; port="${hp#*:}" ;;
    *)   host="$hp";       port=5432 ;;
esac

echo "→ ${ENV_NAME}: ${host}:${port}/${db}, пользователь ${user}" >&2

# Первый аргумент — файл со скриптом, если это существующий файл. Иначе всё уходит
# в psql как есть (например -c '...').
sql_file=""
if [ $# -gt 0 ] && [ -f "$1" ]; then
    sql_file="$1"
    shift
fi

if [ -n "$sql_file" ]; then
    # psql внутри контейнера хозяйскую файловую систему не видит — подаём скрипт на stdin
    docker exec -i -e PGPASSWORD="$pass" "$DB_CONTAINER" \
        psql -h "$host" -p "$port" -U "$user" -d "$db" -v ON_ERROR_STOP=1 "$@" < "$sql_file"
else
    docker exec -i -e PGPASSWORD="$pass" "$DB_CONTAINER" \
        psql -h "$host" -p "$port" -U "$user" -d "$db" -v ON_ERROR_STOP=1 "$@" </dev/null
fi
