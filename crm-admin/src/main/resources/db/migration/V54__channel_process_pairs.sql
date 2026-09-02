-- Пары definition_key / business_key_prefix — из кода в справочник.
--
-- Списки лежали в EventFormService константами. Каждый новый канал — правка Java,
-- сборка и выкат трёх контуров ради двух строк; при этом значения не наши, их задаёт
-- прод-процесс, и меняются они без нас. Место таким спискам в БД.
--
-- Ключ и префикс держим ОДНОЙ строкой, а не двумя справочниками. Они не независимы:
-- smsChannelProcessV2 работает только вместе с SmsChannel, и разложенные по разным
-- таблицам они рано или поздно разъедутся — событие с чужим префиксом заводится без
-- ошибки и молча ничего не отправляет. В одной строке разъехаться нечему.
--
-- Канал в той же строке: он определяет, что вообще можно выбрать при этом методе.
-- Массовая отправка есть только у email, push и sms — vk, кц и робот массовыми не
-- бывают, и показывать их в списке значит предлагать заведомо нерабочее.
CREATE TABLE IF NOT EXISTS reference.d_channel_process (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    method              varchar(16)  NOT NULL CHECK (method IN ('batch', 'single')),
    notify_channel      varchar(32)  NOT NULL,
    definition_key      varchar(128) NOT NULL,
    business_key_prefix varchar(128) NOT NULL,
    sort_order          int          NOT NULL DEFAULT 100,
    is_active           boolean      NOT NULL DEFAULT true,
    timestamp_cr        timestamptz  NOT NULL DEFAULT now(),
    timestamp_upd       timestamptz,
    -- Ключ уникален внутри метода, а не глобально: одно и то же имя процесса у разных
    -- методов не встречается сегодня, но запрещать это на уровне БД оснований нет.
    UNIQUE (method, definition_key)
);

COMMENT ON TABLE reference.d_channel_process IS
    'Пары definition_key/business_key_prefix по методу отправки и каналу';

-- Массовый метод: три канала, у которых массовая отправка существует.
INSERT INTO reference.d_channel_process
    (method, notify_channel, definition_key, business_key_prefix, sort_order) VALUES
    ('batch', 'EMAIL', 'batchEmailChannelProcess2024', 'BatchEmailChannel', 10),
    ('batch', 'PUSH',  'batchPushChannelProcess2024',  'BatchPushChannel',  20),
    ('batch', 'SMS',   'batchSmsChannelProcess2024',   'BatchSmsChannel',   30)
ON CONFLICT (method, definition_key) DO NOTHING;

-- Единичный метод: то, что было зашито в форме.
INSERT INTO reference.d_channel_process
    (method, notify_channel, definition_key, business_key_prefix, sort_order) VALUES
    ('single', 'SMS',   'smsChannelProcessV2',      'SmsChannel',        10),
    ('single', 'PUSH',  'pushChannelProcessV2',     'PushChannel',       20),
    ('single', 'EMAIL', 'emailChannelProcessV2',    'EmailChannel',      30),
    ('single', 'VK',    'vkChannelProcessV2',       'VkChannel',         40),
    ('single', 'CC',    'callCenterChannelProcess', 'CallCenterChannel', 50)
ON CONFLICT (method, definition_key) DO NOTHING;
