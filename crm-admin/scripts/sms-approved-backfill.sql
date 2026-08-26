-- Доливка текстов согласования в notice.d_com_sms_approved_template.
--
-- Строки там уже есть (шаблоны перелиты все), но колонка "template" у части из них
-- пустая. Заполняем её разложением msg_text по правилам сотовых операторов. Строки
-- с уже заполненным текстом НЕ трогаем: рядом лежат флаги approved_*, и переписать
-- текст под проставленным согласованием значило бы выдать за согласованное то, чего
-- оператор не видел.
--
-- Разложение — те же две замены, что и в ProdDbService.SMS_APPROVED_EXPR. Меняешь
-- здесь — меняй и там, иначе доливка и заведение новых шаблонов дадут операторам
-- два разных текста под одним согласованием.
--
--   ##любая_переменная##      -> %w
--   banki.ru/q/XXXX           -> banki.ru/q/%w
--
-- Правила (МегаФон через МТС) запрещают %w+ и две групповые переменные подряд —
-- нарушить нечем: выпускаем только одиночные %w. Остаётся предел в двадцать
-- переменных на шаблон: такие строки пропускаем, их пишет человек.
--
-- Запуск:
--   сухой прогон   psql -h <host> -U <user> -d notice -f scripts/sms-approved-backfill.sql
--   применение     psql -h <host> -U <user> -d notice -v apply=1 -f scripts/sms-approved-backfill.sql

\set ON_ERROR_STOP on

\echo ''
\echo '=== 1. Что будет заполнено (первые 40 строк) ==='

WITH src AS (
    SELECT a.id,
           a.template_id,
           t.code,
           t.msg_text,
           regexp_replace(
               regexp_replace(coalesce(t.msg_text, ''), '##[A-Za-z0-9_]+##', '%w', 'g'),
               '(banki\.ru/q/)[A-Za-z0-9]+', '\1%w', 'g') AS tpl
    FROM notice.d_com_sms_approved_template a
    JOIN notice.d_com_sms_template t ON t.id = a.template_id
    WHERE coalesce(a."template", '') = ''
)
SELECT code,
       left(msg_text, 70) AS "было",
       left(tpl, 70)      AS "станет"
FROM src
WHERE tpl <> ''
  AND (length(tpl) - length(replace(tpl, '%w', ''))) / 2 <= 20
ORDER BY code
LIMIT 40;

\echo ''
\echo '=== 2. Пропускаем: переменных больше двадцати (пишет человек) ==='

WITH src AS (
    SELECT t.code,
           regexp_replace(
               regexp_replace(coalesce(t.msg_text, ''), '##[A-Za-z0-9_]+##', '%w', 'g'),
               '(banki\.ru/q/)[A-Za-z0-9]+', '\1%w', 'g') AS tpl
    FROM notice.d_com_sms_approved_template a
    JOIN notice.d_com_sms_template t ON t.id = a.template_id
    WHERE coalesce(a."template", '') = ''
)
SELECT code, (length(tpl) - length(replace(tpl, '%w', ''))) / 2 AS "переменных", left(tpl, 90) AS "текст"
FROM src
WHERE (length(tpl) - length(replace(tpl, '%w', ''))) / 2 > 20
ORDER BY 2 DESC;

\echo ''
\echo '=== 3. Требуют глаз: в тексте есть знак процента ==='
\echo '    Это единственное место, где литерал совпадает с синтаксисом переменной.'

SELECT t.code, left(t.msg_text, 90) AS "текст"
FROM notice.d_com_sms_approved_template a
JOIN notice.d_com_sms_template t ON t.id = a.template_id
WHERE coalesce(a."template", '') = ''
  AND t.msg_text LIKE '%\%%'
ORDER BY t.code;

\echo ''
\echo '=== 4. Сводка ==='

SELECT count(*)                                                          AS "пустых всего",
       count(*) FILTER (WHERE coalesce(t.msg_text, '') = '')             AS "без текста",
       count(*) FILTER (WHERE t.msg_text LIKE '%##%')                    AS "с переменными",
       count(*) FILTER (WHERE t.msg_text LIKE '%banki.ru/q/%')           AS "с короткой ссылкой"
FROM notice.d_com_sms_approved_template a
JOIN notice.d_com_sms_template t ON t.id = a.template_id
WHERE coalesce(a."template", '') = '';

\if :{?apply}
\echo ''
\echo '=== ПРИМЕНЯЮ ==='

BEGIN;

UPDATE notice.d_com_sms_approved_template a
SET "template" = s.tpl
FROM (
    SELECT a2.id,
           regexp_replace(
               regexp_replace(coalesce(t.msg_text, ''), '##[A-Za-z0-9_]+##', '%w', 'g'),
               '(banki\.ru/q/)[A-Za-z0-9]+', '\1%w', 'g') AS tpl
    FROM notice.d_com_sms_approved_template a2
    JOIN notice.d_com_sms_template t ON t.id = a2.template_id
    WHERE coalesce(a2."template", '') = ''
) s
WHERE a.id = s.id
  AND s.tpl <> ''
  AND (length(s.tpl) - length(replace(s.tpl, '%w', ''))) / 2 <= 20;

COMMIT;

\echo 'Готово. Осталось пустых:'
SELECT count(*) FROM notice.d_com_sms_approved_template WHERE coalesce("template", '') = '';
\else
\echo ''
\echo 'Это сухой прогон. Чтобы применить, повтори с  -v apply=1'
\endif
