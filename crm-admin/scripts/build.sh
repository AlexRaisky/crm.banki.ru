#!/usr/bin/env bash
#
# Сборка образа с отметкой о версии.
#
# Зачем не просто `docker compose build`: внутри сборки git недоступен (.git исключён
# .dockerignore, и это правильно — история в образе не нужна), поэтому версию и историю
# ветки кладёт сюда сборщик. Без этого файла панель не знает, какой коммит в ней собран,
# и раздел «Выкатки» может лишь честно сказать «версия неизвестна».
#
# Запуск из каталога crm-admin:
#   bash scripts/build.sh              # собрать образ
#   bash scripts/build.sh --info-only  # только обновить build-info.json
#
set -euo pipefail

HISTORY_DEPTH=300     # сколько коммитов помним: хватает, чтобы найти версию любого контура

cd "$(dirname "$0")/.."
APP="$(pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$APP/..")"
OUT="$APP/src/main/resources/build-info.json"

commit="$(git -C "$ROOT" rev-parse HEAD)"
short="$(git -C "$ROOT" rev-parse --short HEAD)"
branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
subject="$(git -C "$ROOT" log -1 --format=%s)"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
built_by="$(git -C "$ROOT" config user.email 2>/dev/null || whoami)"

LOG_FILE="$(mktemp)"
MIG_FILE="$(mktemp)"
trap 'rm -f "$LOG_FILE" "$MIG_FILE"' EXIT

# История ветки. Пишем через разделители \x1f и \x1e, а не в готовый JSON: своего
# json-формата у git нет, а склеивать кавычки в шелле — верный способ получить битый
# файл на первом же апострофе в заголовке коммита. Экранирует потом python.
git -C "$ROOT" log -n "$HISTORY_DEPTH" \
    --format='%H%x1f%h%x1f%s%x1f%an%x1f%ad%x1e' --date=format:'%Y-%m-%d %H:%M' > "$LOG_FILE"

# Какие коммиты трогают миграции: такой коммит нельзя пропустить при выборе среза —
# Flyway идёт строго по номерам.
git -C "$ROOT" log -n "$HISTORY_DEPTH" --format='%H' --name-only \
    -- crm-admin/src/main/resources/db/migration | grep -E '^[0-9a-f]{40}$' > "$MIG_FILE" || true

python3 - "$OUT" "$commit" "$short" "$branch" "$subject" "$built_at" "$built_by" "$LOG_FILE" "$MIG_FILE" <<'PY'
import io, json, sys

out, commit, short, branch, subject, built_at, built_by, log_file, mig_file = sys.argv[1:10]
log = io.open(log_file, encoding="utf-8", errors="replace").read()
try:
    mig = set(io.open(mig_file, encoding="utf-8").read().split())
except FileNotFoundError:
    mig = set()

history = []
for rec in log.split("\x1e"):
    rec = rec.strip("\n")
    if not rec:
        continue
    parts = rec.split("\x1f")
    if len(parts) < 5:
        continue
    h, sh, subj, author, date = parts[:5]
    history.append({
        "commit": h, "shortCommit": sh, "subject": subj,
        "author": author, "date": date, "migration": h in mig,
    })

io.open(out, "w", encoding="utf-8").write(json.dumps({
    "commit": commit, "shortCommit": short, "branch": branch, "subject": subject,
    "builtAt": built_at, "builtBy": built_by, "history": history,
}, ensure_ascii=False, indent=1))
print("build-info.json: %s (%s), коммитов в истории: %d, из них с миграциями: %d"
      % (short, branch, len(history), sum(1 for c in history if c["migration"])))
PY

if [ "${1:-}" = "--info-only" ]; then
  exit 0
fi

docker compose -f docker-compose.yml -f docker-compose.server.yml build app-prod
echo "Образ собран из $short ($branch)"
