#!/usr/bin/env bash
#
# Обработчик очереди выкатов. Не ИИ и не демон: обычный скрипт, который systemd-таймер
# запускает раз в минуту. Прочитал задание — выполнил известный сценарий — записал ответ.
#
# Зачем он вообще. Панель работает внутри контейнера, docker ей недоступен: пробросить
# сокет хоста означало бы выдать любому, кто дотянется до панели, права root на сервере.
# Поэтому кнопка в панели только ставит задание в app.deploy_log, а выполняет его этот
# скрипт — на хосте, где docker есть.
#
# Что он умеет: выкатить один контур до одного коммита. Ничего из базы в шелл не
# подставляется без проверки — контур сверяется со списком, коммит обязан существовать
# в ветке. Иначе кнопка в панели стала бы удалённым выполнением команд.
#
# Установка (один раз, от пользователя, состоящего в группе docker):
#   sudo cp scripts/crm-deploy-runner.service scripts/crm-deploy-runner.timer /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now crm-deploy-runner.timer
#
# Проверить вручную:
#   bash scripts/deploy-runner.sh --once
#
set -uo pipefail

ROOT="${DEPLOY_DIR:-$HOME/crm.banki.ru}"
APP="$ROOT/crm-admin"
BRANCH="${DEPLOY_BRANCH:-admin-panel}"
DB_CONTAINER="${DEPLOY_DB:-crm-admin-db-prod}"   # где лежит очередь: база того контура, чью панель открывают
DB_USER="${DB_USER:-crm}"
DB_NAME="${DB_NAME:-crm}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.server.yml"
VERSION="1"

# Контуры, которые вообще можно катить. Список закрытый: значение приходит из базы, и
# подставлять его в команду без проверки нельзя.
ALLOWED_ENVS="test preprod prod"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

# psql без -i: команда идёт аргументом, stdin обработчику не нужен и только мешает
# (docker exec -i вычитывает его целиком, ломая внешние циклы).
psql_q() { docker exec "$DB_CONTAINER" psql -qtAX -U "$DB_USER" -d "$DB_NAME" -c "$1" </dev/null; }

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

