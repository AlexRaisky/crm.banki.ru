-- Подключение к Jira (Data Center) и карта полей.
--
-- Строка одна: панель ходит в одну Jira под одной сервисной учёткой. Токен лежит рядом
-- с адресом — как пароли в app.db_connection; наружу он не отдаётся ни в одном ответе.
--
-- field_map и value_map заполняются НЕ руками. Поля в Jira DC называются
-- customfield_12345, и угадать их снаружи нельзя — их отдаёт сам сервер (createmeta).
-- Панель читает createmeta, сопоставляет по видимому имени («Канал», «Заказчик») и
-- складывает результат сюда. Ручная правка остаётся на случай, когда имена разошлись.
CREATE TABLE IF NOT EXISTS app.jira_connection (
    id              bigint      PRIMARY KEY DEFAULT 1,
    base_url        text        NOT NULL DEFAULT '',   -- https://jira.banki.ru
    token           text,                              -- personal access token, наружу не отдаётся
    project_key     varchar(40) NOT NULL DEFAULT '',   -- CRM
    issue_type      varchar(80) NOT NULL DEFAULT '',   -- CRM-Промо
    default_labels  text        NOT NULL DEFAULT '',   -- метки через запятую: crm_retention
    field_map       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- наш ключ -> id поля Jira
    value_map       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- наш ключ -> {наше значение: значение Jira}

    -- результат последней проверки связи
    last_status     varchar(20),
    last_error      text,
    last_checked_at timestamptz,

    timestamp_upd   timestamptz NOT NULL DEFAULT now(),
    updated_by      varchar(200),
    CONSTRAINT chk_jira_single_row CHECK (id = 1)
);

INSERT INTO app.jira_connection (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE  app.jira_connection IS 'Подключение к Jira DC: адрес, токен сервисной учётки, проект и карта полей';
COMMENT ON COLUMN app.jira_connection.field_map IS 'наш ключ (channel, customer, …) -> id поля Jira (customfield_12345)';
COMMENT ON COLUMN app.jira_connection.value_map IS 'наш ключ -> соответствие «наше значение: значение в Jira»';
