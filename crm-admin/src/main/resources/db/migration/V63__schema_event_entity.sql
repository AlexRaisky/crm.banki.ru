-- Сущность «События» в модели схемы.
--
-- Раздел «События» уезжает из сайдбара в «Сущности» — как раньше уехали «Шаблоны и
-- сегменты». Список и карточка у события свои (готовый экран раздела), поэтому в схеме
-- он объявлен так же, как шаблон: с полем source. Движок сущностей такие не рисует, он
-- только заводит подраздел и ведёт на готовый экран.
--
-- Поля перечислены не ради формы, а ради описания: по ним человек в Scheme Builder
-- видит, из чего состоит событие, и они же считаются на обзорной карточке.
--
-- Пишем в модель, только если сущности там ещё нет: миграция должна быть безобидна
-- при повторном накате и не должна затирать правки, сделанные в билдере.
UPDATE app.schema_model
   SET model = jsonb_set(model, '{entities}',
                         coalesce(model->'entities', '[]'::jsonb) || $ent${"id": "event", "label": "Событие", "plural_label": "События", "table": "flow.d_event", "description": "События коммуникаций: онлайновые (приходят извне) и по расписанию (кронтаб и шаги выборки). Данные живут в базе панели и в боевых таблицах crmdb; список и карточка открываются готовым экраном раздела, а не движком сущностей.", "title_field": "event_name", "technical": false, "source": "events", "x": 1230, "y": 560, "fields": [{"name": "event_name", "label": "Имя события", "db_type": "varchar(255)", "ui_type": "text", "required": true, "read_only": true, "description": "Уходит и в event_name, и в selection", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "kind", "label": "Род", "db_type": "varchar(16)", "ui_type": "picklist", "required": false, "read_only": true, "description": "income — приходит извне, time — по расписанию", "target_entity": "", "relation_kind": "", "default_value": "", "options": ["income", "time"]}, {"name": "system", "label": "Система", "db_type": "varchar(255)", "ui_type": "text", "required": false, "read_only": true, "description": "MPK, insurance, URB и прочие", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "source", "label": "Source", "db_type": "varchar(255)", "ui_type": "text", "required": false, "read_only": true, "description": "Метка источника коммуникации", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "notify_channel", "label": "Канал", "db_type": "varchar(20)", "ui_type": "picklist", "required": false, "read_only": true, "description": "Канал доставки события", "target_entity": "", "relation_kind": "", "default_value": "", "options": ["SMS", "PUSH", "EMAIL", "VK", "CC"]}, {"name": "crontab", "label": "Расписание", "db_type": "varchar(255)", "ui_type": "text", "required": false, "read_only": true, "description": "Шестипольный кронтаб Quartz; только у событий по расписанию", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "database", "label": "База выборки", "db_type": "varchar(64)", "ui_type": "text", "required": false, "read_only": true, "description": "Откуда планировщик берёт данные: greenplum, crmdb", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "is_active", "label": "Активно", "db_type": "boolean", "ui_type": "checkbox", "required": false, "read_only": true, "description": "Событие включено", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "is_batch", "label": "Массовое", "db_type": "boolean", "ui_type": "checkbox", "required": false, "read_only": true, "description": "Метод отправки: массовый или единичный", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}, {"name": "timestamp_cr", "label": "Заведено", "db_type": "timestamptz", "ui_type": "datetime", "required": false, "read_only": true, "description": "Когда событие завели", "target_entity": "", "relation_kind": "", "default_value": "", "options": []}]}$ent$::jsonb),
       timestamp_upd = now(),
       updated_by = 'migration V63'
 WHERE id = 1
   AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(model->'entities', '[]'::jsonb)) e
        WHERE e->>'id' = 'event');
