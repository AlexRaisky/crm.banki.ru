-- Гранулярные права доступа. Раньше строка в user_sections означала «раздел виден»,
-- а что с ним можно делать, задавала одна роль на всю учётку (READER/EDITOR). Теперь у
-- каждой пары «пользователь × раздел» свои флаги read/add/edit/delete. Роль осталась, но
-- только как пресет, которым матрица заполняется при заведении пользователя — истина
-- теперь эти столбцы, а не роль.
ALTER TABLE app.user_sections
    ADD COLUMN IF NOT EXISTS can_read   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS can_add    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_edit   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false;

-- Перенос текущих прав: EDITOR имел полный CRUD на своих разделах, READER — только
-- чтение (её и даёт DEFAULT true для can_read). Админов включаем ради консистентного
-- показа в матрице — на enforcement это не влияет, они обходят матрицу на сервере.
UPDATE app.user_sections us
   SET can_add = true, can_edit = true, can_delete = true
  FROM app.users u
 WHERE us.user_id = u.id
   AND u.role IN ('EDITOR', 'ADMIN', 'SUPER_ADMIN');
