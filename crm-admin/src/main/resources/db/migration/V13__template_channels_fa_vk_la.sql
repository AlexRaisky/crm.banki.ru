-- Новые типы шаблонов в едином справочнике template.d_template:
--   fa — «финансовый ассистент» (fa_template), чат/операторские пуши;
--   vk — VK-сообщения (vk_template);
--   la — Live Activity (live_activity_template). В мастере это тумблер в форме Push:
--        включён → канал la (своя прод-таблица), выключен → обычный push.
-- Ядро переиспользуем как есть; специфичные поля каналов лягут в channel_props jsonb.
-- Прод-доставка (имена/схема прод-таблиц, дефолты NOT NULL) настраивается отдельно.
ALTER TABLE template.d_template DROP CONSTRAINT IF EXISTS d_template_channel_check;
ALTER TABLE template.d_template ADD  CONSTRAINT d_template_channel_check
    CHECK (channel IN ('sms', 'push', 'email', 'cc', 'fa', 'vk', 'la'));
