-- Доливка текстов согласования в notice.d_com_sms_approved_template.
--
-- Строки там уже есть (шаблоны перелиты все), но колонка "template" у части из них
-- пустая. Заполняем её разложением msg_text по правилам сотовых операторов. Строки
-- с уже заполненным текстом НЕ трогаем: рядом лежат флаги approved_*, и переписать
-- текст под проставленным согласованием значило бы выдать за согласованное то, чего
-- оператор не видел.
--
-- Тот же файл гоняет репетиция (scripts/sms-approved-rehearsal.sh) — по копиям
-- таблиц в нашей базе. Поэтому имена таблиц вынесены в переменные: один скрипт,
-- одно выражение, и репетиция проверяет ровно то, что потом поедет в бой.
--
-- Запуск:
--   сухой прогон   bash scripts/notice-psql.sh scripts/sms-approved-backfill.sql
--   применение     bash scripts/notice-psql.sh scripts/sms-approved-backfill.sql -v apply=1

\set ON_ERROR_STOP on

\if :{?approved_table} \else \set approved_table 'notice.d_com_sms_approved_template' \endif
\if :{?sms_table}      \else \set sms_table      'notice.d_com_sms_template'          \endif

-- --------------------------------------------------------------------------
-- Разложение — временная функция, а не выражение, скопированное в каждый запрос:
-- ниже оно нужно пять раз, и пять копий однажды разъехались бы. Функция живёт
-- в pg_temp, то есть только внутри этого соединения: в базе после выхода ничего
-- не остаётся, и особых прав на её создание не нужно.
--
-- Три замены, и порядок здесь несущий.
--
--   1) ##любая_переменная##  -> %w
--      В значения переменных не смотрим: по имени содержимое не угадать, а %w
--      покрывает и буквы, и цифры, и спецсимволы, то есть верен в любом случае.
--      Имя переменной — что угодно, кроме решётки и управляющих символов: в живых
--      шаблонах встречаются и кириллица, и пробелы внутри имени (##Продукт##,
--      ##Наименование партнера##). Латиницей список ограничивать нельзя — такие
--      переменные оставались неразобранными и уезжали оператору как есть.
--
--   1a) [link] и подобное   -> %w
--      Третья конвенция записи переменной, 89 шаблонов. Шаблон намеренно узкий —
--      только латинское слово в скобках: квадратные скобки встречаются и как
--      обычная пунктуация, и стирать всё подряд между ними нельзя.
--
--   2) ссылка целиком        -> %w
--      Ссылкой считается и https://…, и www…, и голый домен с путём вида
--      banki.ru/q/32RhjA8. Хвост пути обязан кончаться буквой, цифрой или слешем —
--      иначе точка в конце предложения уезжала бы внутрь переменной.
--      Ссылки идут ДО чисел: иначе цифры внутри адреса стали бы %d и ссылка
--      перестала бы опознаваться.
--
--   3) числа, кроме дат      -> %d
--      Дату отсекают ограничители: числу нельзя стоять сразу после цифры, точки
--      или дефиса и нельзя иметь такую же группу после себя. Поэтому 12.05.2026
--      и 2026-05-12 остаются как есть, а 1500 и 4821 становятся %d.
--      Цена решения: сумма с точкой как разделителем (1500.50) тоже принята за
--      дату и останется текстом. В русских смс разделитель обычно запятая,
--      а 1500,50 разбирается правильно.
--
-- Выпускаем ТОЛЬКО одиночные %w и %d — ни %w+, ни %w{1,n}, ни %d+. Поэтому два
-- запрета операторов (на %w+ и на две групповые переменные подряд) нарушить нечем,
-- и остаётся один предел: не больше двадцати переменных на шаблон.
--
-- Второй экземпляр этого выражения живёт в ProdDbService.SMS_APPROVED_EXPR — он
-- заполняет строку при заведении нового шаблона. Менять их можно только вместе.
-- --------------------------------------------------------------------------

CREATE FUNCTION pg_temp.sms_tpl(msg text) RETURNS text AS $fn$
    -- Текст, уже написанный в операторском виде, разбирать повторно НЕЛЬЗЯ: правило
    -- чисел съедает границы квантификатора и превращает %w{1,3} в %w{%d}. Такой
    -- текст берём как есть — его уже написал человек, и наше дело его не портить.
    SELECT CASE
        WHEN coalesce($1, '') ~ '%[wd]' THEN $1
        ELSE regexp_replace(
                 regexp_replace(
                     regexp_replace(regexp_replace(coalesce($1, ''),
                         '##[^#[:cntrl:]]+##', '%w', 'g'),
                         '\[[A-Za-z_][A-Za-z0-9_]*\]', '%w', 'g'),
                     '(https?://)?(www\.)?[A-Za-z0-9][A-Za-z0-9-]*\.(ru|com|net|org|su|рф)(/[^[:space:]]*[A-Za-z0-9/])?', '%w', 'g'),
                 '(?<![0-9.-])[0-9]+(,[0-9]+)?(?![0-9]*[.-][0-9])', '%d', 'g')
    END
