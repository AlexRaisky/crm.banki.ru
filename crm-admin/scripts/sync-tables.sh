#!/usr/bin/env bash
#
# Перенос таблиц между контурами: создать в приёмнике то, чего в нём нет, а в источнике есть.
#
# Зачем. Таблицы Flyway едут вместе с кодом и на всех контурах одинаковы. А таблицы,
# заведённые через конструктор схем, создаются DDL-ом в работающем приложении и остаются
# только там, где их завели: на тесте они есть, на проде их нет, и никакая раскатка их
# туда не привезёт.
#
# Что делает:
#   1) сверяет версию Flyway в обеих базах — если они разошлись, дальше идти нельзя:
#      руками созданная таблица разъедется с миграцией, которая её же создаст;
#   2) показывает разницу и по умолчанию НИЧЕГО не меняет;
#   3) с --apply создаёт недостающие схемы и таблицы структурой (данные — отдельным флагом).
#
# Запуск (с сервера, каталог значения не имеет):
#   bash scripts/sync-tables.sh test prod                                # только показать
#   bash scripts/sync-tables.sh test prod --apply                        # создать пустыми
#   bash scripts/sync-tables.sh test prod --apply --with-data reference  # и залить данные
#
# --with-data принимает список схем через запятую: справочник без строк бесполезен, а
# рабочие таблицы копировать с теста на прод нельзя — там свои данные.
set -euo pipefail

SRC="${1:-test}"
DST="${2:-prod}"
shift 2 || true

APPLY=0
DATA_SCHEMAS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)     APPLY=1 ;;
    --with-data) DATA_SCHEMAS="${2:-}"; shift ;;
    *) echo "Неизвестный аргумент: $1"; exit 2 ;;
  esac
  shift
done

DB_USER="${DB_USER:-crm}"
DB_NAME="${DB_NAME:-crm}"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# Без -i и с закрытым stdin намеренно: внутри цикла «читаем список — создаём схему»
# docker exec -i вычитывает ВЕСЬ оставшийся ввод цикла, и создаётся только первая схема,
# а остальные молча теряются. Дамп подаётся отдельным вызовом, ему -i и нужен.
psql_src() { docker exec "crm-admin-db-$SRC" psql -qtAX -U "$DB_USER" -d "$DB_NAME" "$@" </dev/null; }
psql_dst() { docker exec "crm-admin-db-$DST" psql -qtAX -U "$DB_USER" -d "$DB_NAME" "$@" </dev/null; }

for c in "$SRC" "$DST"; do
  docker inspect "crm-admin-db-$c" >/dev/null 2>&1 || { echo "Нет контейнера crm-admin-db-$c"; exit 1; }
done
[ "$SRC" = "$DST" ] && { echo "Источник и приёмник совпадают"; exit 1; }

# ------------------------------------------------------------------ версии схемы
say "Версия Flyway"
V_SRC="$(psql_src -c "SELECT max(version::numeric) FROM app.flyway_schema_history WHERE success" || echo "")"
V_DST="$(psql_dst -c "SELECT max(version::numeric) FROM app.flyway_schema_history WHERE success" || echo "")"
echo "$SRC: ${V_SRC:-?}   $DST: ${V_DST:-?}"
if [ "$V_SRC" != "$V_DST" ]; then
  echo
  echo "Версии схемы разошлись. Сначала раскатайте код на оба контура — часть таблиц"
  echo "приедет миграциями сама, и переносить их руками не нужно."
  exit 1
fi

# ------------------------------------------------------------------ разница
LIST_SQL="SELECT table_schema || '.' || table_name
            FROM information_schema.tables
           WHERE table_type = 'BASE TABLE'
             AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY 1"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_src -c "$LIST_SQL" | sed '/^$/d' | sort > "$TMP/src.txt"
psql_dst -c "$LIST_SQL" | sed '/^$/d' | sort > "$TMP/dst.txt"
comm -23 "$TMP/src.txt" "$TMP/dst.txt" > "$TMP/missing.txt"
comm -13 "$TMP/src.txt" "$TMP/dst.txt" > "$TMP/extra.txt"

say "Есть на $SRC, нет на $DST"
if [ -s "$TMP/missing.txt" ]; then cat "$TMP/missing.txt"; else echo "(таких нет)"; fi

if [ -s "$TMP/extra.txt" ]; then
  say "Есть на $DST, нет на $SRC — их не трогаем"
  cat "$TMP/extra.txt"
fi

[ -s "$TMP/missing.txt" ] || { echo; echo "Переносить нечего."; exit 0; }

if [ "$APPLY" != "1" ]; then
  echo
  echo "Показан план. Чтобы создать перечисленное на $DST, повторите с --apply"
  echo "(и --with-data <схемы через запятую>, если нужны и строки)."
  exit 0
