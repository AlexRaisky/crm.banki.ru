-- Прод-подключение (приёмник синка шаблонов) переезжает из env в реестр app.db_connection,
-- чтобы источник был один. Помечаем строку-приёмник флагом is_prod_sync; ProdDbService
-- берёт креды из неё, а не из PROD_DB_URL/USER/PASSWORD.
ALTER TABLE app.db_connection
    ADD COLUMN IF NOT EXISTS is_prod_sync boolean NOT NULL DEFAULT false;

-- Приёмник может быть только один.
CREATE UNIQUE INDEX IF NOT EXISTS uq_db_connection_prod_sync
    ON app.db_connection ((is_prod_sync)) WHERE is_prod_sync;
