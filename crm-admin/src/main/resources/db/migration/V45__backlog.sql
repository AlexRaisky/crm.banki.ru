-- Бэклог панели: что просили сделать, что в работе и что уже сделано.
--
-- Своя таблица, а не задача в Jira: сюда пишут во время разговора у экрана — «вот это
-- неудобно», «здесь не хватает колонки», — и заводить ради каждой такой строки задачу
-- во внешнем трекере никто не станет. Что дозреет до работы, оттуда и переедет в Jira.
--
-- Раздел админский: доступ закрыт целиком (SecurityConfig: /api/admin/** → ROLE_ADMIN),
-- поэтому отдельной секции в матрице прав у него нет.
CREATE TABLE IF NOT EXISTS app.backlog_item (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title         varchar(300) NOT NULL,
    description   text        NOT NULL DEFAULT '',
    -- к чему относится: раздел панели, процесс, отчёт. Свободный текст: список разделов
    -- меняется быстрее, чем справочник, а группировать удобно и по строке.
    area          varchar(120) NOT NULL DEFAULT '',
    priority      varchar(16) NOT NULL DEFAULT 'normal',   -- low / normal / high
    status        varchar(16) NOT NULL DEFAULT 'new',      -- new / in_progress / done / rejected
    assignee      varchar(160) NOT NULL DEFAULT '',
    author        varchar(160) NOT NULL DEFAULT '',
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    timestamp_upd timestamptz NOT NULL DEFAULT now(),
    updated_by    varchar(160)
);

-- Список открывается фильтром по статусу и сортируется по приоритету — под это и индекс.
CREATE INDEX IF NOT EXISTS ix_backlog_status ON app.backlog_item (status, priority, id DESC);
