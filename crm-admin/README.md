# CRM Admin (самописная замена Appsmith)

Панель управления коммуникациями на **Java 21 / Spring Boot**. CRUD по 4 каналам
(push / email / sms / КЦ) поверх корпоративной PostgreSQL, UI взят из прототипа v1,
OneLink Builder перенесён 1:1. Разворачивается в Docker.

## Быстрый старт (локально, своя БД в контейнере)

```bash
cp .env.example .env          # при желании поправьте ADMIN_EMAIL / ADMIN_PASSWORD
docker compose up --build
```

- UI: <http://localhost:8080> → редирект на `login.html`
- Вход: `ADMIN_EMAIL` / `ADMIN_PASSWORD` из `.env` (по умолчанию `admin@banki.ru` / `admin12345`)
- Swagger: <http://localhost:8080/swagger-ui.html>

Профиль `docker` поднимает PostgreSQL, накатывает схему (Flyway) и демо-данные.

## Переключение на прод-БД

Схема на проде уже есть, поэтому миграции выключаются:

```bash
SPRING_PROFILES_ACTIVE=prod
DB_URL=jdbc:postgresql://<prod-host>:5432/<db>
DB_USER=...
DB_PASSWORD=...
```

Имена таблиц вынесены в `application.yml` (`app.tables.*`) — совпадают с продом
(`notice.push_template`, `notice.email_template`, `notice.d_com_sms_template`,
`callcenter.d_segment_properties`).

## Роли (RBAC)

| Роль | Возможности |
|------|-------------|
| READER | просмотр назначенных разделов |
| EDITOR | + создание/редактирование/удаление шаблонов |
| ADMIN | + раздел «Управление доступом»: пользователи, роли, разделы, сброс паролей |

Логин = корпоративная почта, пароль пользователь задаёт сам (BCrypt). Разделы,
видимые пользователю, назначает админ поперсонально. Первый супер-админ создаётся
из env при старте.

## API (основное)

| Метод | Путь | Доступ |
|-------|------|--------|
| GET | `/api/templates` | чтение |
| GET | `/api/templates/{channel}/{code}` | чтение |
| POST | `/api/templates/{channel}` | EDITOR/ADMIN |
| POST | `/api/templates/{channel}/chain` | EDITOR/ADMIN (batch «цепочка») |
| PUT | `/api/templates/{channel}/{code}` | EDITOR/ADMIN |
| DELETE | `/api/templates/{channel}/{code}` | EDITOR/ADMIN |
| GET | `/api/dictionaries/partners`, `/cc-segments` | чтение |
| GET | `/api/me` | аутентиф. |
| PUT | `/api/me/password` | аутентиф. |
| `/api/admin/users` (CRUD), `/api/admin/sections` | ADMIN |

## Что вне скоупа (пока)
- Дашборд (остаётся демо из v1).
- Панель отклонений и OneLink — клиентские, как в v1 (OneLink 1:1).
- Корпоративный SSO/LDAP (сейчас локальная аутентификация; архитектура готова к подключению).
- CSRF временно отключён (внутренний инструмент за аутентификацией) — включить перед внешней публикацией.
