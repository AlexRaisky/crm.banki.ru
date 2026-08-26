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
# Обе таблицы читаются из notice (только SELECT), кладутся в схему check_sms НАШЕЙ
# базы, и по копиям запускается ТОТ ЖЕ scripts/sms-approved-backfill.sql, что потом
# поедет в бой, — с подменёнными именами таблиц. Свою копию логики репетиция не
# держит намеренно: репетиция по другому коду ничего не доказывает.
#
# Схема check_sms каждый раз пересоздаётся — это черновик, а не данные.
#
# Использование:
#   NOTICE_ENV=prod bash scripts/sms-approved-rehearsal.sh
#
# Читать боевой notice, но ничего не писать в прод-контур:
#   SANDBOX_ENV=test NOTICE_ENV=prod bash scripts/sms-approved-rehearsal.sh
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
. scripts/lib-notice-conn.sh

notice_conn || exit $?
echo "→ читаю из ${NOTICE_ENV_NAME}: ${NOTICE_HOST}:${NOTICE_PORT}/${NOTICE_DB}" >&2
echo "→ пишу в ${SANDBOX_ENV_NAME}, наша база (${OUR_DB_CONTAINER}), схема check_sms" >&2
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

echo >&2
echo "заполняю копию тем же скриптом, что поедет в бой…" >&2

# --------------------------------------------------------------- 3. заполнение копии
our_psql -v approved_table=check_sms.approved \
         -v sms_table=check_sms.sms \
         -v apply=1 < scripts/sms-approved-backfill.sql

echo >&2
echo "Копия осталась в схеме check_sms нашей базы. Посмотреть:" >&2
echo "  docker exec ${OUR_DB_CONTAINER} psql -U ${OUR_DB_USER} -d ${OUR_DB_NAME} -c 'SELECT * FROM check_sms.approved LIMIT 5'" >&2
echo "Убрать:" >&2
echo "  docker exec ${OUR_DB_CONTAINER} psql -U ${OUR_DB_USER} -d ${OUR_DB_NAME} -c 'DROP SCHEMA check_sms CASCADE'" >&2
echo >&2
echo "Если в «что останется пустым» почти всё с причиной «нет шаблона по template_id» —" >&2
echo "значит template_id ссылается не на id, а на code, и это надо поправить" >&2
echo "в ProdDbService.smsApprovedEnsure и в scripts/sms-approved-backfill.sql." >&2
