-- Подключение к планировщику (crm-cron): адрес, токен и выключатель.
--
-- Зачем вообще: события по расписанию исполняет Quartz, и знает он о них не по строке в
-- scheduler.t_launch_settings, а по контексту, который создаёт этот сервис. Панель строку
-- пишет, а контекст не создаёт — значит заведённое ею событие не срабатывает никогда.
-- Миграция V33 это уже предвидела: там заведена flow.t_event_state.cron_state с
-- комментарием «мы включили, а крон не знает» как о самом частом способе завести
-- задание, которое не сработает.
--
-- Три решения, которые важнее колонок.
--
-- ВЫКЛЮЧАТЕЛЬ ПО УМОЛЧАНИЮ ВЫКЛЮЧЕН. Таблица приезжает на все три контура сразу, а
-- боевой планировщик один. Включённая по умолчанию интеграция означала бы, что тест
-- начинает заводить задания в бою в момент выката. Включают её руками и на том контуре,
-- где это осмысленно.
--
-- Токен наружу не отдаётся, как и у app.jira_connection: в ответах панели он заменяется
-- признаком «задан / не задан». Иначе право читать настройки становится правом забрать
-- токен, а это разные вещи.
--
-- Одна строка, id = 1. Планировщик у нас один; таблица на несколько подключений
-- потребовала бы выбирать, в какой из них писать, а выбирать не из чего.
CREATE TABLE IF NOT EXISTS app.cron_connection (
    id              bigint      PRIMARY KEY DEFAULT 1,
    base_url        text        NOT NULL DEFAULT '',   -- https://crm-cron.int.banki.ru
    token           text,                              -- наружу не отдаётся
    enabled         boolean     NOT NULL DEFAULT false,

    -- Умолчания для создаваемых заданий: их спрашивает POST /api/v1/event, а в форме
    -- события таких полей нет и заводить их там незачем — они одинаковы для всех.
    job_group       varchar(64) NOT NULL DEFAULT 'CRM',
    priority        varchar(16) NOT NULL DEFAULT 'LOW',

    -- Чем проверяем связь. Отдельной колонкой, а не константой в коде: какой путь у
    -- сервиса безопасно дёргать «просто посмотреть», знает не панель, а тот, кто его
    -- настраивает. По умолчанию — описание OpenAPI: оно только читает.
    probe_path      text        NOT NULL DEFAULT '/v3/api-docs',

    -- результат последней проверки связи
    last_status     varchar(20),
    last_error      text,
    last_checked_at timestamptz,

    timestamp_upd   timestamptz NOT NULL DEFAULT now(),
    updated_by      varchar(200),
    CONSTRAINT chk_cron_single_row CHECK (id = 1),
    CONSTRAINT chk_cron_priority   CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH'))
);

COMMENT ON TABLE app.cron_connection IS
    'Подключение к планировщику crm-cron. Одна строка, id = 1. Выключатель enabled.';

INSERT INTO app.cron_connection (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Секция настроек: право отдельное от остальных интеграций. Кто настраивает адрес
-- планировщика, тот решает, на какой контур уедут боевые задания, — это не то же самое,
-- что вести справочники.
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT rs.role_id, 'set-cron', rs.can_read, rs.can_add, rs.can_edit, rs.can_delete
FROM app.role_section rs
WHERE rs.section_id = 'set-dbconn' AND rs.can_read
ON CONFLICT DO NOTHING;
