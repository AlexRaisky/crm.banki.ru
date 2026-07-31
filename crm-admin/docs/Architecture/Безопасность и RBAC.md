---
tags: [architecture, security, rbac, auth]
---

# Безопасность и RBAC

Единственная каноническая заметка про доступ: вход, роли, матрица прав, разделы, супер-админ, серверные проверки. Все остальные заметки ссылаются сюда, а не пересказывают.

Проверено по `security/SecurityConfig.java`, `security/CustomUserDetailsService.java`, `security/AppUserPrincipal.java`, `security/CurrentUser.java`, `security/AccessGuard.java`, `domain/Role.java`, `domain/SectionAccess.java`, `domain/Capability.java`, `domain/AppUser.java`, `service/Sections.java`, `service/RoleService.java`, `service/UserService.java`, `config/AdminBootstrap.java`, `web/AuthController.java`, `web/AdminUserController.java`, `web/RoleController.java`, `web/TemplateController.java`, `web/PromoPlanController.java`, `web/SmsCheckReportController.java`, `web/JourneyController.java`, `web/FlowController.java`, `web/PanelSettingsController.java`, `web/ReportConnectionController.java` и миграциям `V2`, `V20`–`V23`.

## Главное изменение: роли — это данные

До V21 роль была перечислением (`READER` / `EDITOR` / `ADMIN` / `SUPER_ADMIN`), а видимые разделы — персональным списком в `app.user_sections`.

Сейчас:

- **`app.role`** — справочник ролей: `name`, `is_admin`, `is_super_admin`, `is_system`, `sort_order`;
- **`app.role_section`** — матрица роли: строка на пару «роль × раздел» с флагами `can_read` / `can_add` / `can_edit` / `can_delete`;
- **`app.users.role_id`** — у пользователя только ссылка на роль, персональной матрицы нет.

Права **живые**: они принадлежат роли, все её носители делят один набор — правка роли немедленно меняет доступ всем. Таблица `app.user_sections` осиротела (V21 её намеренно не удалил, оставив резерв под будущие персональные исключения) — **enforcement на неё не смотрит**, `AppUser` её больше не мапит.

```mermaid
flowchart LR
    U["app.users<br/>email · password_hash · enabled · role_id"] --> R["app.role<br/>is_admin · is_super_admin · is_system"]
    R --> RS["app.role_section<br/>section_id × read/add/edit/delete"]
    U -.->|"осиротела, не читается"| US["app.user_sections"]
```

## Вход и сессия (`security/SecurityConfig`)

Одна `SecurityFilterChain` + `@EnableMethodSecurity`.

| Что | Как |
|---|---|
| Публичные URL | `/login.html`, `/api/login`, `/logout`, `/favicon.ico`, `/error` |
| URL-правила | `/api/admin/**` → `hasRole("ADMIN")`, `/settings/**` → `hasRole("ADMIN")`, остальное → `authenticated()` |
| Form-login | страница `/login.html`, обработчик `POST /api/login`, параметр логина — **`email`** (не `username`), пароль — `password`; успех → пустой `200`, неудача → `401` |
| Remember-me | `alwaysRemember(true)` (без чекбокса), срок `REMEMBER_ME_DAYS` (30 дней), ключ `REMEMBER_ME_KEY`, имя куки `REMEMBER_COOKIE` |
| Сессия | таймаут `SESSION_TIMEOUT` (`7d`), имя куки `SESSION_COOKIE` (без переопределения — `JSESSIONID`) |
| Logout | `POST /logout` удаляет обе куки, возвращает `200` |
| Неавторизованный | `/api/**` → чистый `401` (XHR сам редиректит), обычная навигация → `/login.html` |
| Пароли | `BCryptPasswordEncoder` |
| CSRF | **отключён** (`csrf.disable()`) — внутренний инструмент за аутентификацией; см. «Ограничения» |

Имена кук свои на каждую среду — три контура живут на одном хосте, а браузер скоупит куки без учёта порта; к `REMEMBER_ME_KEY` compose добавляет суффикс среды, поэтому токен одной среды недействителен в другой (см. [[Среды и деплой]]).

