---
tags: [architecture, security, rbac, authorization]
---

# RBAC

Модель доступа `crm-admin` двухмерна и **авторитетна на сервере**. Фронтенд использует её лишь для отрисовки NAV и скрытия кнопок; фактическое разграничение всегда выполняет бэкенд.

Два ортогональных измерения:
1. **Роль (capability)** — что пользователь *умеет делать*. Одна на пользователя: `READER` / `EDITOR` / `ADMIN` (enum [[Role]]).
2. **Секции (visibility, per-user ACL)** — какие *разделы* пользователю видны/доступны. Набор строк-идентификаторов на пользователя ([[AppUser]].`sections`).

Правило из кода: *«role sets capability, sections set visibility. ADMIN bypasses»* — `ADMIN` минует секционные проверки полностью (см. [[AccessGuard]]).

## Роли (уровни возможностей)

Из [[Role]]:
- **READER** — только чтение назначенных секций.
- **EDITOR** — READER + создание/редактирование/удаление шаблонов.
- **ADMIN** — EDITOR + управление пользователями, назначение ролей и секций; обход секционного ACL.

Роль превращается в Spring Security authority вида `ROLE_<name>` в [[AppUserPrincipal]].`getAuthorities()`.

## Секции (per-user ACL)

Канонические id из `Sections`:
`home`, `deviations`, `onelink`, `admin` (Мастер коммуникаций), `templates` (Список шаблонов), `dashboard`, `access` (Управление доступом, только ADMIN).

Хранятся в таблице `app.user_sections` (`@ElementCollection` в [[AppUser]]). Каталог для UI отдаёт `GET /api/admin/sections`.

## Матрица возможностей

| Возможность | READER | EDITOR | ADMIN |
|---|---|---|---|
| Просмотр шаблонов (при наличии секции `templates`/`admin`) | ✅ | ✅ | ✅ |
| Создание/редактирование/удаление шаблонов | ❌ | ✅ | ✅ |
| Просмотр справочников `/api/dictionaries/**` | ✅ | ✅ | ✅ |
| `GET /api/me`, смена своего пароля | ✅ | ✅ | ✅ |
| Управление пользователями `/api/admin/**` | ❌ | ❌ | ✅ |
| Обход секционного ACL | ❌ | ❌ | ✅ |

Примечание: для не-ADMIN просмотр/правка шаблонов дополнительно требует секцию `templates` или `admin` (проверка [[AccessGuard]].`requireAnySection`). ADMIN секции не требуются.

## Как `GET /api/me` управляет server-driven навигацией

`GET /api/me` ([[AuthController]]) возвращает `MeDto(email, displayName, role, canEdit, isAdmin, sections)`:
- `canEdit = role ∈ {EDITOR, ADMIN}` — фронт скрывает/показывает кнопки создания/редактирования.
- `isAdmin = role == ADMIN` — показ раздела «Управление доступом».
- `sections` — какие пункты NAV рисовать.

Таким образом навигация «управляется сервером»: клиент не хардкодит меню, а строит его из ответа `/api/me`. Но это только UX — обход клиентских ограничений ничего не даёт, потому что каждый защищённый эндпоинт заново проверяется на сервере.

## Слои enforcement (сервер авторитетен)

1. **Аутентификация** — session-cookie form-login; `anyRequest().authenticated()` в [[SecurityConfig]]. Неаутентифицированный XHR к `/api/**` → `401`.
2. **URL-роль** — `/api/admin/**` → `hasRole("ADMIN")` в [[SecurityConfig]].
3. **Метод-роль** — `@PreAuthorize("hasAnyRole('EDITOR','ADMIN')")` на мутациях [[TemplateController]] (включено `@EnableMethodSecurity`).
4. **Секционный ACL** — `AccessGuard.requireAnySection(...)` внутри контроллеров → `403`, если нет нужной секции (ADMIN минует).

Полная карта эндпоинтов и требований — в [[REST API]].

## Связанные заметки
[[SecurityConfig]] · [[REST API]] · [[AppUser]] · [[Role]] · [[AccessGuard]] · [[AppUserPrincipal]] · [[AuthController]]

## Источник
- `src/main/java/ru/banki/crm/domain/Role.java`
- `src/main/java/ru/banki/crm/domain/AppUser.java`
- `src/main/java/ru/banki/crm/service/Sections.java`
- `src/main/java/ru/banki/crm/dto/MeDto.java`
- `src/main/java/ru/banki/crm/security/AccessGuard.java`
- `src/main/java/ru/banki/crm/security/SecurityConfig.java`
- `src/main/java/ru/banki/crm/web/AuthController.java`
