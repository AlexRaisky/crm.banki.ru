-- Вторая встроенная админ-роль «Админ» (рядом с «Проджект-менеджер») и пять новых
-- клиентских разделов только-просмотра: srcbuilder, reports, heatmap, monitoring,
-- uploads. Роль «Админ» — под неё же маскируется супер-админ в панели. Новые разделы
-- досеваем во ВСЕ существующие встроенные роли, чтобы никто не потерял видимость.

-- (а) роль «Админ»: обычный админ, встроенная
INSERT INTO app.role (name, is_admin, is_super_admin, is_system, sort_order) VALUES
    ('Админ', true, false, true, 15)
ON CONFLICT (name) DO NOTHING;

-- (б) «Админ» — все 14 разделов полностью (как «Проджект-менеджер»)
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, true, true, true
FROM app.role r,
     unnest(ARRAY['home','deviations','onelink','admin','templates','dashboard','journeys','access','promo',
                  'srcbuilder','reports','heatmap','monitoring','uploads']) s
WHERE r.name = 'Админ'
ON CONFLICT DO NOTHING;

-- (в) новые пять разделов — досев в существующие встроенные роли.
-- Админ-уровневые роли (Супер админ, Проджект-менеджер, Админ): все права.
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, true, true, true
FROM app.role r,
     unnest(ARRAY['srcbuilder','reports','heatmap','monitoring','uploads']) s
WHERE r.is_admin OR r.is_super_admin
ON CONFLICT DO NOTHING;

-- Обычные роли (СЕО, Тимлид аналитики, Аналитик, Маркетолог): только просмотр.
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, false, false, false
FROM app.role r,
     unnest(ARRAY['srcbuilder','reports','heatmap','monitoring','uploads']) s
WHERE r.name IN ('СЕО', 'Тимлид аналитики', 'Аналитик', 'Маркетолог')
ON CONFLICT DO NOTHING;
