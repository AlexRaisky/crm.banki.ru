#!/usr/bin/env bash
#
# Репетиция заполнения notice.d_com_sms_approved_template — на настоящих текстах,
# но в нашей базе и без единой записи в notice.
#
# Зачем так. Проверять разложение прямо в боевой таблице нельзя: рядом с текстом
# лежат флаги согласования с операторами, и неудачная попытка означает не «откатим»,
# а «оператор увидел не то». Проверять на выдуманных текстах бессмысленно: вся
# сложность как раз в том, что реально пишут в смс.
#
# Поэтому: обе таблицы читаются из notice (только SELECT), кладутся в схему
# check_sms НАШЕЙ базы, и заполнение прогоняется уже там. В notice не уходит ничего.
#
# Схема check_sms каждый раз пересоздаётся — это черновик, а не данные.
#
# Использование:
#   NOTICE_ENV=prod bash scripts/sms-approved-rehearsal.sh
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
. scripts/lib-notice-conn.sh

notice_conn || exit $?
echo "→ читаю из ${NOTICE_ENV_NAME}: ${NOTICE_HOST}:${NOTICE_PORT}/${NOTICE_DB}" >&2
echo "→ пишу в нашу базу того же контура (${OUR_DB_CONTAINER}), схема check_sms" >&2
echo >&2

# --------------------------------------------------------------- 1. песочница
# Типы намеренно широкие: точная форма approved_* нам не важна, важно, что копия
# принимает всё, что отдаст боевая таблица, и ни на чём не спотыкается.
our_psql -q <<'SQL' || exit 1
DROP SCHEMA IF EXISTS check_sms CASCADE;
CREATE SCHEMA check_sms;
CREATE TABLE check_sms.approved (
    id                          bigint,
    template_id                 bigint,
    "template"                  text,
    business_communication_type text,
    approved_mts                text,
    approved_megafon            text,
    approved_beeline            text,
    approved_t2                 text
);
CREATE TABLE check_sms.sms (
    id                          bigint,
    code                        bigint,
    msg_text                    text,
    business_communication_type text
);
SQL

# --------------------------------------------------------------- 2. перенос данных
# COPY ... TO STDOUT из notice прямо в COPY ... FROM STDIN нашей базы: без временных
# файлов и без загрузки таблицы в память шелла.
echo "переношу notice.d_com_sms_approved_template…" >&2
notice_psql -q -c "COPY (SELECT id, template_id, \"template\", business_communication_type,
                                approved_mts::text, approved_megafon::text,
                                approved_beeline::text, approved_t2::text
                         FROM notice.d_com_sms_approved_template) TO STDOUT" </dev/null \
  | our_psql -q -c "COPY check_sms.approved FROM STDIN" || exit 1

echo "переношу notice.d_com_sms_template…" >&2
notice_psql -q -c "COPY (SELECT id, code, msg_text, business_communication_type
                         FROM notice.d_com_sms_template) TO STDOUT" </dev/null \
  | our_psql -q -c "COPY check_sms.sms FROM STDIN" || exit 1

# --------------------------------------------------------------- 3. заполнение копии
# Выражение — то же, что в ProdDbService.SMS_APPROVED_EXPR и в
# scripts/sms-approved-backfill.sql. Если оно здесь другое — репетиция врёт.
our_psql <<'SQL'
\echo ''
\echo '=== Что в копии до заполнения ==='
SELECT count(*) AS "строк всего",
       count(*) FILTER (WHERE coalesce("template", '') = '') AS "с пустым текстом"
FROM check_sms.approved;

UPDATE check_sms.approved a
SET "template" = s.tpl
FROM (
    SELECT a2.id,
           regexp_replace(
               regexp_replace(coalesce(t.msg_text, ''), '##[A-Za-z0-9_]+##', '%w', 'g'),
               '(banki\.ru/q/)[A-Za-z0-9]+', '\1%w', 'g') AS tpl
    FROM check_sms.approved a2
    JOIN check_sms.sms t ON t.id = a2.template_id
    WHERE coalesce(a2."template", '') = ''
) s
WHERE a.id = s.id
  AND s.tpl <> ''
  AND (length(s.tpl) - length(replace(s.tpl, '%w', ''))) / 2 <= 20;

\echo ''
\echo '=== Что получилось (20 строк с переменными) ==='
SELECT t.code, left(t.msg_text, 62) AS "было", left(a."template", 62) AS "стало"
FROM check_sms.approved a JOIN check_sms.sms t ON t.id = a.template_id
WHERE a."template" LIKE '%\%w%'
ORDER BY t.code LIMIT 20;

\echo ''
\echo '=== Осталось пустым и почему ==='
SELECT CASE
         WHEN coalesce(t.id, 0) = 0                                  THEN 'нет шаблона по template_id'
         WHEN coalesce(t.msg_text, '') = ''                          THEN 'у шаблона пустой msg_text'
         ELSE 'переменных больше двадцати'
       END AS "причина",
       count(*) AS "строк"
FROM check_sms.approved a LEFT JOIN check_sms.sms t ON t.id = a.template_id
WHERE coalesce(a."template", '') = ''
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== Требуют глаз: знак процента в тексте ==='
\echo '    единственное место, где литерал совпадает с синтаксисом переменной'
SELECT t.code, left(t.msg_text, 80) AS "текст"
FROM check_sms.approved a JOIN check_sms.sms t ON t.id = a.template_id
WHERE t.msg_text LIKE '%\%%' ORDER BY t.code LIMIT 15;

\echo ''
\echo '=== Итог ==='
SELECT count(*) FILTER (WHERE coalesce("template", '') <> '') AS "заполнено",
       count(*) FILTER (WHERE coalesce("template", '') = '')  AS "осталось пустых"
FROM check_sms.approved;
SQL

echo >&2
echo "Копия осталась в схеме check_sms нашей базы. Посмотреть:" >&2
echo "  docker exec ${OUR_DB_CONTAINER} psql -U ${OUR_DB_USER} -d ${OUR_DB_NAME} -c 'SELECT * FROM check_sms.approved LIMIT 5'" >&2
echo "Убрать:" >&2
echo "  docker exec ${OUR_DB_CONTAINER} psql -U ${OUR_DB_USER} -d ${OUR_DB_NAME} -c 'DROP SCHEMA check_sms CASCADE'" >&2
echo >&2
echo "Если в «осталось пустым» почти всё с причиной «нет шаблона по template_id» —" >&2
echo "значит template_id ссылается не на id, а на code, и это надо поправить" >&2
echo "в ProdDbService.smsApprovedEnsure и в scripts/sms-approved-backfill.sql." >&2
