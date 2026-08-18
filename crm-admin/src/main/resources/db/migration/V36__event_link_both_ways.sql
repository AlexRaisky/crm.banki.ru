-- Журнал соответствий строк становится двусторонним.
--
-- V35 завела flow.t_event_export под перелив «мы -> прод». Обратное направление
-- (импорт того, что в проде уже заведено) записывает ровно тот же факт: вот наша
-- строка, вот её пара в crmdb. Две таблицы с одинаковыми колонками означали бы, что
-- на вопрос «есть ли у этой строки пара» надо смотреть в два места и не забыть ни одно.
--
-- Поэтому переименовываем, а не заводим вторую: направление становится колонкой.
ALTER TABLE flow.t_event_export RENAME TO t_event_link;
ALTER TABLE flow.t_event_link RENAME COLUMN exported_at TO linked_at;
ALTER TABLE flow.t_event_link RENAME COLUMN exported_by TO linked_by;
ALTER TABLE flow.t_event_link RENAME CONSTRAINT t_event_export_row_uq TO t_event_link_our_uq;
ALTER INDEX IF EXISTS flow.t_event_export_event_idx RENAME TO t_event_link_event_idx;

-- Кто кого породил. На идемпотентность не влияет (её держат уникальные ключи ниже),
-- но без этого не отличить строку, которую мы отправили, от строки, которую забрали, —
-- а разбирать расхождения без этого различия невозможно.
ALTER TABLE flow.t_event_link
    ADD COLUMN IF NOT EXISTS direction varchar(8) NOT NULL DEFAULT 'EXPORT';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 't_event_link_direction_chk') THEN
        ALTER TABLE flow.t_event_link ADD CONSTRAINT t_event_link_direction_chk
            CHECK (direction IN ('EXPORT', 'IMPORT'));
    END IF;
END $$;

-- Вторая уникальность — под импорт. Первая (our_table, our_id) не даёт отправить нашу
-- строку в прод дважды; эта не даёт затянуть продовую строку к себе дважды. Нужны обе:
-- по одной из них повторный прогон импорта наплодил бы копии.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 't_event_link_prod_uq') THEN
        ALTER TABLE flow.t_event_link ADD CONSTRAINT t_event_link_prod_uq
            UNIQUE (our_table, prod_id);
    END IF;
END $$;

-- event_id у импортированных строк заполняется ПОСЛЕ того, как из слоя B собрано
-- событие: сначала мы тянем строки, потом раскладываем их по flow.d_event. Пока
-- событие не собрано, ссылки нет.
ALTER TABLE flow.t_event_link ALTER COLUMN event_id DROP NOT NULL;

COMMENT ON TABLE flow.t_event_link IS
    'Соответствие строк нашего слоя B и строк crmdb, в обе стороны. direction говорит, кто кого породил.';