Цепочка классов: `CustomUserDetailsService.loadUserByUsername(email)` → `AppUserRepository.findByEmailIgnoreCase` → `AppUserPrincipal`. Principal отдаёт `user()`, `email()`, `sections()`, `hasCapability(section, cap)`; `isEnabled()` берётся из флага `enabled` (выключенная учётка не входит). `CurrentUser` — статические хелперы поверх `SecurityContextHolder`, `CurrentUser.email()` с фолбэком `"system"` для действий вне HTTP-контекста.

**Authorities выводятся из флагов роли, а не из её имени** (`AppUserPrincipal.getAuthorities`):

- `is_super_admin` → `ROLE_SUPER_ADMIN` + `ROLE_ADMIN`;
- `is_admin` → `ROLE_ADMIN`;
- прочие → `ROLE_USER`.

Отсюда следствие: аннотаций вида `hasAnyRole('EDITOR','ADMIN')` больше некому удовлетворить кроме админа — роли `EDITOR` в authorities не существует. Такие аннотации, оставшиеся в `JourneyController`, ничего не ослабляют (класс и так под `hasRole('ADMIN')`), но и ничего не дают.

## Встроенные роли

Засеяны миграциями V21 (+ роль «Админ» в V22), у всех `is_system = true` — переименовать и удалить нельзя.

| Роль | `is_admin` | Порядок | Доступ |
|---|---|---|---|
| **Супер админ** | супер | 10 | всё; роль скрыта из UI, привязана к `ADMIN_EMAIL` |
| **Админ** | да | 15 | все 15 разделов полностью; роль-«прикрытие» для супер-админа |
| **Проджект-менеджер** | да | 20 | все 15 разделов полностью |
| **Тимлид аналитики** | нет | 30 | просмотр всех разделов; add/edit (без delete) в `admin`, `templates`, `promo` |
| **Аналитик** | нет | 40 | то же, что тимлид |
| **Маркетолог** | нет | 50 | **только 5 разделов и только просмотр** (V23) |
| **СЕО** | нет | 60 | просмотр всех не-админских разделов |

**Маркетолог (V23 от 30.07.2026)** — сужен: прежний набор секций роли удаляется целиком и заменяется на `promo`, `srcbuilder`, `templates`, `admin`, `reports` с `can_read = true` и без add/edit/delete. Раздел `admin` здесь означает «Просмотр настроек» — та же секция, что и мастер, правка всё равно закрыта.

Админ-роли обходят матрицу на сервере; строки в `role_section` им проставляются полностью только ради корректного показа в UI (`RoleService.buildAccess`).

## Разделы (`service/Sections`)

`Sections.ALL` — 15 канонических id; список обязан совпадать с id пунктов NAV (`js/shell.js`, массив `NAV` — см. [[Оболочка панели (shell)]]).

| id | Раздел UI | Writable | Только админ |
|---|---|---|---|
| `home` | Главная | | |
| `deviations` | Панель отклонений | | |
| `onelink` | OneLink Builder | | |
| `admin` | Мастер коммуникаций | ✔ | |
| `templates` | Список шаблонов | ✔ | |
| `dashboard` | Дашборд | | |
| `journeys` | Цепочки | | ✔ |
| `access` | Управление доступом | | ✔ |
| `promo` | Планирование промо | ✔ | |
| `abtests` | А/Б тесты | ✔ | |
| `srcbuilder` | Конструктор source | | |
| `reports` | Отчёты | | |
| `heatmap` | Тепловая карта | | |
| `monitoring` | Мониторинг | | |
| `uploads` | Загруженные инструменты | | |

- **`Sections.WRITABLE`** (`admin`, `templates`, `promo`, `abtests`) — единственные разделы, где у не-админа осмысленны add/edit/delete: у остальных нет серверных ручек записи. В матрице роли у не-writable разделов показывается только чекбокс «Просмотр», а `RoleService.buildAccess` гасит лишние флаги при сохранении.
- **`Sections.ADMIN_ONLY`** (`journeys`, `access`) — доступ к ним даёт роль администратора, а не матрица; в матрице не-админа они не показываются.
- `Sections.isValid(id)` — валидация; `GET /api/admin/sections` отдаёт `{id, writable, adminOnly}` для построения матрицы в UI.

