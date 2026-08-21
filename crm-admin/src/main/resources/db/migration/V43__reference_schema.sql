-- Справочники значений форм переезжают из dictionary в reference:
-- d_communication_name и d_touch_point.
--
-- Переносим SET SCHEMA, а не «создать и скопировать»: так за таблицей уезжают её данные,
-- индексы, ограничения и счётчик identity, и не появляется момента, когда одни и те же
-- значения лежат в двух местах и расходятся.
--
-- Проверки через to_regclass, а не ON CONFLICT/исключения: в Postgres любая ошибка внутри
-- транзакции метит её на откат целиком, поэтому «попробовать и поймать» здесь стоило бы
-- всей миграции.
CREATE SCHEMA IF NOT EXISTS reference;

DO $$
BEGIN
    IF to_regclass('dictionary.d_communication_name') IS NOT NULL
       AND to_regclass('reference.d_communication_name') IS NULL THEN
        ALTER TABLE dictionary.d_communication_name SET SCHEMA reference;
    END IF;

    IF to_regclass('dictionary.d_touch_point') IS NOT NULL
       AND to_regclass('reference.d_touch_point') IS NULL THEN
        ALTER TABLE dictionary.d_touch_point SET SCHEMA reference;
    END IF;
END $$;

-- Совместимость на время переезда: под прежними именами остаются представления, поэтому
-- контур, который ещё работает на предыдущей версии кода (или запрос из DBeaver, набранный
-- по памяти), продолжает читать справочники как раньше. Представления автообновляемые —
-- запись в них тоже дойдёт до таблицы. Убрать их можно, когда все три контура поедут на
-- новом коде; отдельной миграцией, чтобы это было видимым решением, а не побочным эффектом.
DO $$
BEGIN
    IF to_regclass('reference.d_communication_name') IS NOT NULL
       AND to_regclass('dictionary.d_communication_name') IS NULL THEN
        CREATE VIEW dictionary.d_communication_name AS
            SELECT * FROM reference.d_communication_name;
        COMMENT ON VIEW dictionary.d_communication_name IS
            'Переехало в reference.d_communication_name (V43); представление — временная совместимость.';
    END IF;

    IF to_regclass('reference.d_touch_point') IS NOT NULL
       AND to_regclass('dictionary.d_touch_point') IS NULL THEN
        CREATE VIEW dictionary.d_touch_point AS
            SELECT * FROM reference.d_touch_point;
        COMMENT ON VIEW dictionary.d_touch_point IS
            'Переехало в reference.d_touch_point (V43); представление — временная совместимость.';
    END IF;
END $$;

-- Схема со справочниками — не место для экспериментов Scheme Builder, как и dictionary.
INSERT INTO app.schema_reserved (schema_name, reason) VALUES
    ('reference', 'справочники значений')
ON CONFLICT (schema_name) DO NOTHING;
