#!/usr/bin/env bash
#
# Подключение к базе notice того контура, чью панель открывают.
#
# Общая часть для scripts/notice-psql.sh и scripts/sms-approved-rehearsal.sh: адрес и
# учётка берутся из app.db_connection самого контура — оттуда же, откуда их берёт
# доставка шаблонов. Значит скрипты всегда ходят туда же, куда ходит бой, и не
# разъезжаются с настройкой.
#
# notice_conn() выставляет: NOTICE_HOST, NOTICE_PORT, NOTICE_DB, NOTICE_USER,
# NOTICE_PASS и OUR_DB_CONTAINER (наша база того же контура).

notice_conn() {
    local env_name="${NOTICE_ENV:-test}"
    case "$env_name" in
        test|preprod|prod) ;;
        *) echo "Неизвестный контур: $env_name (ожидается test, preprod или prod)" >&2; return 2 ;;
    esac

    OUR_DB_CONTAINER="crm-admin-db-${env_name}"
    OUR_DB_USER="${DB_USER:-crm}"
    OUR_DB_NAME="${DB_NAME:-crm}"

    # Разделитель — табуляция: в пароле может быть что угодно, включая пробел,
    # а вот табуляции там не бывает.
    local conn
    conn=$(docker exec "$OUR_DB_CONTAINER" psql -qtAX -U "$OUR_DB_USER" -d "$OUR_DB_NAME" -F $'\t' -c \
        "SELECT jdbc_url, coalesce(username, ''), coalesce(password, '')
         FROM app.db_connection WHERE is_prod_sync AND is_active LIMIT 1" </dev/null) || {
        echo "Не удалось прочитать настройки из $OUR_DB_CONTAINER" >&2; return 1
    }
    [ -z "$conn" ] && { echo "В контуре $env_name не настроено подключение к прод-БД шаблонов" >&2; return 1; }

    IFS=$'\t' read -r NOTICE_URL NOTICE_USER NOTICE_PASS <<<"$conn"

    # jdbc:postgresql://host[:port]/db[?params]
    # Сначала отрезаем базу, и только потом смотрим на порт: в адресе без порта
    # двоеточия нет вовсе, и «всё до двоеточия» вернуло бы хост вместе с базой.
    local addr hp
    addr="${NOTICE_URL#jdbc:postgresql://}"
    addr="${addr%%\?*}"
    hp="${addr%%/*}"
    NOTICE_DB="${addr#*/}"
    case "$hp" in
        *:*) NOTICE_HOST="${hp%%:*}"; NOTICE_PORT="${hp#*:}" ;;
        *)   NOTICE_HOST="$hp";       NOTICE_PORT=5432 ;;
    esac

    NOTICE_ENV_NAME="$env_name"
    return 0
}

# psql к notice. Пароль уходит переменной окружения, а не аргументом: в аргументах
# он осел бы в истории шелла и был бы виден в ps всем, кто на хосте.
notice_psql() {
    docker exec -i -e PGPASSWORD="$NOTICE_PASS" "$OUR_DB_CONTAINER" \
        psql -h "$NOTICE_HOST" -p "$NOTICE_PORT" -U "$NOTICE_USER" -d "$NOTICE_DB" \
        -v ON_ERROR_STOP=1 "$@"
}

# psql к нашей базе того же контура.
our_psql() {
    docker exec -i "$OUR_DB_CONTAINER" \
        psql -U "$OUR_DB_USER" -d "$OUR_DB_NAME" -v ON_ERROR_STOP=1 "$@"
}
