-- Постмастеры: свой access-токен Mail.ru, обе версии Google сразу и ежедневная синхронизация.
--
-- 1. Mail.ru отдаёт пару токенов, и рабочий access живёт час. Раньше мы умели только
--    менять refresh на access; теперь access можно вписать напрямую — это выручает,
--    когда refresh выдать не могут, а разовый доступ уже есть. Refresh при этом
--    остаётся главным: пока он заполнен, протухший access обновляется сам.
--
-- 2. У Google версии дополняют друг друга: v1 отдаёт историю трафика по дням, v2 —
--    статус SPF/DKIM/DMARC. Выбор «или-или» означал терять половину картины, поэтому
--    добавлен режим both: ходим в обе и складываем ответы в одну строку дня.
--
-- 3. Ежедневное обновление: раньше метрики появлялись, только если кто-то нажал
--    кнопку, — а вопрос «когда поехала репутация» задают как раз тогда, когда никто
--    не нажимал.
ALTER TABLE app.postmaster_connection
    ADD COLUMN IF NOT EXISTS mailru_access_token text,
    ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

ALTER TABLE app.postmaster_connection DROP CONSTRAINT IF EXISTS postmaster_connection_google_api_version_check;
ALTER TABLE app.postmaster_connection
    ADD CONSTRAINT postmaster_connection_google_api_version_check
    CHECK (google_api_version IN ('v1', 'v2', 'both'));

-- Кабинетам, где v2 недоступен, режим both не мешает: ошибка одной версии не
-- отменяет данные другой. Поэтому по умолчанию берём обе.
UPDATE app.postmaster_connection SET google_api_version = 'both' WHERE id = 1;

-- Текущий статус проверок подлинности из v2 (getComplianceStatus). Это не доля за
-- день, а состояние записи в DNS — держим отдельными колонками, иначе оно смешалось
-- бы с долями SPF/DKIM/DMARC, которые считаются по трафику.
ALTER TABLE channel.t_postmaster_daily
    ADD COLUMN IF NOT EXISTS spf_status   varchar(32),
    ADD COLUMN IF NOT EXISTS dkim_status  varchar(32),
    ADD COLUMN IF NOT EXISTS dmarc_status varchar(32);
