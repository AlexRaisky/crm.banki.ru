-- Scheme Builder: реестр того, что билдер создал в базе своими руками.
--
-- Зачем отдельный реестр, если есть information_schema: по каталогу Postgres видно, что
-- объект существует, но не видно, КЕМ он заведён. А билдеру можно трогать только своё —
-- иначе однажды он «доведёт до модели» чужую таблицу и снесёт данные. Поэтому право на
-- изменение даёт запись здесь, а не факт наличия объекта в базе.
--
-- Миграция только добавляет таблицу.

CREATE TABLE IF NOT EXISTS app.schema_owned (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schema_name   text        NOT NULL,
    table_name    text,                    -- NULL = запись про саму схему
    env           text        NOT NULL,    -- контур: prod / preprod / test
    created_by    text,
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (schema_name, table_name, env)
);
CREATE INDEX IF NOT EXISTS ix_schema_owned_schema ON app.schema_owned (schema_name);

-- Схемы, которые билдеру запрещено трогать при любых обстоятельствах. Отдельной таблицей,
-- а не константой в коде: список пополняется вместе с базой, и менять его правкой строки
-- проще и безопаснее, чем пересборкой образа. Читается на каждую проверку — таблица
-- крошечная, а цена ошибки высокая.
CREATE TABLE IF NOT EXISTS app.schema_reserved (
    schema_name text PRIMARY KEY,
    reason      text
);

INSERT INTO app.schema_reserved (schema_name, reason) VALUES
    ('app',                'служебные таблицы панели, ими владеет Flyway'),
    ('arch',               'журнал администратора'),
    ('flow',               'слой A: нормализованная модель процесса'),
    ('template',           'единый справочник шаблонов'),
    ('dictionary',         'справочники значений'),
    ('tracker',            'копия прод-схемы'),
    ('scheduler',          'копия прод-схемы'),
    ('commapi',            'копия прод-схемы'),
    ('callcenter',         'копия прод-схемы'),
    ('notice',             'копия прод-схемы'),
    ('public',             'схема по умолчанию: слишком легко засорить'),
    ('information_schema', 'системная'),
    ('pg_catalog',         'системная'),
    ('pg_toast',           'системная')
ON CONFLICT (schema_name) DO NOTHING;
