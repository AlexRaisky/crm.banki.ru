-- Scheme Builder: модель схемы переезжает из файла и localStorage в нашу БД.
--
-- Было: источник истины — settings/schema/crm-schema.json в репозитории, а правки копились
-- черновиком в localStorage браузера. Отсюда два изъяна: двое правят — второй затирает
-- первого молча, и почистил данные браузера — черновик пропал.
--
-- Миграция ТОЛЬКО добавляет таблицы. Существующих не касается: раздел до сих пор работал
-- без сервера, ломать в нём нечего.

-- Текущая модель — ровно одна строка (id = 1). Отдельной таблицы «документов» не заводим:
-- схема у панели одна, а множественность появилась бы на ровном месте.
CREATE TABLE IF NOT EXISTS app.schema_model (
    id            integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    model         jsonb       NOT NULL,
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    timestamp_upd timestamptz NOT NULL DEFAULT now(),   -- он же версия строки
    updated_by    text
);

-- История версий: снимок модели целиком. Снимок дешевле дельт при восстановлении —
-- «вернуть как было» это просто взять строку, а не проигрывать журнал назад.
CREATE TABLE IF NOT EXISTS app.schema_version (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model        jsonb       NOT NULL,
    author       text,
    comment      text,
    timestamp_cr timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_schema_version_ts ON app.schema_version (timestamp_cr DESC);

-- Журнал: кто, что и когда делал. Требование заказчика — вести обязательно.
--
-- Почему своя таблица, а не arch.t_admin_log: тот заточен под построчные правки
-- («физическая таблица, операция, JSON строки»), а здесь операции над МОДЕЛЬЮ, а в
-- будущем и над структурой БД — с выполненным SQL, затронутой схемой и результатом.
-- Колонки под DDL заведены сразу, чтобы потом не мигрировать журнал: пока пишутся
-- только правки модели, sql_text/target_schema остаются пустыми.
--
-- Таблица append-only: ни удаления, ни TTL. Журнал на то и журнал.
CREATE TABLE IF NOT EXISTS app.schema_audit (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    actor         text,                        -- почта учётки
    action        text        NOT NULL,        -- create/update/delete/reorder/move/layout, далее DDL
    target        text,                        -- entity / field / relation / schema / table
    target_id     text,                        -- id сущности, `сущность.поле`, id связи
    payload       jsonb,                       -- что именно записали
    target_schema text,                        -- под будущий DDL
    target_table  text,
    sql_text      text,
    status        text        NOT NULL DEFAULT 'OK',   -- OK / ERROR / REJECTED
    error         text,
    rows_affected bigint,
    env           text,                        -- контур: prod / preprod / test
    took_ms       bigint
);
CREATE INDEX IF NOT EXISTS ix_schema_audit_ts    ON app.schema_audit (timestamp_cr DESC);
CREATE INDEX IF NOT EXISTS ix_schema_audit_actor ON app.schema_audit (actor);
