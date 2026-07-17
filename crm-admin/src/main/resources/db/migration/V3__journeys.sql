-- Цепочки-схемы (journey builder): вся схема хранится одним jsonb-документом
-- {nodes:[{id,day,channel,templateCode,title,note,active,posX,posY}], edges:[{from,to}]}
-- ВНИМАНИЕ (prod): Flyway в prod-профиле выключен — там таблицу создать этим же скриптом вручную.
CREATE TABLE IF NOT EXISTS app.journeys (
    id          varchar(36) PRIMARY KEY,
    name        text        NOT NULL,
    definition  jsonb       NOT NULL,
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
