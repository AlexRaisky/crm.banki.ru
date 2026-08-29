-- Правки по описанию API планировщика (/v3/api-docs), полученному после V56.
--
-- 1. ПРИОРИТЕТ. В V56 я записал LOW | MEDIUM | HIGH по памяти. В сервисе значения
--    LOW | NORMAL | HIGH — «MEDIUM» он не примет. Проверку переписываем, а заодно
--    чиним значение, если кто-то успел его выбрать: MEDIUM превращается в NORMAL,
--    это то же самое по смыслу.
ALTER TABLE app.cron_connection DROP CONSTRAINT IF EXISTS chk_cron_priority;
UPDATE app.cron_connection SET priority = 'NORMAL' WHERE priority = 'MEDIUM';
ALTER TABLE app.cron_connection
    ADD CONSTRAINT chk_cron_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH'));

-- 2. СОСТОЯНИЕ ЗАДАНИЯ. flow.t_event_state.cron_state из V33 допускала только
--    STARTED и STOPPED — тогда это было всё, что встречалось в прод-таблице. Ответ
--    планировщика (CrmCronStatusEventDto) знает ещё ERROR и PAUSED, и как только мы
--    начнём зеркалить его ответы, вставка упрётся в ограничение.
--
--    Пустое значение по-прежнему разрешено: «мы у планировщика не спрашивали» — это не
--    то же самое, что «он ответил STOPPED», и путать их нельзя.
ALTER TABLE flow.t_event_state DROP CONSTRAINT IF EXISTS t_event_state_cron_chk;
ALTER TABLE flow.t_event_state
    ADD CONSTRAINT t_event_state_cron_chk
    CHECK (cron_state IS NULL OR cron_state IN ('STARTED', 'STOPPED', 'ERROR', 'PAUSED'));

-- 3. СВЯЗЬ СОБЫТИЯ С ЗАДАНИЕМ ПЛАНИРОВЩИКА.
--
-- Планировщик адресует задание своим id: он приходит в ответе на создание и стоит в
-- пути у stop и start. Без записи этого id панель умеет только заводить задания и
-- никогда — останавливать их: адресовать будет нечем.
--
-- Отдельная таблица, а не колонка в flow.d_event_schedule: здесь не настройка события,
-- а состояние разговора с чужим сервисом — когда обращались, чем он ответил, что
-- сломалось. Класть такое рядом с кронтабом значило бы мешать наше намерение с его
-- ответом, а различать их придётся ровно в тот момент, когда они разойдутся.
--
-- В flow.t_event_link это тоже не ложится: там соответствие наших строк строкам
-- прод-БД, а тут id стороннего сервиса, который в прод-таблицах может и не значиться.
CREATE TABLE IF NOT EXISTS flow.t_event_cron (
    event_id       bigint      PRIMARY KEY REFERENCES flow.d_event (id) ON DELETE CASCADE,
    cron_event_id  bigint      NOT NULL,
    -- что ответил планировщик в последний раз: STARTED | STOPPED | ERROR | PAUSED
    last_status    varchar(16),
    last_error     text,
    last_action    varchar(16),                    -- create | update | stop | start
    last_actor     varchar(200),
    synced_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE flow.t_event_cron IS
    'Соответствие события заданию планировщика crm-cron и результат последнего обращения.';

-- Одно событие — одно задание. Обратное тоже: два наших события, указывающие на одно
-- задание, означали бы, что «остановить» у одного гасит другое.
CREATE UNIQUE INDEX IF NOT EXISTS t_event_cron_job_uq ON flow.t_event_cron (cron_event_id);
