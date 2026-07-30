---
tags: [api, reference]
---

# REST API

Полный справочник HTTP-интерфейса crm-admin: **метод, путь, назначение, требуемое право**. Это единственное место со списком эндпоинтов — остальные заметки ссылаются сюда, а не перечисляют пути у себя. Доменные подробности каждой подсистемы — по ссылкам в заголовках разделов.

Все контроллеры лежат в `src/main/java/ru/banki/crm/web/`, по одному на подсистему.

| Контроллер | Префикс | Подсистема |
|---|---|---|
| `AuthController` | `/api/me` | профиль текущего пользователя |
| `EnvController` | `/api/env` | среда инстанса |
| `TemplateController` | `/api/templates` | шаблоны коммуникаций — [[Шаблоны и мастер коммуникаций]] |
| `DictionaryController` | `/api/dictionaries` | справочники для форм |
| `JourneyController` | `/api/journeys` | цепочки-схемы — [[Цепочки (Journeys)]] |
| `FlowController` | `/api/flow` | материализация — [[Материализация (Flow)]] |
| `PromoPlanController` | `/api/promo/plan` | план промо — [[Планирование промо]] |
| `SmsCheckReportController` | `/api/reports/sms-check` | выгрузка «ЧЕК СМС траффик» — [[Отчёты]] |
| `ReportConnectionController` | `/api/reports/connections` | подключения Tableau — [[Отчёты]] |
| `PanelSettingsController` | `/api/panel-settings` | настройки панели key → jsonb |
| `AdminUserController` | `/api/admin` | пользователи и каталог разделов — [[Безопасность и RBAC]] |
| `RoleController` | `/api/admin/roles` | роли и матрица прав — [[Безопасность и RBAC]] |
| `DbConnectionController` | `/api/admin/db-connections` | реестр подключений к БД |
| `EtlController` | `/api/admin/etl` | ETL «прод → мы» — [[Синхронизация с прод-БД]] |
| `ProdSyncController` | `/api/admin/prod-db` | очередь синка и сверка — [[Синхронизация с прод-БД]] |

Плюс два «сервисных» URL Spring Security (не контроллеры): `POST /api/login` и `POST /logout`.

## Общие сведения

- **Формат** — JSON везде, кроме `POST /api/login` (`application/x-www-form-urlencoded`) и `GET /api/reports/sms-check/download` (бинарный `.xlsx`).
- **Аутентификация** — сессионная кука + remember-me кука, без токенов в заголовках. Фронтовый слой `static/api.js` шлёт запросы с `credentials: "same-origin"`.
- **CSRF отключён** (внутренний инструмент за аутентификацией) — известный follow-up, см. [[Безопасность и RBAC]].
- **Swagger** — `springdoc-openapi`: UI на `/swagger-ui.html`, описание на `/v3/api-docs`. Оба требуют залогиненной сессии.
- **Ошибки** — стандартный error-ответ Spring Boot; `server.error.include-message: always` и `include-binding-errors: always`, поэтому поле `message` (и `errors` при ошибках `@Valid`) всегда на месте. Именно `message` показывает пользователю `api.js`.

| Код | Когда |
|---|---|
| `401` | нет сессии. XHR к `/api/**` получает чистый `401` (`HttpStatusEntryPoint`), браузерная навигация уводится на `/login.html` |
| `403` | нет нужного права в разделе (`AccessGuard`) либо не хватает роли |
| `400` | валидация `@Valid` или бизнес-проверка (тексты по-русски) |
| `404` | сущность не найдена; а также «настройка обслуживается отдельным API» |
| `409` | конфликт: дубль, удаление последнего админа, разошедшаяся версия строки, не настроен источник отчёта |
| `502` | ошибка запроса к внешней БД (DWH) |

## Модель прав

Три независимых механизма, все три описаны в [[Безопасность и RBAC]]:

