---
tags: [database, table, app, auth, rbac]
---

# app.users (таблица)

Схема-квалифицированное имя: **`app.users`**.

Таблица пользователей приложения для **аутентификации и RBAC**. Живёт в собственной схеме `app`, отдельной от корпоративных схем шаблонов. Пользователь входит по корпоративной почте, пароль задаёт сам (хранится как BCrypt-хеш). `role` — уровень возможностей (READER / EDITOR / ADMIN); видимые разделы задаются отдельно в [[app.user_sections (таблица)]]. JPA-сущность — [[AppUser]]. Подробнее о ролях — [[RBAC]].

- **Первичный ключ:** `id` (bigserial — автоинкрементная последовательность).
- **Уникальность:** `email` — UNIQUE (логин).
- **CHECK-ограничение:** `chk_users_role` — `role IN ('READER','EDITOR','ADMIN')`.
- Первичный супер-админ создаётся идемпотентно при старте из env `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- **Аудит-триггера нет** (аудитируются только 4 таблицы шаблонов). См. [[Схема БД]].

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| id | bigserial | да (PK) | Автоинкрементный первичный ключ |
| email | text | да | Логин (корпоративная почта), UNIQUE |
| password_hash | text | да | BCrypt-хеш пароля |
| display_name | text | нет | Отображаемое имя |
| role | text | да | Роль: `READER` \| `EDITOR` \| `ADMIN`, DEFAULT `'READER'`, CHECK `chk_users_role` |
| enabled | boolean | да | Учётка активна, DEFAULT `true` |
| created_at | timestamptz | да | Дата создания, DEFAULT `now()` |

## Источник

- `src/main/resources/db/migration/V2__auth.sql`
- `src/main/resources/application.yml` (`app.admin.*`, `app.email-domain`)
