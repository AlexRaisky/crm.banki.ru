---
tags: [database, table, app, auth, rbac, acl]
---

# app.user_sections (таблица)

Схема-квалифицированное имя: **`app.user_sections`**.

Таблица per-user ACL: какие **разделы интерфейса** видит конкретный пользователь. Роль в [[app.users (таблица)]] задаёт уровень возможностей, а набор видимых разделов админ назначает поперсонально через эту таблицу. JPA-сущность — [[UserSectionAccess]]. Подробнее — [[RBAC]].

- **Составной первичный ключ:** `(user_id, section_id)`.
- **Внешний ключ:** `user_id` → `app.users(id)` с `ON DELETE CASCADE` (при удалении пользователя его разделы удаляются автоматически).
- **Значения `section_id`** (из NAV v1): `home` | `deviations` | `onelink` | `admin` | `templates` | `dashboard` | `access`.
- После входа `GET /api/me` возвращает роль + список разрешённых разделов, по которому фронт строит навигацию (server-driven NAV).

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| user_id | bigint | да (PK, FK) | Пользователь, FK → `app.users(id)` ON DELETE CASCADE |
| section_id | text | да (PK) | Идентификатор раздела (home / deviations / onelink / admin / templates / dashboard / access) |

## Источник

- `src/main/resources/db/migration/V2__auth.sql`