1. **URL-правила `SecurityFilterChain`.** Публичны `/login.html`, `/api/login`, `/logout`, `/favicon.ico`, `/error`. Префиксы **`/api/admin/**` и `/settings/**` требуют `ROLE_ADMIN`**. Остальное — просто аутентификация.
2. **`@PreAuthorize` на классе/методе.** `JourneyController` и `FlowController` целиком под `hasRole('ADMIN')`; `PUT /api/panel-settings/{key}`, `PUT`/`DELETE /api/reports/connections/{report}` — `hasRole('ADMIN')`.
3. **Матрица прав роли по разделам** — `AccessGuard.requireCapability(cap, sections…)`: у пары «роль × раздел» свои флаги `read / add / edit / delete` (`Capability`). Глагол проверяется отдельно: GET → READ, POST → ADD, PUT/PATCH → EDIT, DELETE → DELETE. **Роль с флагом `is_admin` (и супер-админ) матрицу обходит целиком.**

Роли — это **данные** (`app.role` + `app.role_section`), а не enum. В Spring Security наружу выводятся только authority по флагам роли: `ROLE_SUPER_ADMIN` + `ROLE_ADMIN` у супер-админа, `ROLE_ADMIN` у админ-роли, `ROLE_USER` у всех прочих. Практическое следствие: **сохранившиеся в коде аннотации `hasAnyRole('EDITOR','ADMIN')` (мутации цепочек) фактически означают «только ADMIN»** — authority `ROLE_EDITOR` больше не выдаётся никому.

Канонический список разделов — `service/Sections`: `home`, `deviations`, `onelink`, `admin` (мастер коммуникаций), `templates`, `dashboard`, `journeys`, `access`, `promo`, `srcbuilder`, `reports`, `heatmap`, `monitoring`, `uploads`. Записи есть только у `admin`, `templates`, `promo` (`Sections.WRITABLE`) — у остальных значима лишь галка «Просмотр». `journeys` и `access` (`ADMIN_ONLY`) доступны по роли, а не по матрице.

## Аутентификация (Spring Security, без контроллера)

| Метод и путь | Назначение | Право |
|---|---|---|
| `POST /api/login` | вход; `application/x-www-form-urlencoded`, параметры `email` + `password` | публичный |
| `POST /logout` | выход, удаляет обе куки | публичный |

Успешный вход → `200` с пустым телом, ставятся сессионная кука и remember-me (30 дней, `alwaysRemember`); неверная пара → `401`. Имена кук свои на каждой среде — [[Среды и деплой]], [[Конфигурация]].

## Профиль и среда

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/me` | кто я: `email`, `displayName`, `role`, `canEdit`, `isAdmin`, `isSuperAdmin`, `sections`, `caps` | аутентификация |
| `PUT /api/me/password` | сменить свой пароль: `{currentPassword, newPassword}` | аутентификация |
| `GET /api/env` | `{name, devFeatures}` — среда инстанса и флаг dev-разделов | аутентификация |

`caps` — карта «раздел → `{read, add, edit, delete}`», по ней фронт прячет кнопки. Две особенности `GET /api/me` (обе — комментарии в `AuthController`): админу отдаётся весь `Sections.ALL`, чтобы новые разделы появлялись без правки матрицы; **не-админу раздел `journeys` не отдаётся никогда**. Супер-роль наружу не светится даже своему носителю — в `role` подставляется «Админ», полномочия работают по флагу `isSuperAdmin`.

`PUT /api/me/password`: `400 «Текущий пароль неверен»`, `400` валидации (`newPassword` — минимум 8 символов).

## Шаблоны коммуникаций → [[Шаблоны и мастер коммуникаций]]

Канал в пути: `sms | push | email | cc | fa | vk | la` (регистр нормализуется, неизвестный → `400 «Неизвестный канал: …»`). `code` — бизнес-идентификатор строкой.

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/templates` | единый список с фильтрами и пагинацией | READ в `templates` или `admin` |
| `GET /api/templates/facets` | значения фильтров (продукт/точка/триггер) из реальных данных | READ в `templates` или `admin` |
| `GET /api/templates/count` | `{total, active}` под теми же фильтрами | READ в `templates` или `admin` |
| `GET /api/templates/{channel}/{code}` | полная карточка `TemplateDto` | READ в `templates` или `admin` |
| `POST /api/templates/{channel}` | создать шаблон → `{code}` | ADD в `admin` или `templates` |
| `POST /api/templates/{channel}/chain` | батч «цепочка дней»: `{base, days[]}` → `{codes[]}` | ADD в `admin` или `templates` |
| `PUT /api/templates/{channel}/{code}` | обновить | EDIT в `admin` или `templates` |
| `DELETE /api/templates/{channel}/{code}` | удалить | DELETE в `admin` или `templates` |