## Проверки на сервере

`security/AccessGuard` — единственная точка проверки матрицы:

- `requireCapability(cap, sectionIds...)`: нет principal → `401`; роль с `isAdminLevel()` (админ или супер-админ) → пропуск без проверки; есть право `cap` хотя бы в одном из перечисленных разделов → пропуск; иначе `403 «Нет доступа к разделу»`;
- `requireAnySection(sectionIds...)` — то же самое с `Capability.READ`.

Несколько разделов в одном вызове — потому что одни данные бывают за двумя разделами: шаблоны видны и из `admin` (мастер), и из `templates` (список), права достаточно иметь в любом. Гард вызывается явной первой строкой метода, а не аннотацией.

Соответствие «HTTP-глагол → capability»: `GET` → READ, `POST` → ADD, `PUT`/`PATCH` → EDIT, `DELETE` → DELETE.

| Что защищаем | Как |
|---|---|
| `TemplateController` | чтение — READ в `templates`/`admin`; `POST` — ADD; `PUT` — EDIT; `DELETE` — DELETE (в любом из двух разделов) |
| `PromoPlanController` | READ / ADD / EDIT / DELETE в `promo` |
| `SmsCheckReportController` | READ в `reports` |
| `JourneyController`, `FlowController` | `@PreAuthorize("hasRole('ADMIN')")` на классе + `requireAnySection(JOURNEYS)` в каждом методе |
| `AdminUserController`, `RoleController`, `ProdSyncController`, `EtlController`, `DbConnectionController` | без аннотаций — весь префикс `/api/admin/**` закрыт правилом URL |
| `PanelSettingsController` | `GET` — любой аутентифицированный (оболочке нужен конфиг приложений), `PUT` — `hasRole('ADMIN')`; ключи с секретами внутри значения обслуживать отказывается |
| `ReportConnectionController` | `GET` — любой аутентифицированный, но токен Tableau уходит только админу (прочим — `hasToken`); `PUT`/`DELETE` — `hasRole('ADMIN')` |
| `/settings/**` | статическая настроечная админка — `hasRole('ADMIN')` |

## Что получает фронт: `GET /api/me`

`AuthController.me()` → `MeDto(email, displayName, role, canEdit, isAdmin, sections, isSuperAdmin, caps)`:

- `sections` — что видно в NAV. Админу отдаётся весь `Sections.ALL` (новые разделы появляются у админов автоматически), не-админу — разделы его роли **минус `journeys`** (цепочки только админам, даже если раздел есть в матрице).
- `caps` — карта «раздел → `{read, add, edit, delete}`»; по ней фронт прячет кнопки. Админу — всё `true` по всем разделам.
- `canEdit` — грубый флаг «может писать хоть где-то», управляет `data-readonly` на `<body>`.
- `role` — имя роли; у супер-админа подменяется на `«Админ»`.

Фильтрация NAV — `applyNavAcl` в `api.js`: пункт скрывается, если его id (или `data-acl-section`) отсутствует в `me.sections`; `data-admin-only` удаляет пункт у не-админа; `data-no-acl` выводит пункт из-под ACL; группа скрывается, когда скрыты все её ACL-дети. Это только UX — сервер проверяет всё сам. Механизм `data-envs` (гейтинг пункта по среде) в коде остался, но сейчас ни один пункт `NAV` его не использует.

Два нюанса, видных по коду:

1. пункт «Главная» фильтруется по ACL наравне с остальными (`renderNav` не ставит ему `data-no-acl`), поэтому роль без секции `home` главную не увидит;
2. «Планирование промо» помечено `noAcl:true` — в NAV не фильтруется, но серверный `PromoPlanController` требует прав на секцию `promo`.

## Супер-админ

Супер-роль — обычная запись справочника с `is_super_admin = true`, но наружу она не видна:

