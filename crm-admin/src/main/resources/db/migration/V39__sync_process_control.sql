-- Выключатель процессов перелива.
--
-- До этого остановить их было нечем. Доставка шаблонов в прод крутилась по таймеру
-- всегда, когда настроено подключение; обратный ETL включался свойством
-- app.etl.enabled, то есть только перезапуском приложения; импорт событий гонял цикл
-- в браузере, и «остановить» означало закрыть вкладку. Во время инцидента в проде это
-- ровно то, чего не хватает: перекрыть поток наружу и потом пустить снова.
--
-- Строка на процесс. enabled — оперативный выключатель (переживает перезапуск,
-- в отличие от свойства), stop_requested — просьба текущему прогону закончиться
-- на ближайшей безопасной границе: между записями очереди, между каналами, между
-- таблицами. Рвать прогон посередине нельзя — в проде осталась бы половина пачки.
CREATE TABLE IF NOT EXISTS app.sync_process (
    code            text PRIMARY KEY,
    title           text        NOT NULL,
    enabled         boolean     NOT NULL DEFAULT true,
    stop_requested  boolean     NOT NULL DEFAULT false,
    last_run_at     timestamptz,
    last_result     text,
    updated_by      text,
    timestamp_upd   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.sync_process IS 'Процессы перелива данных: включён / остановлен, итог последнего прогона';
COMMENT ON COLUMN app.sync_process.enabled IS 'Разрешено ли начинать новые прогоны';
COMMENT ON COLUMN app.sync_process.stop_requested IS 'Текущему прогону закончиться на ближайшей безопасной границе';

-- Все четыре заводим ВКЛЮЧЁННЫМИ: выключатель не должен менять поведение в день
-- выката. Обратный ETL при этом останется выключенным, если выключен свойством
-- app.etl.enabled, — свойство осталось верхней границей, флаг работает внутри неё.
INSERT INTO app.sync_process (code, title) VALUES
    ('prod-sync',    'Доставка шаблонов в прод'),
    ('etl-notice',   'Обратный ETL: прод → мы'),
    ('event-import', 'Импорт событий из crmdb'),
    ('event-export', 'Перелив событий в прод')
ON CONFLICT (code) DO NOTHING;
