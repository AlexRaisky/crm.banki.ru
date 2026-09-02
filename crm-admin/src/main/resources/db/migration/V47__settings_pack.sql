-- Перенос настроек между контурами: слепки «как было» перед применением пакета.
--
-- Пакет приезжает с другого контура файлом и перезаписывает у нас настройки — роли,
-- модель схемы, справочники. Отменить это через «Ctrl+Z» нельзя, поэтому перед каждым
-- применением кладём сюда текущее состояние того объекта, который собираемся заменить.
-- Хранится ровно то, что вернул бы экспорт: значит, откат — это применение слепка обратно.
--
-- Таблица append-only и не чистится по времени: слепков мало (перенос — редкое событие),
-- а нужны они как раз тогда, когда с момента переноса прошла неделя и «всё сломалось».
CREATE TABLE IF NOT EXISTS app.settings_snapshot (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_key      text        NOT NULL,        -- какой объект: roles / schema-model / reference / …
    payload       jsonb       NOT NULL,        -- состояние ДО применения
    source_env    text        NOT NULL DEFAULT '',   -- откуда приехал пакет
    actor         text,
    note          text        NOT NULL DEFAULT '',
    timestamp_cr  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_settings_snapshot_ts ON app.settings_snapshot (timestamp_cr DESC);