fi

# ------------------------------------------------------------------ перенос
say "Создаю схемы"
awk -F. '{print $1}' "$TMP/missing.txt" | sort -u > "$TMP/schemas.txt"
while read -r s; do
  [ -n "$s" ] || continue
  echo "  $s"
  psql_dst -c "CREATE SCHEMA IF NOT EXISTS \"$s\"" >/dev/null
done < "$TMP/schemas.txt"

say "Снимаю структуру с $SRC"
ARGS=""
while read -r t; do
  [ -n "$t" ] && ARGS="$ARGS -t $t"
done < "$TMP/missing.txt"
# --no-owner: владелец в приёмнике свой; последовательности bigserial pg_dump берёт сам
docker exec "crm-admin-db-$SRC" pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --schema-only --no-owner --no-privileges $ARGS > "$TMP/schema.sql"
echo "  строк в дампе: $(wc -l < "$TMP/schema.sql")"

say "Применяю на $DST"
# Одной транзакцией: сорвалось на середине — не осталось половины таблиц, которые потом
# пришлось бы разбирать руками.
docker exec -i "crm-admin-db-$DST" psql -v ON_ERROR_STOP=1 --single-transaction \
    -U "$DB_USER" -d "$DB_NAME" < "$TMP/schema.sql" > "$TMP/apply.log" 2>&1 || {
  echo "Ошибка применения, последние строки:"; tail -20 "$TMP/apply.log"
  # Самая частая причина — остаток прошлого, упавшего прогона: таблица создалась, а
  # ключи к ней (они идут в конце дампа) — нет. Внешний ключ теперь ссылаться не на что.
  if grep -q "no unique constraint matching given keys" "$TMP/apply.log"; then
    bad_tbl="$(grep -o 'referenced table "[^"]*"' "$TMP/apply.log" | head -1 | sed 's/.*"\(.*\)"/\1/')"
    echo
    echo "Похоже, таблица «$bad_tbl» осталась от прошлого неудачного прогона: сама есть,"
    echo "а первичный ключ до неё не дошёл. Проверьте, что она пуста, удалите и повторите:"
    echo "  docker exec crm-admin-db-$DST psql -U $DB_USER -d $DB_NAME -c \"select count(*) from <схема>.$bad_tbl\""
    echo "  docker exec crm-admin-db-$DST psql -U $DB_USER -d $DB_NAME -c \"drop table <схема>.$bad_tbl cascade\""
  fi
  exit 1;
}
echo "  готово"

if [ -n "$DATA_SCHEMAS" ]; then
  say "Данные схем: $DATA_SCHEMAS"
  DARGS=""
  while read -r t; do
    s="${t%%.*}"
    case ",$DATA_SCHEMAS," in
      *",$s,"*) DARGS="$DARGS -t $t"; echo "  $t" ;;
    esac
  done < "$TMP/missing.txt"
  if [ -n "$DARGS" ]; then
    docker exec "crm-admin-db-$SRC" pg_dump -U "$DB_USER" -d "$DB_NAME" \
        --data-only --no-owner $DARGS > "$TMP/data.sql"
    docker exec -i "crm-admin-db-$DST" psql -v ON_ERROR_STOP=1 --single-transaction \
        -U "$DB_USER" -d "$DB_NAME" < "$TMP/data.sql" > "$TMP/data.log" 2>&1 || {
      echo "Данные не залились, последние строки:"; tail -20 "$TMP/data.log"; exit 1;
    }
    echo "  данные перенесены"
  else
    echo "  ни одна из недостающих таблиц не в этих схемах"
  fi
fi

# ------------------------------------------------------------------ проверка
say "Что осталось различного"
psql_dst -c "$LIST_SQL" | sed '/^$/d' | sort > "$TMP/dst2.txt"
if comm -23 "$TMP/src.txt" "$TMP/dst2.txt" | grep -q .; then
  comm -23 "$TMP/src.txt" "$TMP/dst2.txt"
else
  echo "Ничего: все таблицы $SRC теперь есть и на $DST."
fi

echo
echo "Таблицы перенесены, но модель конструктора — нет: она лежит в базе отдельно."
echo "Чтобы блоки появились в Scheme Builder так же, как на источнике, перенесите её"
echo "пакетом: «Служебное» → «Выкатки» → вкладка «Настройки» → объект «Модель Scheme"
echo "Builder» (выгрузить на $SRC, применить на $DST). Это перезапишет модель приёмника"
echo "целиком, слепок «как было» сохранится сам."
echo
echo "Поштучно то же делается кнопкой «В модель» в инспекторе конструктора — но только"
echo "для схем, блок которых в модели уже есть."