- `RoleService.list()` **исключает** её из списка ролей — никому, включая самого супер-админа;
- `UserService.toView()` показывает носителя супер-роли под именем роли-прикрытия: сначала ищется роль с именем «Админ», иначе первая обычная админ-роль по `sort_order`; `roleId` при этом не отдаётся;
- `AuthController.me()` возвращает такому пользователю `role = "Админ"`; полномочия работают по отдельному флагу `isSuperAdmin`;
- `RoleService.toView()` добавляет супер-админов к счётчику носителей роли-прикрытия, чтобы цифра сходилась со списком пользователей.

**`config/AdminBootstrap`** (`CommandLineRunner`, идемпотентен, на каждом старте):

1. пустые `ADMIN_EMAIL`/`ADMIN_PASSWORD` → предупреждение и выход; отсутствует супер-роль → ошибка в лог (не накатана V21) и выход;
2. любой чужой носитель супер-роли **понижается** до обычной админ-роли;
3. учётка `ADMIN_EMAIL` либо повышается до супер-роли, либо создаётся заново (displayName «Администратор», `enabled = true`, пароль BCrypt). Пароль существующей учётки не перезаписывается.

## Управление пользователями и ролями

Раздел «Управление доступом» переехал в настроечную админку `/settings` (панель `pane-access`) — интерфейс описан в [[Управление доступом и вход]].

**`service/UserService`** (`/api/admin/users`):

- `create` — email `trim().toLowerCase()`; домен проверяется всегда: `APP_EMAIL_DOMAIN`, а при пустом значении — **`banki.ru`** (пустая переменная проверку НЕ отключает), иначе `400 «Разрешены только адреса @…»`; дубль → `409`; роль обязательна (`roleId`), пароль BCrypt;
- `update` — частичный (только non-null поля: displayName, roleId, enabled);
- `delete` — последнего носителя админ-уровня удалить нельзя (`409`);
- `resetPassword` (админом) и `changeOwnPassword` (`PUT /api/me/password`, с проверкой текущего пароля).

Правила вокруг админ-ролей (одинаковый текст отказа `«Недостаточно прав для этой операции»`, чтобы по сообщению нельзя было выяснить расширенные права чужой учётки):

- назначить супер-роль через панель нельзя никому;
- назначить админ-роль может только супер-админ;
- учётку супер-админа через панель не меняют вовсе; учётку с админ-ролью — только супер-админ;
- флаг `manageable` в `UserView` сообщает фронту, что строка недоступна для правки, не раскрывая причину.

**`service/RoleService`** (`/api/admin/roles`): создавать и править обычные роли может любой админ, роли с админ-флагом (и смену самого флага в любую сторону) — только супер-админ; супер-роль неприкосновенна; встроенную (`is_system`) роль нельзя переименовать и удалить; роль, назначенную пользователям, удалить нельзя (`409` с числом носителей).

## Аудит как часть модели

Каждое изменение привязано к личности `CurrentUser.email()`: прикладной журнал `arch.t_admin_log` (`AdminLogService`) и прод-триггерный `arch.arch_log`, для которого `AuditContext` выставляет GUC `app.current_user` в той же транзакции. Подробно — [[Аудит и журналирование]].

## Известные ограничения / follow-ups

1. **CSRF отключён** — включить `CookieCsrfTokenRepository` + токен-заголовок в `api.js` до любой публикации наружу (комментарий в `SecurityConfig`, пункт README).
2. **Нет SSO/LDAP** — аутентификация локальная; точка расширения — `CustomUserDetailsService`.
3. **Дефолтный `REMEMBER_ME_KEY`** (`crm-admin-remember-me-key-change-me`) обязателен к замене в проде, иначе токены подделываемы.
4. Дефолтный пароль супер-админа в `.env.example` / compose (`admin12345`) — сменить при развёртывании.
5. Персональных исключений из прав роли нет: единственный способ дать одному человеку другой набор — завести отдельную роль (таблица `app.user_sections` под это зарезервирована, но не используется).

## Связанные заметки

[[Обзор архитектуры]] · [[Среды и деплой]] · [[Управление доступом и вход]] · [[Оболочка панели (shell)]] · [[Таблицы приложения]] · [[Конфигурация]] · [[REST API]] · [[Аудит и журналирование]]
