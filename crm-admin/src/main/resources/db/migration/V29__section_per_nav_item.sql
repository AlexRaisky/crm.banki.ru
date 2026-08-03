-- Права раздаются на пункт меню, а не на группу.
--
-- Было: пять отчётов делили одну секцию `reports`, а единственный пункт мониторинга —
-- секцию `monitoring`. Выдать доступ к одному отчёту было нельзя: галка на `reports`
-- открывала сразу все пять. Теперь у каждого листа меню своя секция, а группа сайдбара
-- сама скрывается, когда скрыты все её дети (applyNavAcl), поэтому зонтичные секции
-- больше не нужны.
--
-- Права ПЕРЕНОСИМ, а не раздаём заново: у кого был доступ к «Отчётам», тот получает
-- все пять отчётов ровно с теми же галками. После выката админ сам сузит, где нужно, —
-- миграция никого не лишает того, что было.

-- Отчёты: reports -> пять пунктов меню
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT rs.role_id, x.sid, rs.can_read, rs.can_add, rs.can_edit, rs.can_delete
FROM app.role_section rs
CROSS JOIN (VALUES ('rep-planfact'), ('rep-matrix'), ('rep-leadgen'),
                   ('rep-smscheck'), ('rep-demo')) AS x(sid)
WHERE rs.section_id = 'reports'
ON CONFLICT DO NOTHING;

-- Мониторинг: monitoring -> его единственный пункт
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT rs.role_id, 'mon-campaigns', rs.can_read, rs.can_add, rs.can_edit, rs.can_delete
FROM app.role_section rs
WHERE rs.section_id = 'monitoring'
ON CONFLICT DO NOTHING;

-- Зонтичные секции стали группами сайдбара: строки прав по ним больше ничего не значат.
-- Удаляем, чтобы в матрице не висели мёртвые строки и никто не путался, что именно даёт доступ.
DELETE FROM app.role_section WHERE section_id IN ('reports', 'monitoring');

-- «Планирование промо» до сих пор висело в меню с флагом noAcl — раздел видели все,
-- матрица его не ограничивала (пережиток времён, когда таблица лежала в localStorage).
-- Флаг снимаем, и чтобы снятие никого не выбросило из раздела, ролям без права read
-- на promo выдаём его явно: сохраняем ровно ту видимость, что была до выката.
-- Дальше admin сузит доступ там, где он не нужен, — но уже осознанно, а не молча.
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, 'promo', true, false, false, false
FROM app.role r
WHERE NOT EXISTS (
    SELECT 1 FROM app.role_section rs WHERE rs.role_id = r.id AND rs.section_id = 'promo')
ON CONFLICT DO NOTHING;
