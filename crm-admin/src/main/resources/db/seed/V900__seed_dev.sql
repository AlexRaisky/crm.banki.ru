-- Demo data, applied ONLY under the "docker" profile (dev/local). Never runs in prod.
-- NOT NULL columns not listed here rely on their DB DEFAULTs.

INSERT INTO notice.push_template
    (code, msg_text, title, name, source_type, product_type, communication_type, source,
     trigger_type, sending_day, partner_name, active_flag, communication_name, touch_point,
     business_communication_type, deep_link)
VALUES
    (1, 'Ваша заявка одобрена!', 'Одобрено', 'push_deposit_promo', 'promo', '{deposit}', 'tunnel_a', 'campaign_x',
     'promo', 1, 'Тинькофф', true, 'push-deposit-promo-a', 'acquisition', 'adv', 'banki://deposit'),
    (2, 'Не забудьте оплатить', 'Напоминание', 'push_credit_trigger', 'trigger', '{credit}', 'tunnel_b', 'campaign_y',
     'trigger', 3, 'Сбер', true, 'push-credit-trigger-a', 'retention', 'info', 'banki://credit');

INSERT INTO notice.d_com_sms_template
    (code, msg_text, name, source_type, product_type, communication_type, source,
     trigger_type, sending_day, partner_name, active_flag, communication_name, touch_point,
     business_communication_type, sender_name)
VALUES
    (1, 'Код подтверждения: 1234', 'sms_otp', 'service', '{card}', 'tunnel_a', 'campaign_z',
     'trigger', 0, 'Альфа', true, 'sms-card-service-a', 'service', 'service', 'BANKIRU'),
    (2, 'Спецпредложение по вкладу', 'sms_deposit', 'promo', '{deposit}', 'tunnel_a', 'campaign_z2',
     'promo', 2, 'Тинькофф', true, 'sms-deposit-promo-a', 'acquisition', 'adv', 'BANKIRU');

INSERT INTO notice.email_template
    (letteros_id, subject, email_from, is_service, is_info, source_type, product_type, source,
     trigger_type, sending_day, partner_name, communication_name, active_flag, touch_point,
     communication_type, business_communication_type)
VALUES
    (1001, 'Новости по вашему вкладу', 'news@banki.ru', false, true, 'info', '{deposit}', 'campaign_e1',
     'promo', 1, 'Сбер', 'email-deposit-info-a', true, 'retention', 'tunnel_a', 'info'),
    (1002, 'Персональное предложение', 'promo@banki.ru', false, false, 'promo', '{credit}', 'campaign_e2',
     'trigger', 4, 'ВТБ', 'email-credit-promo-a', true, 'acquisition', 'tunnel_b', 'adv');

INSERT INTO callcenter.d_segment_properties
    (segment, source_system, segment_descr, active_flag, host_id, product_type, trigger_type,
     sending_day, communication_type, partner_name, communication_name, source_type, touch_point,
     business_communication_type, kvint_campaign_id)
VALUES
    (1001, 'kvint', 'Сегмент оттока по кредитам', true, 10, '{credit}', 'trigger',
     2, 'tunnel_b', 'ВТБ', 'cc-credit-trigger-a', 'trigger', 'retention', 'adv', 'KV-5001'),
    (1002, 'kvint', 'Сегмент апсейл по вкладам', true, 11, '{deposit}', 'promo',
     5, 'tunnel_a', 'Тинькофф', 'cc-deposit-promo-a', 'promo', 'acquisition', 'adv', 'KV-5002');
