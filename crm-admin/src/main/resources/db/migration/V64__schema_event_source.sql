-- «События» в схеме должны вести на готовый экран, а не рисоваться движком сущностей.
--
-- V63 добавляла сущность event, только если её ещё нет. На контурах, где её успели
-- завести в Scheme Builder руками, осталась та, прежняя: без поля source. Движок таких
-- рисует сам — и человек видел пустой список «0 записей» вместо списка событий, потому
-- что данные событий живут не в браузере, а в базе панели и в crmdb.
--
-- Поэтому здесь не «добавить, если нет», а «привести к нужному виду»: существующей
-- сущности проставляем source, остальное в ней не трогаем — метки, поля и координаты
-- на канве конструктора чьи-то, и затирать их миграцией нельзя.
UPDATE app.schema_model
   SET model = jsonb_set(model, '{entities}', (
           SELECT jsonb_agg(
                      CASE WHEN e->>'id' = 'event'
                           THEN e || '{"source": "events"}'::jsonb
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(coalesce(model->'entities', '[]'::jsonb))
                  WITH ORDINALITY AS t(e, ord)
       )),
       timestamp_upd = now(),
       updated_by = 'migration V64'
 WHERE id = 1
   AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(model->'entities', '[]'::jsonb)) e
        WHERE e->>'id' = 'event' AND coalesce(e->>'source', '') <> 'events');

-- Порядок элементов сохраняем через WITH ORDINALITY: без него jsonb_agg соберёт массив
-- в порядке, который вернёт разворачивание, и сущности переставились бы на канве
-- конструктора без всякой причины.