# ------------------------------------------------------------------ отметка «жив»
heartbeat() {
    psql_q "UPDATE app.deploy_runner SET last_seen_at = now(), host = '$(sql_escape "$(hostname)")',
            version = '$VERSION' WHERE id = 1" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------------ выполнение
run_job() {
    local id="$1" target="$2" commit="$3"

    # 1. параметры. Контур — только из списка; коммит — только hex.
    if ! printf '%s' " $ALLOWED_ENVS " | grep -q " $target "; then
        finish "$id" failed "Неизвестный контур: $target"; return
    fi
    if ! printf '%s' "$commit" | grep -qE '^[0-9a-f]{7,40}$'; then
        finish "$id" failed "Некорректный коммит: $commit"; return
    fi

    local out="" rc=0
    log "задание #$id: $target -> $commit"

    # 2. репозиторий. Ветку обновляем и проверяем, что коммит в ней действительно есть:
    #    иначе выкатили бы неизвестно что.
    out+=$(cd "$ROOT" && git fetch -q origin "$BRANCH" 2>&1 && git checkout -q "$BRANCH" 2>&1 \
           && git pull -q --ff-only 2>&1) || rc=$?
    if [ $rc -ne 0 ]; then finish "$id" failed "git: $out"; return; fi

    if ! (cd "$ROOT" && git merge-base --is-ancestor "$commit" "origin/$BRANCH" 2>/dev/null); then
        finish "$id" failed "Коммита $commit нет в ветке $BRANCH"; return
    fi

    # 3. срез. Катим ДО коммита, а не обязательно до HEAD: панель даёт выбрать, докуда.
    out+=$'\n'$(cd "$ROOT" && git checkout -q "$commit" 2>&1) || rc=$?
    if [ $rc -ne 0 ]; then finish "$id" failed "checkout: $out"; return; fi

    # 4. сборка. Только через build.sh — он кладёт в образ отметку о версии, без которой
    #    панель не знает, что в ней собрано, и «Выкатки» слепнут.
    out+=$'\n'$(cd "$APP" && bash scripts/build.sh 2>&1 | tail -5) || rc=$?
    if [ $rc -ne 0 ]; then
        (cd "$ROOT" && git checkout -q "$BRANCH")
        finish "$id" failed "сборка: $(printf '%s' "$out" | tail -c 1500)"; return
    fi

    # 5. пересоздание контура. Именно пересоздание: docker restart не перечитывает .env.
    out+=$'\n'$(cd "$APP" && $COMPOSE up -d --no-deps --force-recreate "app-$target" 2>&1) || rc=$?
    if [ $rc -ne 0 ]; then
        (cd "$ROOT" && git checkout -q "$BRANCH")
        finish "$id" failed "запуск: $(printf '%s' "$out" | tail -c 1500)"; return
    fi

    # 6. прод обслуживает nginx — после пересоздания у контейнера новый адрес в сети docker
    if [ "$target" = "prod" ]; then
        out+=$'\n'$(docker exec crm-admin-nginx nginx -s reload 2>&1) || true
    fi

    # 7. рабочую копию возвращаем на ветку: следующий выкат начнётся с обычного состояния,
    #    а не из detached HEAD посреди истории.
    (cd "$ROOT" && git checkout -q "$BRANCH" && git pull -q --ff-only) || true

    sleep 20   # даём приложению встать, чтобы в хвосте лога было видно старт
    out+=$'\n'$(docker logs --tail 15 "crm-admin-app-$target" 2>&1) || true
    finish "$id" done "$(printf '%s' "$out" | tail -c 3000)"
    log "задание #$id: готово"
}

finish() {
    local id="$1" status="$2" text="$3"
    psql_q "UPDATE app.deploy_log SET run_status = '$status', run_finished_at = now(),
            run_output = '$(sql_escape "$text")' WHERE id = $id" >/dev/null
    [ "$status" = "failed" ] && log "задание #$id: ОШИБКА — $(printf '%s' "$text" | head -c 200)"
    return 0
}

# ------------------------------------------------------------------ один проход
once() {
    heartbeat

    # Занимаем ОДНО задание, и занимаем условием status='queued' в самом UPDATE: кто первым
    # обновил, тот и владеет. Иначе два запуска таймера (или два обработчика) взялись бы
    # за одно задание и собирали образ одновременно — на одном теге crm-admin:local.
    local claimed
    claimed=$(psql_q "UPDATE app.deploy_log SET run_status = 'running', run_started_at = now()
                      WHERE id = (SELECT id FROM app.deploy_log WHERE run_status = 'queued'
                                  ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
                      RETURNING id || ' ' || target_env || ' ' || to_commit")
    [ -z "$claimed" ] && return 0

    # shellcheck disable=SC2086
    set -- $claimed
    run_job "$1" "$2" "$3"
}

# Зависшие задания. Обработчик мог быть убит посреди выката — тогда задание осталось
# running навсегда и очередь встала. Через полчаса признаём его брошенным; переотправлять
# сами НЕ будем: доехало оно или нет, отсюда не видно, и решает человек.
release_stuck() {
    psql_q "UPDATE app.deploy_log SET run_status = 'failed',
            run_output = coalesce(nullif(run_output, ''), 'Обработчик прервался: задание висело в running дольше 30 минут. Проверьте контур и повторите.'),
            run_finished_at = now()
            WHERE run_status = 'running' AND run_started_at < now() - interval '30 minutes'" >/dev/null 2>&1 || true
}

case "${1:-}" in
    --once|"") release_stuck; once ;;
    --heartbeat) heartbeat ;;
    *) echo "Использование: $0 [--once|--heartbeat]"; exit 2 ;;
esac
