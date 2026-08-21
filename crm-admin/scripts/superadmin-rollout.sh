#!/usr/bin/env bash
#
# Раскатка фикса «супер-админов может быть несколько» (21e928c) на все три контура.
#
# Зачем отдельный скрипт. Все три приложения поднимаются из одного образа
# crm-admin:local, а ветка admin-panel к этому моменту содержит ещё Jira, колонки промо
# и правки Scheme Builder — то, что должно оставаться пока только на тесте. Собрать образ
# из HEAD и пересоздать прод значит увезти туда всё это разом, вместе с миграциями.
# Поэтому прод и препрод собираются из того коммита, на котором они работают сейчас,
# плюс один этот фикс сверху; тест — как обычно, из HEAD ветки.
#
# Коммит контура определяется по времени сборки его образа: последний коммит ветки,
# сделанный до этого момента, и есть тот, из которого образ собран.
#
# Запуск (с сервера, из каталога crm-admin):
#   bash scripts/superadmin-rollout.sh
#
set -euo pipefail

# Скрипт переключает рабочую копию на старые коммиты, где его самого ещё нет, — а bash
# дочитывает файл по ходу выполнения. Поэтому сначала уходим работать из /tmp.
case "$0" in
  /tmp/*) ;;
  *) tmp="/tmp/superadmin-rollout.$$.sh"; cp "$0" "$tmp"; exec bash "$tmp" "$@" ;;
esac

FIX=21e928c                      # коммит с фиксом
BRANCH=admin-panel               # рабочая ветка
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.server.yml"

cd "$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null || echo ~/crm.banki.ru)"
ROOT="$(pwd)"
APP="$ROOT/crm-admin"
INDEX="crm-admin/src/main/resources/static/settings/index.html"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ------------------------------------------------------------------ проверки
[ -d "$APP" ] || { echo "Не нашёл каталог crm-admin в $ROOT"; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  echo "Рабочая копия не чиста — сначала разберитесь с этими файлами:"; git status --short; exit 1
fi
START_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
trap 'git checkout -q "$START_BRANCH" 2>/dev/null || true' EXIT

say "Обновляю репозиторий"
git fetch -q origin
git checkout -q "$BRANCH"
git pull -q --ff-only
git cat-file -e "$FIX^{commit}" 2>/dev/null || { echo "В репозитории нет коммита $FIX"; exit 1; }

# ------------------------------------------------------------------ что где раскатано
commit_of() {   # коммит, из которого собран образ работающего контейнера
  local img created
  img="$(docker inspect -f '{{.Image}}' "crm-admin-app-$1")" || return 1
  # у docker в дате наносекунды, git их не понимает — обрезаем до секунд
  created="$(docker image inspect -f '{{.Created}}' "$img" | sed -E 's/[.][0-9]+Z$/Z/')"
  git log -1 --before="$created" --format=%H "$BRANCH"
}

PROD_BASE="$(commit_of prod)"    || { echo "Не нашёл контейнер crm-admin-app-prod";    exit 1; }
PRE_BASE="$(commit_of preprod)"  || { echo "Не нашёл контейнер crm-admin-app-preprod"; exit 1; }
[ -n "$PROD_BASE" ] && [ -n "$PRE_BASE" ] || { echo "Не удалось сопоставить образ с коммитом ветки $BRANCH"; exit 1; }
say "Сейчас раскатано"
printf '  prod    %s  %s\n' "${PROD_BASE:0:7}" "$(git log -1 --format=%s "$PROD_BASE")"
printf '  preprod %s  %s\n' "${PRE_BASE:0:7}"  "$(git log -1 --format=%s "$PRE_BASE")"

# ------------------------------------------------------------------ сборка контура
rollout() {     # $1 — базовый коммит, дальше список сервисов compose
  local base="$1"; shift
  local short; short="$(git rev-parse --short "$base")"
  say "Собираю $base + фикс для: $*"
  git checkout -q -B "superadmin-$short" "$base"

  if git merge-base --is-ancestor "$FIX" "$base"; then
    echo "  фикс уже в этом коммите — только пересобираю и пересоздаю"
  elif ! git cherry-pick "$FIX" >/dev/null 2>&1; then
    # Ожидаемый и единственный конфликт — строка подключения admin-users.js в настройках:
    # у прода она своей версии. Берём прод-версию файла целиком (иначе с ней приедет вся
    # новая разметка настроек), а версию скрипта поднимаем, чтобы браузер не отдал из кеша
    # старую копию admin-users.js.
    local conflicts; conflicts="$(git diff --name-only --diff-filter=U)"
    if [ "$conflicts" != "$INDEX" ]; then
      echo "Неожиданный конфликт, дальше руками:"; echo "$conflicts"; git cherry-pick --abort; exit 1
    fi
    git checkout --ours -- "$INDEX"
    sed -i -E 's#(admin-users\.js)(\?v=[0-9]+)?"#\1?v=9"#' "$INDEX"
    git add "$INDEX"
    git -c core.editor=true cherry-pick --continue >/dev/null
  fi

  ( cd "$APP" && $COMPOSE build app-prod )
  # Тег на память: без него образ этих контуров станет безымянным, как только
  # crm-admin:local уедет на сборку из HEAD, и его снесёт первый же docker image prune.
  docker tag crm-admin:local "crm-admin:superadmin-$short"
  ( cd "$APP" && $COMPOSE up -d --no-deps --force-recreate "$@" )
}

if [ "$PROD_BASE" = "$PRE_BASE" ]; then
  rollout "$PROD_BASE" app-prod app-preprod
else
  rollout "$PROD_BASE" app-prod
  rollout "$PRE_BASE"  app-preprod
fi

# ------------------------------------------------------------------ тест: как обычно, из HEAD
say "Тест — из ветки $BRANCH"
git checkout -q "$BRANCH"
( cd "$APP" && $COMPOSE build app-prod )
( cd "$APP" && $COMPOSE up -d --no-deps --force-recreate app-test )
docker exec crm-admin-nginx nginx -s reload

# ------------------------------------------------------------------ проверка
say "Что сказал бутстрап"
sleep 25
for c in prod preprod test; do
  printf '\n-- %s (ADMIN_EMAIL=%s)\n' "$c" "$(docker exec "crm-admin-app-$c" printenv ADMIN_EMAIL 2>/dev/null || echo '?')"
  docker logs --tail 200 "crm-admin-app-$c" 2>&1 | grep -iE "super-admin" || echo "  (в логе пока пусто — приложение ещё поднимается)"
done

say "Готово. Прод и препрод собраны из своих коммитов + фикс, тест — из $BRANCH"