Query-параметры списка (все опциональны, множественные — повторяемые): `channel`, `product`, `touch`, `trigger`, `partner`, `active` (`active` / любое другое непустое = неактивные), `q` (свободный поиск), `sort`, `dir`, `limit`, `offset`.

Ошибки: `404 «Шаблон не найден: {channel}/{code}»`; `400 «Для КЦ обязателен номер сегмента»`; `409 «Сегмент уже заведён: …»`; `400 «Нужны base и непустой список days»`.

Каждая мутация пишется в `arch.t_admin_log` ([[Аудит и журналирование]]) и ставит операцию в очередь синка ([[Синхронизация с прод-БД]]).

## Справочники

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/dictionaries/partners` | `["Альфа", …]` — distinct партнёры | аутентификация |
| `GET /api/dictionaries/cc-segments` | сегменты КЦ | аутентификация |
| `GET /api/dictionaries/comm-names?channel=sms` | distinct `communication_name` канала (без параметра — по всем) | аутентификация |
| `GET /api/dictionaries/touch-points` | точки касания | аутентификация |
| `GET /api/dictionaries/product-types` | типы продуктов (`d_product_type`, `V19`) | аутентификация |

Ни роль, ни разделы здесь не проверяются: данные нужны формам нескольких разделов.

## Цепочки-схемы → [[Цепочки (Journeys)]]

Контроллер целиком под `@PreAuthorize("hasRole('ADMIN')")`, каждый метод дополнительно требует READ на разделе `journeys`.

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/journeys` | список `{id, name, nodeCount, kind}` | ADMIN + раздел `journeys` |
| `GET /api/journeys/{id}` | схема целиком (`JourneyDto`) | ADMIN + раздел |
| `POST /api/journeys` | создать (тело без `id`) | ADMIN |
| `PUT /api/journeys/{id}` | полная замена схемы | ADMIN |
| `DELETE /api/journeys/{id}` | удалить | ADMIN |

Ошибки: `404 «Цепочка не найдена: {id}»`, `500 «Повреждён JSON цепочки …»`, `400` валидации. Цепочка **без стартового узла** сохраняется штатно — это вложенная цепочка (Subflow).

## Материализация → [[Материализация (Flow)]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `POST /api/flow/preview` | план вставок слоя B: `{problems[], rows[]}` | ADMIN + раздел `journeys` |
| `POST /api/flow/materialize` | сохранить цепочку и записать слои A и B одной транзакцией → `{journeyId, created[]}` | ADMIN + раздел `journeys` |

`preview` отдаёт `200` даже при непустом `problems` (проблемы — данные, не ошибка); FK показываются спецзначением `"(auto)"`. `materialize` при проблемах валидации → `400` с их перечнем; недопустимая таблица или колонка (белый список из 8 таблиц слоя B) → `400`.

## Планирование промо → [[Планирование промо]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/promo/plan` | весь план (заодно архивирует прошедшие «запланировано») | READ в `promo` |
| `POST /api/promo/plan` | завести промо; мультиканал → столько строк, сколько каналов | ADD в `promo` |
| `PATCH /api/promo/plan/{id}` | правка одного поля: `{field, value, ver}` | EDIT в `promo` |
| `DELETE /api/promo/plan/{id}` | удалить строку | DELETE в `promo` |

`ver` — `timestamp_upd`, который видел клиент: разошёлся → **`409 «Строку изменил другой пользователь»`**, строки уже нет → `404 «Строку уже удалили»`. Неизвестное поле → `400 «Поле нельзя менять: …»`; кривая дата → `400`.

## Отчёты → [[Отчёты]]

