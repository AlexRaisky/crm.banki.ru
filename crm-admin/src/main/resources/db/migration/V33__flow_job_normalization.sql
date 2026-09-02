-- Нормализация расписаний и шагов (слой A).
--
-- Исходные прод-таблицы scheduler.t_launch_settings и scheduler.t_execution_steps держат
-- в одной строке три разные вещи: настройку, которую задаёт человек; поля, которые
-- вычисляет планировщик; и состояние текущего прогона. Из-за этого запись планировщика
-- физически может затереть настройку, а история не хранится вовсе — статус
-- перезаписывается, и вчерашняя ошибка исчезает, как только начался сегодняшний прогон.
--
-- Здесь разводим их по владельцу:
--   d_event_schedule, d_event_step  — конфигурация, пишем мы;
--   t_event_state                   — состояние, зеркалим из прода;
--   t_event_run, t_event_step_run   — история, ничего не затирается.

-- ---------------------------------------------------------------- справочник баз
-- database был свободной строкой: опечатка означала, что задание не запустится, и
-- узнали бы об этом постфактум. Наполняем справочник тем, что уже встречается в данных,
-- и только потом вешаем ключ — так миграция не потеряет ни одной строки.
CREATE TABLE IF NOT EXISTS flow.d_database (
    code        varchar(255) PRIMARY KEY,
    description varchar(255)
);

INSERT INTO flow.d_database (code, description)
VALUES ('crmdb', 'База CRM по умолчанию')
ON CONFLICT (code) DO NOTHING;

INSERT INTO flow.d_database (code)
SELECT DISTINCT database FROM flow.d_event_schedule
 WHERE database IS NOT NULL AND database <> ''
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'd_event_schedule_database_fk') THEN
        ALTER TABLE flow.d_event_schedule
            ADD CONSTRAINT d_event_schedule_database_fk
            FOREIGN KEY (database) REFERENCES flow.d_database (code);
    END IF;
END $$;

-- ------------------------------------------------- расписание: только то, что задаём
-- time_start, period_unit, period_q, date_start, date_end заполняет планировщик по
-- кронтабу. Держать их в конфигурации значит хранить копию чужого расчёта, которая
-- устаревает при первом же тике. Мы в них и не писали никогда (MaterializationService
-- заполняет только crontab, database, is_batch), так что данных не теряем.
ALTER TABLE flow.d_event_schedule
    DROP COLUMN IF EXISTS time_start,
    DROP COLUMN IF EXISTS period_unit,
    DROP COLUMN IF EXISTS period_q,
    DROP COLUMN IF EXISTS date_start,
    DROP COLUMN IF EXISTS date_end;

-- ------------------------------------------------------- шаги: порядок обязан быть один
-- Без уникальности два шага могут получить один order_num, и тогда очередь исполнения
-- не определена — что первым вернёт база, то и выполнится. Перед тем как вешать ключ,
-- перенумеровываем задвоенные: строки сохраняются, меняется только порядковый номер.
WITH renumbered AS (
    SELECT id,
           row_number() OVER (PARTITION BY event_id ORDER BY order_num, id) AS n
      FROM flow.d_event_step
)
UPDATE flow.d_event_step s
   SET order_num = r.n
  FROM renumbered r
 WHERE r.id = s.id AND s.order_num <> r.n;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'd_event_step_order_uq') THEN
        ALTER TABLE flow.d_event_step
            ADD CONSTRAINT d_event_step_order_uq UNIQUE (event_id, order_num);
    END IF;
END $$;

-- ------------------------------------------------------------ состояние планировщика
-- Один к одному с событием. Пишет сюда не человек, а ETL: забирает из прода то, что
-- насчитал планировщик. Отдельно от конфигурации по двум причинам — разные владельцы
-- (наша настройка против чужого расчёта) и разный срок жизни (правится раз в месяц
-- против каждого тика).
--
-- Имена сознательно не повторяют прод: там три колонки со словом status, и по названию
-- не отличить фазу от исхода.
--   status           -> phase       NEW | WAITING | PROCESSING — где задание сейчас
--   cron_status      -> cron_state  STARTED | STOPPED          — знает ли о нём крон
--   last_exec_status -> last_result SUCCESS | ERROR            — чем кончился прошлый прогон
CREATE TABLE IF NOT EXISTS flow.t_event_state (
    event_id      bigint PRIMARY KEY REFERENCES flow.d_event (id) ON DELETE CASCADE,
    phase         varchar(16),
    cron_state    varchar(16),
    last_result   varchar(16),
    date_next     timestamptz,
    -- то, что планировщик вычислил из кронтаба: показываем, но не задаём
    time_start    timestamptz,
    period_unit   varchar(6),
    period_q      integer,
    date_start    timestamptz,
    date_end      timestamptz,
    -- когда мы это состояние забрали: без метки непонятно, свежее оно или недельной давности
    synced_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT t_event_state_phase_chk       CHECK (phase       IS NULL OR phase       IN ('NEW', 'WAITING', 'PROCESSING')),
    CONSTRAINT t_event_state_cron_chk        CHECK (cron_state  IS NULL OR cron_state  IN ('STARTED', 'STOPPED')),
    CONSTRAINT t_event_state_last_result_chk CHECK (last_result IS NULL OR last_result IN ('SUCCESS', 'ERROR'))
);

COMMENT ON TABLE flow.t_event_state IS
    'Состояние задания глазами прод-планировщика. Наполняется ETL, руками не правится.';

-- Расхождение «мы включили, а крон не знает» — самый частый способ завести задание,
-- которое никогда не сработает. Индекс на пару, чтобы такой список строился сразу.
CREATE INDEX IF NOT EXISTS t_event_state_cron_idx ON flow.t_event_state (cron_state, phase);

-- ------------------------------------------------------------------------- история
-- Прогон задания. В проде истории нет вовсе: статус перезаписывается, и на вопрос
-- «сколько раз за неделю падало» ответить нечем. Здесь строка на прогон, ничего не
-- затирается.
--
-- Точность равна частоте опроса ETL: прогон короче интервала мы не увидим. Для
-- «падает или нет» этого достаточно, для точной длительности — нет; чтобы было точно,
-- писать историю должен сам планировщик, а это правка прод-компонента.
CREATE TABLE IF NOT EXISTS flow.t_event_run (
    id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    event_id    bigint NOT NULL REFERENCES flow.d_event (id) ON DELETE CASCADE,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    result      varchar(16),
    error       varchar,
    attempt     integer NOT NULL DEFAULT 1,
    CONSTRAINT t_event_run_result_chk CHECK (result IS NULL OR result IN ('SUCCESS', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS t_event_run_event_idx ON flow.t_event_run (event_id, started_at DESC);

-- Прогон шага уже был (V6) — дотягиваем до той же модели: привязка к прогону задания,
-- счётчик повторов и проверка статуса. run_id nullable: строки, записанные до этой
-- миграции, к прогону не привязаны, и терять их незачем.
ALTER TABLE flow.t_event_step_run
    ADD COLUMN IF NOT EXISTS run_id      bigint REFERENCES flow.t_event_run (id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS retry_count integer;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 't_event_step_run_status_chk') THEN
        ALTER TABLE flow.t_event_step_run
            ADD CONSTRAINT t_event_step_run_status_chk
            CHECK (status IS NULL OR status IN ('SUCCESS', 'ERROR'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS t_event_step_run_step_idx ON flow.t_event_step_run (step_id, started_at DESC);
CREATE INDEX IF NOT EXISTS t_event_step_run_run_idx  ON flow.t_event_step_run (run_id);
