-- Очередь перелива событий в crmdb — по образцу app.prod_sync, которая возит шаблоны.
--
-- ЗАЧЕМ. Событие уезжало в прод ровно одним способом: попыткой сразу после заведения
-- формой. Не вышло — crmdb недоступна, процесс остановлен в «Процессах переливов», у
-- человека нет права ev-export — и всё, событие остаётся только в нашей модели. Повторять
-- некому: фонового тика у экспорта нет, есть только кнопка, которую надо вспомнить нажать.
-- В ответе формы это видно строкой «заведено, но в прод не уехало», в списке — колонкой
-- «В проде», но проглядеть такое легко, а событие при этом выглядит заведённым.
--
-- У шаблонов этой беды нет: правка кладётся в очередь, тик разбирает её каждые двадцать
-- секунд, недоставленное остаётся в очереди со статусом ERROR и ждёт человека с кнопкой
-- «Повтор». Здесь то же самое для событий.
--
-- ЧЕМ ОТЛИЧАЕТСЯ ОТ app.prod_sync. Там в payload лежит строка канальной таблицы: очередь
-- помнит, ЧТО отправить, потому что у шаблона правку можно потерять. Здесь payload не
-- нужен — событие целиком лежит в нашем слое B, и перелив собирает пачку сам, по
-- flow.t_materialization. Хранить копию значило бы завести второй источник правды о том,
-- из чего состоит событие.
--
-- Одна строка на событие: UNIQUE (event_id). Перелив идемпотентен сам по себе (уже
-- уехавшие строки он пропускает по flow.t_event_link), поэтому вторая запись в очереди
-- ничего бы не добавила, а вот «почему их две» пришлось бы объяснять.
CREATE TABLE IF NOT EXISTS app.event_export_queue (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      bigint      NOT NULL REFERENCES flow.d_event (id) ON DELETE CASCADE,
    status        varchar(10) NOT NULL DEFAULT 'PENDING',   -- PENDING | OK | ERROR
    attempts      int         NOT NULL DEFAULT 0,
    last_error    text,
    -- Кто поставил в очередь. Заводит событие один человек, а разбирает очередь фон —
    -- без этой колонки некого спросить, что это за событие и зачем оно тут.
    created_by    varchar(255),
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    timestamp_upd timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT event_export_queue_event_uq UNIQUE (event_id),
    CONSTRAINT event_export_queue_status_chk CHECK (status IN ('PENDING', 'OK', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS idx_event_export_queue_status
    ON app.event_export_queue (status, timestamp_cr);

COMMENT ON TABLE app.event_export_queue IS
    'Очередь перелива событий в crmdb. Разбирает EventExportQueueService раз в 20 секунд.';

-- Задним числом ставим в очередь то, что уже заведено, но в прод не уехало. Иначе
-- очередь начнёт работать «с завтрашнего дня», а события, потерявшиеся из-за прошлых
-- сбоев, так и останутся лежать — а их и надо доставить в первую очередь.
--
-- Признак «не уехало» — отсутствие строк экспорта в журнале связей. Импортированные
-- события (direction = 'IMPORT') сюда не попадают: они пришли ИЗ прода, и отправлять их
-- обратно нечего.
INSERT INTO app.event_export_queue (event_id, created_by)
SELECT e.id, 'migration V60'
FROM flow.d_event e
WHERE EXISTS (SELECT 1 FROM flow.t_materialization m
               WHERE m.our_entity = 'flow.d_event' AND m.our_id = e.id::text)
  AND NOT EXISTS (SELECT 1 FROM flow.t_event_link l
                   WHERE l.event_id = e.id AND l.direction <> 'IMPORT')
ON CONFLICT (event_id) DO NOTHING;