### «ЧЕК СМС траффик»

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/reports/sms-check/config` | текущий источник, список каналов, `canEdit` | READ в `reports` |
| `PUT /api/reports/sms-check/config` | задать источник-DWH: `{connectionId}` | READ в `reports` **+ роль-админ** (проверяет сервис) |
| `GET /api/reports/sms-check/download?month=YYYY-MM&channel=sms\|push\|email` | книга `.xlsx` за месяц | READ в `reports` |

Ошибки: `400` на кривой месяц/канал/`connectionId`; `403 «Менять источник может только администратор.»`; `409`, если источник не выбран или подключение удалено; `502` при ошибке запроса к DWH. Ответ `download` — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment`.

### Подключения Tableau

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/reports/connections` | `{canEdit, items}`; **не-админу вместо `token` только `hasToken`** | аутентификация |
| `PUT /api/reports/connections/{report}` | сохранить `{server, view, token}` | ADMIN |
| `DELETE /api/reports/connections/{report}` | сбросить подключение (единственный способ удалить токен) | ADMIN |

`report` — `[a-zA-Z][a-zA-Z0-9_-]{0,31}`, иначе `400`. `PUT` требует непустых `server` и `view` (`400`), пустой `token` не затирает сохранённый.

## Настройки панели

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/panel-settings/{key}` | значение настройки (`{key, value}`) | аутентификация |
| `PUT /api/panel-settings/{key}` | upsert произвольного JSON | ADMIN |

Ключ — `[a-zA-Z][a-zA-Z0-9_-]{0,63}`, иначе `400`. Основной потребитель — конфиг «приложение → разделы» под ключом `appSections`. **Ключ `tableauReports` этим эндпоинтом не обслуживается вовсе** (`404`, не `403`, регистр игнорируется) — внутри токен, обслуживает его `/api/reports/connections`. Каждая запись журналируется.

## Администрирование: `/api/admin/**`

Весь префикс закрыт `hasRole("ADMIN")` на уровне `SecurityFilterChain` — не-админ получает `403` до входа в контроллер, матрица разделов тут не участвует.

### Пользователи и каталог разделов → [[Безопасность и RBAC]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/sections` | каталог разделов: `{id, writable, adminOnly}` — для матрицы прав | ADMIN |
| `GET /api/admin/users` | список `UserView` | ADMIN |
| `POST /api/admin/users` | создать: `{email, displayName, roleId, password}` | ADMIN |
| `PUT /api/admin/users/{id}` | частичное обновление: `{displayName, roleId, enabled}` | ADMIN |
| `DELETE /api/admin/users/{id}` | удалить | ADMIN |
| `PUT /api/admin/users/{id}/password` | сброс пароля админом: `{newPassword}` → `{status:"ok"}` | ADMIN |

Ошибки: `409 «Пользователь уже существует: …»`, `409 «Нельзя удалить последнего администратора»`, `400 «Разрешены только адреса @…»` (при заданном `APP_EMAIL_DOMAIN`), `400 «Некорректная роль»`, `404 «Пользователь не найден»`. Назначать и снимать админ-роли может только супер-админ — иначе `403`; поле `manageable` в `UserView` показывает фронту, что запись правится текущим пользователем.

### Роли → [[Безопасность и RBAC]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/roles` | роли с матрицей прав, счётчиком носителей и `manageable` | ADMIN |
| `POST /api/admin/roles` | создать: `{name, isAdmin, access[]}` | ADMIN (админ-роль — только супер-админ) |
| `PUT /api/admin/roles/{id}` | переименовать / переписать матрицу | ADMIN (админ-роль — только супер-админ) |
| `DELETE /api/admin/roles/{id}` | удалить | ADMIN |

`access[]` — строки `{section, read, add, edit, delete}`. Ошибки: `409 «Роль с таким названием уже есть»`, `409 «Встроенную роль удалить нельзя»`, `409 «Роль назначена пользователям (N) — сначала переведите их на другую роль»`, `404 «Роль не найдена»`, `403 «Недостаточно прав для этой операции»`.

