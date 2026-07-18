-- Переход на новую архитектуру как основную:
-- 1) бэкфилл единого справочника template.d_template из 4 канальных таблиц
--    (ядро — типизированными колонками, канальное — в channel_props jsonb);
-- 2) очередь синка в прод-БД (outbox): каждая операция мастера встаёт сюда
--    и доставляется в прод (схемы notice/callcenter, структура 1:1).

-- ---------- 1. Бэкфилл d_template (идемпотентно: ON CONFLICT DO NOTHING —
-- уже синкнутые материализацией строки не перезатираем)
INSERT INTO template.d_template (channel, code, communication_name, campaign_name, communication_type,
    business_communication_type, trigger_type, sending_day, product_type, partner_name, touch_point,
    aff_sub3, selection_wizard_service, marketplace, dialog, loyalty, national_rating, news, mobile_app,
    night_send, permanent_exclude, active_flag, channel_props)
SELECT 'sms', t.code, t.communication_name, t.source_type, t.communication_type,
    t.business_communication_type, t.trigger_type, t.sending_day, t.product_type, t.partner_name, t.touch_point,
    t.aff_sub3, t.selection_wizard_service, coalesce(t.marketplace,false), coalesce(t.dialog,false),
    coalesce(t.loyalty,false), coalesce(t.national_rating,false), coalesce(t.news,false),
    coalesce(t.mobile_app,false), coalesce(t.night_send,false), coalesce(t.permanent_exclude,false),
    coalesce(t.active_flag,true),
    to_jsonb(t) - string_to_array('id,code,communication_name,source_type,communication_type,business_communication_type,trigger_type,sending_day,product_type,partner_name,touch_point,aff_sub3,selection_wizard_service,marketplace,dialog,loyalty,national_rating,news,mobile_app,night_send,permanent_exclude,active_flag', ',')
FROM notice.d_com_sms_template t
ON CONFLICT (channel, code) DO NOTHING;

INSERT INTO template.d_template (channel, code, communication_name, campaign_name, communication_type,
    business_communication_type, trigger_type, sending_day, product_type, partner_name, touch_point,
    aff_sub3, selection_wizard_service, marketplace, dialog, loyalty, national_rating, news, mobile_app,
    night_send, permanent_exclude, active_flag, channel_props)
SELECT 'push', t.code, t.communication_name, t.source_type, t.communication_type,
    t.business_communication_type, t.trigger_type, t.sending_day, t.product_type, t.partner_name, t.touch_point,
    t.aff_sub3, t.selection_wizard_service, coalesce(t.marketplace,false), coalesce(t.dialog,false),
    coalesce(t.loyalty,false), coalesce(t.national_rating,false), coalesce(t.news,false),
    coalesce(t.mobile_app,false), coalesce(t.night_send,false), coalesce(t.permanent_exclude,false),
    coalesce(t.active_flag,true),
    to_jsonb(t) - string_to_array('id,code,communication_name,source_type,communication_type,business_communication_type,trigger_type,sending_day,product_type,partner_name,touch_point,aff_sub3,selection_wizard_service,marketplace,dialog,loyalty,national_rating,news,mobile_app,night_send,permanent_exclude,active_flag', ',')
FROM notice.push_template t
ON CONFLICT (channel, code) DO NOTHING;

INSERT INTO template.d_template (channel, code, communication_name, campaign_name, communication_type,
    business_communication_type, trigger_type, sending_day, product_type, partner_name, touch_point,
    aff_sub3, selection_wizard_service, marketplace, dialog, loyalty, national_rating, news, mobile_app,
    night_send, permanent_exclude, active_flag, channel_props)
SELECT 'email', t.id, t.communication_name, t.source_type, t.communication_type,
    t.business_communication_type, t.trigger_type, t.sending_day, t.product_type, t.partner_name, t.touch_point,
    t.aff_sub3, t.selection_wizard_service, coalesce(t.marketplace,false), coalesce(t.dialog,false),
    coalesce(t.loyalty,false), coalesce(t.national_rating,false), coalesce(t.news,false),
    coalesce(t.mobile_app,false), false, coalesce(t.permanent_exclude,false), coalesce(t.active_flag,true),
    to_jsonb(t) - string_to_array('id,communication_name,source_type,communication_type,business_communication_type,trigger_type,sending_day,product_type,partner_name,touch_point,aff_sub3,selection_wizard_service,marketplace,dialog,loyalty,national_rating,news,mobile_app,night_send,permanent_exclude,active_flag', ',')
FROM notice.email_template t
ON CONFLICT (channel, code) DO NOTHING;

INSERT INTO template.d_template (channel, code, communication_name, campaign_name, communication_type,
    business_communication_type, trigger_type, sending_day, product_type, partner_name, touch_point,
    aff_sub3, selection_wizard_service, marketplace, dialog, loyalty, national_rating, news, mobile_app,
    night_send, permanent_exclude, active_flag, channel_props)
SELECT 'cc', t.segment, t.communication_name, t.source_type, t.communication_type,
    t.business_communication_type, t.trigger_type, t.sending_day, t.product_type, t.partner_name, t.touch_point,
    t.aff_sub3, t.selection_wizard_service, coalesce(t.marketplace,false), coalesce(t.dialog,false),
    coalesce(t.loyalty,false), coalesce(t.national_rating,false), coalesce(t.news,false),
    coalesce(t.mobile_app,false), false, coalesce(t.permanent_exclude,false), coalesce(t.active_flag,true),
    to_jsonb(t) - string_to_array('id,segment,communication_name,source_type,communication_type,business_communication_type,trigger_type,sending_day,product_type,partner_name,touch_point,aff_sub3,selection_wizard_service,marketplace,dialog,loyalty,national_rating,news,mobile_app,night_send,permanent_exclude,active_flag', ',')
FROM callcenter.d_segment_properties t
ON CONFLICT (channel, code) DO NOTHING;

-- ---------- 2. Очередь синка в прод-БД (outbox)
CREATE TABLE IF NOT EXISTS app.prod_sync (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel       varchar(8)  NOT NULL,           -- sms | push | email | cc
    operation     varchar(8)  NOT NULL,           -- INSERT | UPDATE | DELETE
    local_code    bigint,                         -- код у нас на момент постановки (для UPDATE/DELETE)
    prod_code     bigint,                         -- код, который присвоил прод (после доставки)
    payload       jsonb       NOT NULL,           -- строка канальной таблицы 1:1 (то, что едет в прод)
    status        varchar(10) NOT NULL DEFAULT 'PENDING',  -- PENDING | OK | ERROR
    attempts      int         NOT NULL DEFAULT 0,
    last_error    text,
    created_by    varchar(255),
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    timestamp_upd timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prod_sync_status ON app.prod_sync (status, timestamp_cr);
