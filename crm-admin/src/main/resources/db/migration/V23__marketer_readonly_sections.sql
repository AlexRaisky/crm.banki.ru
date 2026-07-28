-- Маркетолог: сузить доступ.
--
-- Раньше (V21/V22) у роли был просмотр ВСЕХ разделов + полное управление промо.
-- По требованию оставляем доступ только к пяти разделам и ТОЛЬКО на просмотр
-- (без add/edit/delete):
--   promo      — «Планирование промо»
--   srcbuilder — «Конструктор source»
--   templates  — «Список шаблонов»
--   admin      — «Просмотр настроек» (та же секция, что и мастер; правка всё равно закрыта)
--   reports    — «Отчёты»
--
-- Права ЖИВЫЕ (принадлежат роли, делятся всеми носителями) — поэтому переопределяем
-- весь набор секций роли: удаляем прежние строки и вставляем нужные. Раздел home в UI
-- доступен всегда (не гейтится ACL), поэтому в наборе не нужен.

DELETE FROM app.role_section rs
USING app.role r
WHERE rs.role_id = r.id AND r.name = 'Маркетолог';

INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s.section_id, true, false, false, false
FROM app.role r
CROSS JOIN (VALUES ('promo'), ('srcbuilder'), ('templates'), ('admin'), ('reports')) AS s(section_id)
WHERE r.name = 'Маркетолог';
