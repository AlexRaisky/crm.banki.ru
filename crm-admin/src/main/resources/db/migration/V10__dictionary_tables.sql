-- Справочники значений форм мастера: раньше списки были захардкожены в wizard.js,
-- теперь ведутся в БД (можно пополнять без релиза).
CREATE SCHEMA IF NOT EXISTS dictionary;

-- communication_name: база имени коммуникации (подсказки редактируемого combobox)
CREATE TABLE IF NOT EXISTS dictionary.d_communication_name (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    value         varchar(255) NOT NULL UNIQUE,
    description   varchar(255),
    sort_order    int          NOT NULL DEFAULT 100,
    is_active     boolean      NOT NULL DEFAULT true,
    timestamp_cr  timestamptz  NOT NULL DEFAULT now(),
    timestamp_upd timestamptz
);

-- touch_point: точка касания
CREATE TABLE IF NOT EXISTS dictionary.d_touch_point (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    value         varchar(255) NOT NULL UNIQUE,
    description   varchar(255),
    sort_order    int          NOT NULL DEFAULT 100,
    is_active     boolean      NOT NULL DEFAULT true,
    timestamp_cr  timestamptz  NOT NULL DEFAULT now(),
    timestamp_upd timestamptz
);

-- ---------- Сид 1: значения, зашитые во фронте (wizard.js COMNAME_SEED / TOUCH_OPTIONS)
INSERT INTO dictionary.d_communication_name (value, sort_order) VALUES
    ('NoComName', 10), ('subscription', 20), ('out-trigger-', 30), ('promo', 40),
    ('reset-email', 50), ('reset-password', 60), ('change-email', 70), ('change-password', 80),
    ('change-phone', 90), ('confirm-email', 100), ('confirm-phone', 110), ('promocode', 120),
    ('nps', 130), ('loyalty', 140), ('welcome', 150),
    ('-cross', 160), ('-marketplace', 170), ('-nr', 180), ('-loyalty', 190),
    ('abandoned-view', 200), ('abandoned-form', 210), ('abandoned-showcase', 220),
    ('abandoned-application', 230), ('abandoned-approval', 240), ('abandoned-rejection', 250),
    ('abandoned-identification', 260), ('abandoned-doc-load', 270), ('sign', 280),
    ('abandoned-payment', 290), ('abandoned-refill', 300), ('issue', 310), ('renewal', 320)
ON CONFLICT (value) DO NOTHING;

INSERT INTO dictionary.d_touch_point (value, sort_order) VALUES
    ('promo', 10), ('abandoned-view', 20), ('abandoned-form', 30), ('abandoned-showcase', 40),
    ('abandoned-application', 50), ('abandoned-approval', 60), ('abandoned-splash', 70),
    ('abandoned-rejection', 80), ('abandoned-identification', 90), ('abandoned-doc-load', 100),
    ('sign', 110), ('abandoned-payment', 120), ('abandoned-refill', 130), ('issue', 140),
    ('renewal', 150), ('mobile-app', 160)
ON CONFLICT (value) DO NOTHING;

-- ---------- Сид 2: значения, уже встречающиеся в заведённых шаблонах
INSERT INTO dictionary.d_communication_name (value, sort_order)
SELECT DISTINCT communication_name, 500
FROM template.d_template
WHERE communication_name IS NOT NULL AND communication_name <> ''
ON CONFLICT (value) DO NOTHING;

INSERT INTO dictionary.d_touch_point (value, sort_order)
SELECT DISTINCT touch_point, 500
FROM template.d_template
WHERE touch_point IS NOT NULL AND touch_point <> ''
ON CONFLICT (value) DO NOTHING;
