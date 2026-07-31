-- Водяные знаки ETL: до какого ПРОД-времени по каналу мы уже затянули изменения.
-- Отдельная таблица, а НЕ max(d_template.timestamp_upd): последний пишут ещё и локальные
-- правки мастера (наши часы), из-за чего знак «отравлялся» бы и мог поехать назад.
-- Знак двигаем только вперёд — по max(COALESCE(timestamp_upd, timestamp_cr)) применённого батча.
CREATE TABLE IF NOT EXISTS app.sync_watermark (
    channel       varchar(10) PRIMARY KEY,   -- sms/push/email/cc/fa/vk/la
    last_prod_ts  timestamptz,               -- NULL = канал ещё ни разу не синхронизирован
    timestamp_upd timestamptz NOT NULL DEFAULT now()
);
