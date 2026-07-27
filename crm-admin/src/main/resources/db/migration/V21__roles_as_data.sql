-- Роли стали данными. Раньше это было жёсткое перечисление (READER/EDITOR/ADMIN/
-- SUPER_ADMIN) с матрицей прав у каждого пользователя (user_sections). Теперь есть
-- справочник app.role с флагами admin/super-admin и собственной матрицей прав по
-- разделам (app.role_section). Права ЖИВЫЕ: принадлежат роли, все её носители делят
-- один набор, правка роли меняет всех сразу. У пользователя теперь только ссылка на роль.
-- Таблицу user_sections не трогаем (осиротеет, но пригодится под будущие персональные
-- исключения), enforcement на неё больше не смотрит.

CREATE TABLE IF NOT EXISTS app.role (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           text        NOT NULL UNIQUE,
    is_admin       boolean     NOT NULL DEFAULT false,   -- админ-полномочия + обход матрицы
    is_super_admin boolean     NOT NULL DEFAULT false,   -- всё; привязана к ADMIN_EMAIL
    is_system      boolean     NOT NULL DEFAULT false,   -- встроенная: нельзя удалить/переименовать
    sort_order     int         NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS app.role_section (
    role_id    bigint  NOT NULL REFERENCES app.role(id) ON DELETE CASCADE,
    section_id text    NOT NULL,
    can_read   boolean NOT NULL DEFAULT true,
    can_add    boolean NOT NULL DEFAULT false,
    can_edit   boolean NOT NULL DEFAULT false,
    can_delete boolean NOT NULL DEFAULT false,
    PRIMARY KEY (role_id, section_id)
);

-- Встроенные роли (заказчик): СЕО — просмотр всего; Тимлид/Аналитик — просмотр+правка;
-- Маркетолог — просмотр всего + управление промо; Проджект-менеджер — админ; Супер админ — всё.
INSERT INTO app.role (name, is_admin, is_super_admin, is_system, sort_order) VALUES
    ('Супер админ',       false, true,  true, 10),
    ('Проджект-менеджер', true,  false, true, 20),
    ('Тимлид аналитики',  false, false, true, 30),
    ('Аналитик',          false, false, true, 40),
    ('Маркетолог',        false, false, true, 50),
    ('СЕО',               false, false, true, 60)
ON CONFLICT (name) DO NOTHING;

-- admin/super — все разделы полностью (для показа в матрице; на сервере они её обходят)
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, true, true, true
FROM app.role r,
     unnest(ARRAY['home','deviations','onelink','admin','templates','dashboard','journeys','access','promo']) s
WHERE r.is_admin OR r.is_super_admin
ON CONFLICT DO NOTHING;

-- СЕО: просмотр всех не-админских разделов
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, false, false, false
FROM app.role r,
     unnest(ARRAY['home','deviations','onelink','admin','templates','dashboard','promo']) s
WHERE r.name = 'СЕО'
ON CONFLICT DO NOTHING;

-- Тимлид/Аналитик: просмотр всех + правка (add/edit, без delete) в writable-разделах
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, (s IN ('admin','templates','promo')), (s IN ('admin','templates','promo')), false
FROM app.role r,
     unnest(ARRAY['home','deviations','onelink','admin','templates','dashboard','promo']) s
WHERE r.name IN ('Тимлид аналитики', 'Аналитик')
ON CONFLICT DO NOTHING;

-- Маркетолог: просмотр всех + полное управление промо
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT r.id, s, true, (s = 'promo'), (s = 'promo'), (s = 'promo')
FROM app.role r,
     unnest(ARRAY['home','deviations','onelink','admin','templates','dashboard','promo']) s
WHERE r.name = 'Маркетолог'
ON CONFLICT DO NOTHING;

-- Привязка учёток к ролям по старому перечислению
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS role_id bigint REFERENCES app.role(id);

UPDATE app.users u SET role_id = r.id FROM app.role r WHERE u.role_id IS NULL AND (
       (u.role = 'SUPER_ADMIN' AND r.name = 'Супер админ')
    OR (u.role = 'ADMIN'       AND r.name = 'Проджект-менеджер')
    OR (u.role = 'EDITOR'      AND r.name = 'Тимлид аналитики')
    OR (u.role = 'READER'      AND r.name = 'СЕО'));

-- страховка: неизвестная старая роль → СЕО (только просмотр)
UPDATE app.users SET role_id = (SELECT id FROM app.role WHERE name = 'СЕО') WHERE role_id IS NULL;

ALTER TABLE app.users ALTER COLUMN role_id SET NOT NULL;

-- старую строковую роль и её ограничение убираем
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE app.users DROP COLUMN IF EXISTS role;
