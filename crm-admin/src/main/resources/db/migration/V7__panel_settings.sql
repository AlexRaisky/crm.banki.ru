-- Настройки панели (настроечная админка /settings): key → произвольный jsonb.
-- Первый потребитель — 'appSections': конфиг «приложение App Launcher → разделы панели».
-- Чтение — любой аутентифицированный, запись — только ADMIN (см. PanelSettingsController).
CREATE TABLE IF NOT EXISTS app.panel_settings (
    key           varchar(64) PRIMARY KEY,
    value         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    timestamp_upd timestamptz NOT NULL DEFAULT now()
);

-- Сид: пустой конфиг приложений (пустой объект = все разделы всем приложениям).
INSERT INTO app.panel_settings (key, value)
VALUES ('appSections', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;
