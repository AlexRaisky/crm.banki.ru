-- product_type: продукт коммуникации. Третий справочник рядом с d_communication_name
-- и d_touch_point — раньше поле было свободным вводом, из-за чего в данных
-- накопились и «credit», и «credits», и «card» вместо debitcards.
-- Порядок значений — как их дал заказчик (сначала массовые продукты, дальше нишевые),
-- поэтому sort_order проставлен явно, а не по алфавиту.
CREATE TABLE IF NOT EXISTS dictionary.d_product_type (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    value         varchar(255) NOT NULL UNIQUE,
    description   varchar(255),
    sort_order    int          NOT NULL DEFAULT 100,
    is_active     boolean      NOT NULL DEFAULT true,
    timestamp_cr  timestamptz  NOT NULL DEFAULT now(),
    timestamp_upd timestamptz
);

INSERT INTO dictionary.d_product_type (value, sort_order) VALUES
    ('credits',             10),
    ('creditcards',         20),
    ('mortgages',           30),
    ('microloans',          40),
    ('deposits',            50),
    ('debitcards',          60),
    ('osago',               70),
    ('kasko',               80),
    ('insurance_estate',    90),
    ('rko',                100),
    ('autocredits',        110),
    ('business_credits',   120),
    ('savings_account',    130),
    ('estate',             140),
    ('insurance_combo',    150),
    ('insurance_health',   160),
    ('insurance_vzr',      170),
    ('insurance_etc',      180),
    ('investments',        190),
    ('general',            200),
    ('lsre',               210),
    ('exchange_rate',      220),
    ('rvk',                230),
    ('cryptocurrency',     240),
    ('mortgage_broker',    250),
    ('insurance_mrtgg',    260),
    ('business_microloans',270),
    ('factoring',          280),
    ('acquiring',          290),
    ('leasing',            300),
    ('bank_guarantees',    310),
    ('cash_register',      320),
    ('kpk',                330)
ON CONFLICT (value) DO NOTHING;
