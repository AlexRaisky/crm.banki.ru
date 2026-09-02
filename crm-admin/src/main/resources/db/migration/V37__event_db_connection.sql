-- Отдельное подключение под события: crmdb.
--
-- Шаблоны и события уезжают в РАЗНЫЕ базы. У шаблонов приёмник — база со схемами
-- notice/callcenter (строка app.db_connection с флагом is_prod_sync). События живут в
-- crmdb: tracker, scheduler, template, commapi. Переиспользовать is_prod_sync нельзя —
-- флаг там один на строку, и пометив им crmdb, мы увели бы туда синк шаблонов.
ALTER TABLE app.db_connection
    ADD COLUMN IF NOT EXISTS is_event_db boolean NOT NULL DEFAULT false;

-- Приёмник событий, как и приёмник шаблонов, может быть только один: иначе «куда
-- переливать» становится вопросом с двумя ответами.
CREATE UNIQUE INDEX IF NOT EXISTS uq_db_connection_event_db
    ON app.db_connection ((is_event_db)) WHERE is_event_db;

COMMENT ON COLUMN app.db_connection.is_event_db IS
    'Приёмник событий (crmdb): tracker/scheduler/template/commapi. Не путать с is_prod_sync — там шаблоны.';
