---
tags: [api, rest, reference]
---

# REST API

Полный справочник HTTP-эндпоинтов бэкенда `crm-admin`. Все пути под `/api/**` (кроме публичных) требуют аутентификации по session-cookie; правила см. [[SecurityConfig]]. Двухслойная модель доступа описана в [[RBAC]].

Столбец «Доступ» указывает эффективное требование: ролевое (`@PreAuthorize` / правило [[SecurityConfig]]) и/или секционный ACL ([[AccessGuard]]). Секция-требование помечено `sec:`.

## Аутентификация (form-login, [[SecurityConfig]])

| Method | Path | Назначение | Доступ (роль) | Тело/параметры |
|---|---|---|---|---|
| POST | `/api/login` | Вход (form-login). Успех → `200`, ошибка → `401` | публичный | form-params: `email`, `password` |
| POST | `/logout` | Выход. Успех → `200` | публичный | — |

## Идентичность — [[AuthController]]

| Method | Path | Назначение | Доступ (роль) | Тело/параметры |
|---|---|---|---|---|
| GET | `/api/me` | Идентичность + возможности (email, role, canEdit, isAdmin, sections) для NAV и UI | аутентифицированный | — |
| PUT | `/api/me/password` | Смена собственного пароля | аутентифицированный | JSON `ChangeOwnPassword{currentPassword, newPassword}` (newPassword ≥ 8) |

## Шаблоны — [[TemplateController]]

| Method | Path | Назначение | Доступ (роль) | Тело/параметры |
|---|---|---|---|---|
| GET | `/api/templates` | Единый список шаблонов | аутентифицированный, `sec: templates\|admin` | query (опц.): `channel`, `product`, `touch`, `trigger`, `active` |
| GET | `/api/templates/{channel}/{code}` | Один шаблон | аутентифицированный, `sec: templates\|admin` | path: `channel`, `code` |
| POST | `/api/templates/{channel}` | Создать шаблон | `EDITOR`/`ADMIN`, `sec: admin\|templates` | path: `channel`; JSON `TemplateDto` (валидируется) |
| POST | `/api/templates/{channel}/chain` | Создать цепочку шаблонов | `EDITOR`/`ADMIN`, `sec: admin\|templates` | path: `channel`; JSON `ChainRequest{base, days}` |
| PUT | `/api/templates/{channel}/{code}` | Обновить шаблон | `EDITOR`/`ADMIN`, `sec: admin\|templates` | path: `channel`, `code`; JSON `TemplateDto` |
| DELETE | `/api/templates/{channel}/{code}` | Удалить шаблон | `EDITOR`/`ADMIN`, `sec: admin\|templates` | path: `channel`, `code` |

## Справочники — [[DictionaryController]]

| Method | Path | Назначение | Доступ (роль) | Тело/параметры |
|---|---|---|---|---|
| GET | `/api/dictionaries/partners` | Список партнёров | аутентифицированный | — |
| GET | `/api/dictionaries/cc-segments` | Список CC-сегментов | аутентифицированный | — |
| GET | `/api/dictionaries/comm-names` | Названия коммуникаций | аутентифицированный | query (опц.): `channel` |

## Администрирование пользователей — [[AdminUserController]]

Весь префикс `/api/admin/**` защищён `hasRole("ADMIN")` в [[SecurityConfig]].

| Method | Path | Назначение | Доступ (роль) | Тело/параметры |
|---|---|---|---|---|
| GET | `/api/admin/sections` | Каталог секций для UI | `ADMIN` | — |
| GET | `/api/admin/users` | Список пользователей | `ADMIN` | — |
| POST | `/api/admin/users` | Создать пользователя | `ADMIN` | JSON `CreateUser{email, displayName, role, password, sections}` (password ≥ 8) |
| PUT | `/api/admin/users/{id}` | Обновить пользователя | `ADMIN` | path: `id`; JSON `UpdateUser{displayName, role, enabled, sections}` |
| DELETE | `/api/admin/users/{id}` | Удалить пользователя | `ADMIN` | path: `id` |
| PUT | `/api/admin/users/{id}/password` | Сброс пароля пользователя | `ADMIN` | path: `id`; JSON `ResetPassword{newPassword}` (≥ 8) → `{"status":"ok"}` |

## Прочее

| Method | Path | Назначение | Доступ (роль) | Тело/параметры |
|---|---|---|---|---|
| GET | `/swagger-ui.html` | Swagger UI (springdoc) | аутентифицированный (общее правило) | — |

## Связанные заметки
[[AuthController]] · [[TemplateController]] · [[DictionaryController]] · [[AdminUserController]] · [[SecurityConfig]] · [[AccessGuard]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/web/AuthController.java`
- `src/main/java/ru/banki/crm/web/TemplateController.java`
- `src/main/java/ru/banki/crm/web/DictionaryController.java`
- `src/main/java/ru/banki/crm/web/AdminUserController.java`
- `src/main/java/ru/banki/crm/security/SecurityConfig.java`