$fn$ LANGUAGE sql IMMUTABLE;

-- Сколько переменных вышло: и %w, и %d, по два символа каждая.
CREATE FUNCTION pg_temp.sms_vars(tpl text) RETURNS int AS $fn$
    SELECT ((length($1) - length(replace(replace($1, '%w', ''), '%d', ''))) / 2)::int
$fn$ LANGUAGE sql IMMUTABLE;

-- Режим проверки одного шаблона: bash scripts/notice-psql.sh … -v probe=273
-- Показывает, что разложение делает с конкретным текстом, и ничего больше.
\if :{?probe}
\echo ''
\echo '=== Проверка одного шаблона ==='

SELECT t.id, t.code,
       t.msg_text                                     AS "было",
       pg_temp.sms_tpl(t.msg_text)                    AS "станет",
       (pg_temp.sms_tpl(t.msg_text) = t.msg_text)     AS "не изменилось",
       pg_temp.sms_vars(pg_temp.sms_tpl(t.msg_text))  AS "переменных"
FROM :sms_table t
WHERE t.code = :probe OR t.id = :probe;

\echo ''
\echo 'Это только разложение исходного текста. Что сейчас лежит в таблице согласований:'

SELECT a.template_id,
       coalesce(a."template", '') = '' AS "пусто",
       a."template"                    AS "лежит сейчас"
FROM :approved_table a
JOIN :sms_table t ON t.id = a.template_id
WHERE t.code = :probe OR t.id = :probe;

\else

\echo ''
\echo '=== 1. Что будет заполнено (первые 40 строк) ==='

SELECT t.code,
       left(t.msg_text, 66)                 AS "было",
       left(pg_temp.sms_tpl(t.msg_text), 66) AS "станет"
FROM :approved_table a
JOIN :sms_table t ON t.id = a.template_id
WHERE coalesce(a."template", '') = ''
  AND pg_temp.sms_tpl(t.msg_text) <> ''
  AND pg_temp.sms_vars(pg_temp.sms_tpl(t.msg_text)) <= 20
ORDER BY t.code
LIMIT 40;

\echo ''
\echo '=== 2. Пропускаем: переменных больше двадцати (пишет человек) ==='

SELECT t.code,
       pg_temp.sms_vars(pg_temp.sms_tpl(t.msg_text)) AS "переменных",
       left(pg_temp.sms_tpl(t.msg_text), 90)          AS "текст"
FROM :approved_table a
JOIN :sms_table t ON t.id = a.template_id
WHERE coalesce(a."template", '') = ''
  AND pg_temp.sms_vars(pg_temp.sms_tpl(t.msg_text)) > 20
ORDER BY 2 DESC;

\echo ''
\echo '=== 3. Требуют глаз: знак процента в тексте ==='
\echo '    единственное место, где литерал совпадает с синтаксисом переменной'

SELECT t.code, left(t.msg_text, 90) AS "текст"
FROM :approved_table a
JOIN :sms_table t ON t.id = a.template_id
WHERE coalesce(a."template", '') = ''
  AND t.msg_text LIKE '%\%%'
ORDER BY t.code
LIMIT 20;

\echo ''
\echo '=== 4. Что останется пустым и почему ==='

SELECT CASE
         WHEN t.id IS NULL                                             THEN 'нет шаблона по template_id'
         WHEN coalesce(t.msg_text, '') = ''                            THEN 'у шаблона пустой msg_text'
         WHEN pg_temp.sms_vars(pg_temp.sms_tpl(t.msg_text)) > 20       THEN 'переменных больше двадцати'
         ELSE 'заполнится'
       END AS "причина",
       count(*) AS "строк"
FROM :approved_table a
LEFT JOIN :sms_table t ON t.id = a.template_id
WHERE coalesce(a."template", '') = ''
GROUP BY 1
ORDER BY 2 DESC;

\if :{?apply}
\echo ''
\echo '=== ПРИМЕНЯЮ ==='

BEGIN;

UPDATE :approved_table a
SET "template" = pg_temp.sms_tpl(t.msg_text)
FROM :sms_table t
WHERE t.id = a.template_id
  AND coalesce(a."template", '') = ''
  AND pg_temp.sms_tpl(t.msg_text) <> ''
  AND pg_temp.sms_vars(pg_temp.sms_tpl(t.msg_text)) <= 20;

COMMIT;

\echo 'Готово. Осталось пустых:'
SELECT count(*) FROM :approved_table WHERE coalesce("template", '') = '';
\else
\echo ''
\echo 'Это сухой прогон. Чтобы применить, повтори с  -v apply=1'
\endif

\endif
