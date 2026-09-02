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
# NOTICE_PASS, SETTINGS_CONTAINER (чьи настройки читали) и OUR_DB_CONTAINER
# (куда складывать черновики — тот же контур или заданный SANDBOX_ENV).

notice_conn() {
    local env_name="${NOTICE_ENV:-test}"
    # Куда складывать черновики. По умолчанию тот же контур, но развести их можно:
    # читать боевой notice и при этом ничего не писать в прод-контур —
    # SANDBOX_ENV=test NOTICE_ENV=prod …
    local sandbox="${SANDBOX_ENV:-$env_name}"
    for e in "$env_name" "$sandbox"; do
        case "$e" in
            test|preprod|prod) ;;
            *) echo "Неизвестный контур: $e (ожидается test, preprod или prod)" >&2; return 2 ;;
        esac
    done

    # Настройки подключения читаем у того контура, чей notice нам нужен.
    SETTINGS_CONTAINER="crm-admin-db-${env_name}"
    # А черновики пишем туда, куда попросили.
    OUR_DB_CONTAINER="crm-admin-db-${sandbox}"
    OUR_DB_USER="${DB_USER:-crm}"
    OUR_DB_NAME="${DB_NAME:-crm}"
    SANDBOX_ENV_NAME="$sandbox"

    # Разделитель — табуляция: в пароле может быть что угодно, включая пробел,
    # а вот табуляции там не бывает.
    local conn
    conn=$(docker exec "$SETTINGS_CONTAINER" psql -qtAX -U "$OUR_DB_USER" -d "$OUR_DB_NAME" -F $'\t' -c \
        "SELECT jdbc_url, coalesce(username, ''), coalesce(password, '')
         FROM app.db_connection WHERE is_prod_sync AND is_active LIMIT 1" </dev/null) || {
        echo "Не удалось прочитать настройки из $SETTINGS_CONTAINER" >&2; return 1
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
    docker exec -i -e PGPASSWORD="$NOTICE_PASS" "$SETTINGS_CONTAINER" \
        psql -h "$NOTICE_HOST" -p "$NOTICE_PORT" -U "$NOTICE_USER" -d "$NOTICE_DB" \
        -v ON_ERROR_STOP=1 "$@"
}

# psql к нашей базе — той, что выбрана под черновики (SANDBOX_ENV).
our_psql() {
    docker exec -i "$OUR_DB_CONTAINER" \
        psql -U "$OUR_DB_USER" -d "$OUR_DB_NAME" -v ON_ERROR_STOP=1 "$@"
}