### Реестр подключений к БД

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/db-connections` | встроенные (наша/прод) + пользовательские, со статусом последней проверки | ADMIN |
| `POST /api/admin/db-connections` | добавить: `{name, jdbcUrl, username, password, purpose, active}` | ADMIN |
| `PUT /api/admin/db-connections/{id}` | изменить (пароль пишется только если прислан непустым) | ADMIN |
| `DELETE /api/admin/db-connections/{id}` | удалить | ADMIN |
| `POST /api/admin/db-connections/{id}/test` | проверить одно (`SELECT 1`); `id` — число либо `our-db` / `prod-db` | ADMIN |
| `POST /api/admin/db-connections/test-all` | проверить все и вернуть свежий список | ADMIN |

Пароль наружу не отдаётся — только флаг `hasPassword`. Этот же реестр даёт приёмник синка (`prodSync`) и источник DWH для отчёта.

### ETL «прод → мы» → [[Синхронизация с прод-БД]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/etl/status` | включён / идёт ли прогон / водяные знаки / итоги последнего прогона | ADMIN |
| `POST /api/admin/etl/run` | ручной инкремент (то же, что планировщик раз в 5 минут) | ADMIN |
| `POST /api/admin/etl/run-full` | ручной полный прогон (то же, что в 22:00) | ADMIN |

### Прод-БД: очередь и сверка → [[Синхронизация с прод-БД]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/prod-db/health` | соединение, наличие канальных таблиц, счётчики очереди | ADMIN |
| `GET /api/admin/prod-db/queue-stats` | только счётчики очереди (без коннекта к проду) | ADMIN |
| `GET /api/admin/prod-db/queue?limit=50&status=` | записи очереди (по умолчанию `PENDING` и `ERROR`; `status=all` — все) | ADMIN |
| `POST /api/admin/prod-db/process` | прогнать доставку прямо сейчас (до 200 записей) | ADMIN |
| `POST /api/admin/prod-db/retry/{id}` | повторить проблемную запись (сброс попыток) | ADMIN |
| `POST /api/admin/prod-db/cancel/{id}` | убрать запись из очереди (только `PENDING`/`ERROR`) | ADMIN |
| `GET /api/admin/prod-db/reconcile` | сверка `d_template` с продом: «только в проде / разошлись / только у нас» | ADMIN |
| `POST /api/admin/prod-db/reconcile/import` | импорт выбранных строк из прода (тело — список `{channel, code}`) | ADMIN |
| `POST /api/admin/prod-db/reconcile/import-all` | фоновый импорт всей прод-базы (одна задача за раз) | ADMIN |
| `GET /api/admin/prod-db/reconcile/import-all/status` | прогресс фонового импорта (для поллинга) | ADMIN |

## Сводная карта прав

| Эндпоинты | Аутентификация | Раздел и право | Роль |
|---|---|---|---|
| `POST /api/login`, `POST /logout` | публичные | — | — |
| `GET /api/me`, `PUT /api/me/password`, `GET /api/env` | да | — | любая |
| `GET /api/dictionaries/*` | да | — | любая |
| `GET /api/templates*` | да | READ в `templates`\|`admin` | любая |
| `POST/PUT/DELETE /api/templates*` | да | ADD/EDIT/DELETE в `admin`\|`templates` | любая |
| `/api/journeys*`, `/api/flow/*` | да | READ в `journeys` | **только ADMIN** (класс-гард) |
| `GET /api/promo/plan` | да | READ в `promo` | любая |
| `POST/PATCH/DELETE /api/promo/plan*` | да | ADD/EDIT/DELETE в `promo` | любая |
| `GET/PUT /api/reports/sms-check/config`, `GET …/download` | да | READ в `reports` | смена источника — только админ |
| `GET /api/reports/connections` | да | — | любая (токен — только админу) |
| `PUT/DELETE /api/reports/connections/*` | да | — | только ADMIN |
| `GET /api/panel-settings/{key}` | да | — | любая |
| `PUT /api/panel-settings/{key}` | да | — | только ADMIN |
| `/api/admin/**` | да | — (админ обходит матрицу) | только ADMIN (фильтр) |
| `/settings/**` (статика настроечной админки) | да | — | только ADMIN (фильтр) |
| `/swagger-ui.html`, `/v3/api-docs` | да | — | любая |

Напоминание: роль с флагом `is_admin` обходит матрицу разделов везде, поэтому колонку «Раздел и право» для админа можно читать как «всегда доступно».
