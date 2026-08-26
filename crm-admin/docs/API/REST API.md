---
tags: [api, reference]
---

# REST API

Полный справочник HTTP-интерфейса crm-admin: **метод, путь, назначение, требуемое право**. Это единственное место со списком эндпоинтов — остальные заметки ссылаются сюда, а не перечисляют пути у себя. Доменные подробности каждой подсистемы — по ссылкам в заголовках разделов, модель доступа целиком — в [[Безопасность и RBAC]] (здесь только то, что нужно вызывающему).

Контроллеры лежат в `src/main/java/ru/banki/crm/web/`, по одному на подсистему.

| Контроллер | Префикс | Подсистема |
|---|---|---|
| `AuthController` | `/api/me` | профиль текущего пользователя |
| `EnvController` | `/api/env` | среда инстанса |
| `TemplateController` | `/api/templates` | шаблоны коммуникаций — [[Шаблоны и мастер коммуникаций]] |
| `DictionaryController` | `/api/dictionaries` | справочники для форм |
| `JourneyController` | `/api/journeys` | цепочки-схемы — [[Цепочки (Journeys)]] |
| `FlowController` | `/api/flow` | материализация — [[Материализация (Flow)]] |
| `PromoPlanController` | `/api/promo/plan` | план промо — [[Планирование промо]] |
| `AbTestController` | `/api/ab-tests` | журнал А/Б тестов — [[АБ тесты]] |
| `SmsCheckReportController` | `/api/reports/sms-check` | отчёт «ЧЕК СМС траффик» — [[Отчёты]] |
| `ReportConnectionController` | `/api/reports/connections` | подключения Tableau — [[Отчёты]] |
| `PanelSettingsController` | `/api/panel-settings` | настройки панели key → jsonb |
| `SchemaController` | `/api/schema` | Scheme Builder: модель схемы и DDL |
| `AdminUserController` | `/api/admin` | пользователи и каталог разделов — [[Безопасность и RBAC]] |
| `RoleController` | `/api/admin/roles` | роли и матрица прав — [[Безопасность и RBAC]] |
| `DbConnectionController` | `/api/admin/db-connections` | реестр подключений к БД |
| `EtlController` | `/api/admin/etl` | ETL «прод → мы» — [[Синхронизация с прод-БД]] |
| `ProdSyncController` | `/api/admin/prod-db` | очередь синка и сверка — [[Синхронизация с прод-БД]] |

Плюс два «сервисных» URL Spring Security (не контроллеры): `POST /api/login` и `POST /logout` (`src/main/java/ru/banki/crm/security/SecurityConfig.java:58`, `src/main/java/ru/banki/crm/security/SecurityConfig.java:74`).

## Общие сведения

- **Формат** — JSON везде, кроме `POST /api/login` (`application/x-www-form-urlencoded`) и `GET /api/reports/sms-check/download` (бинарный `.xlsx`).
- **Аутентификация** — сессионная кука + remember-me кука, без токенов в заголовках. Фронтовый слой `static/api.js` шлёт запросы с `credentials: "same-origin"`.
- **CSRF отключён** (`src/main/java/ru/banki/crm/security/SecurityConfig.java:55`) — внутренний инструмент за аутентификацией; известный follow-up, см. [[Безопасность и RBAC]].
- **Swagger** — `springdoc-openapi`: UI на `/swagger-ui.html`, описание на `/v3/api-docs`. Оба требуют залогиненной сессии.

### Формат ошибок

**Клиент читает одно поле — `message`** (`static/api.js`, функция `req`), поэтому весь текст ошибки обязан быть в нём. Обеспечивают это две вещи:

1. `server.error.include-message: always` в `src/main/resources/application.yml:33` — стандартный error-ответ Spring Boot несёт текст `ResponseStatusException`, а не пустоту;
2. `ValidationErrorHandler` (`src/main/java/ru/banki/crm/web/ValidationErrorHandler.java:31`) перехватывает `MethodArgumentNotValidException` и **сам собирает `message`**: тексты ограничений (они заданы по-русски в `UserDtos`/`RoleDtos`) склеиваются через `; ` в одну строку (`src/main/java/ru/banki/crm/web/ValidationErrorHandler.java:45`), ответ — `{status, error, message}` (`src/main/java/ru/banki/crm/web/ValidationErrorHandler.java:50`).

Второе появилось не от любви к формату: без обработчика Spring отдавал `«Validation failed for object='createUser'. Error count: 1»`, и администратор, заводивший пользователя, на каждую попытку видел одно и то же сообщение, не понимая, что именно не так — короткий пароль, невыбранная роль или чужой домен почты. Дубли текстов схлопываются, порядок полей формы сохраняется (`LinkedHashSet`).

| Код | Когда |
|---|---|
| `401` | нет сессии. XHR к `/api/**` получает чистый `401` (`HttpStatusEntryPoint`, `src/main/java/ru/banki/crm/security/SecurityConfig.java:82`), браузерная навигация уводится на `/login.html` |
| `403` | нет нужного права в разделе (`AccessGuard.requireCapability`, `src/main/java/ru/banki/crm/security/AccessGuard.java:51`) либо не хватает роли |
| `400` | валидация `@Valid` или бизнес-проверка (тексты по-русски) |
| `404` | сущность не найдена; а также «настройка обслуживается отдельным API» |
| `409` | конфликт: дубль, удаление последнего админа, разошедшаяся версия строки, не настроен источник отчёта |
| `502` | ошибка запроса к внешней БД (DWH) |

## Как читать колонку «Право»

Доступ дают три независимых механизма (подробно — [[Безопасность и RBAC]]):

1. **URL-правила `SecurityFilterChain`.** Публичны `/login.html`, `/api/login`, `/logout`, `/favicon.ico`, `/error` (`src/main/java/ru/banki/crm/security/SecurityConfig.java:20`). Префиксы **`/api/admin/**` и `/settings/**` требуют `ROLE_ADMIN`** (`src/main/java/ru/banki/crm/security/SecurityConfig.java:49`). Остальное — просто аутентификация.
2. **`@PreAuthorize` на классе или методе.** Целиком под `hasRole('ADMIN')`: `src/main/java/ru/banki/crm/web/JourneyController.java:17`, `src/main/java/ru/banki/crm/web/FlowController.java:27`, `src/main/java/ru/banki/crm/web/SchemaController.java:29`. Точечно: `src/main/java/ru/banki/crm/web/PanelSettingsController.java:84`, `src/main/java/ru/banki/crm/web/ReportConnectionController.java:120`, `src/main/java/ru/banki/crm/web/ReportConnectionController.java:161`.
3. **Матрица прав роли по разделам** — `AccessGuard.requireCapability(cap, sections…)` (`src/main/java/ru/banki/crm/security/AccessGuard.java:38`) первой строкой метода. У пары «роль × раздел» свои флаги `read / add / edit / delete`; глагол сопоставляется отдельно: GET → READ, POST → ADD, PUT/PATCH → EDIT, DELETE → DELETE.

**Роль с флагом `is_admin` (и супер-админ) матрицу обходит целиком** (`src/main/java/ru/banki/crm/security/AccessGuard.java:43`) — для админа колонку «Право» везде можно читать как «доступно». Роли и разделы — данные в `app.role` / `app.role_section`, канонический список секций — `src/main/java/ru/banki/crm/service/Sections.java:40`.

## Аутентификация

| Метод и путь | Назначение | Право |
|---|---|---|
| `POST /api/login` | вход; `application/x-www-form-urlencoded`, параметры `email` + `password` | публичный |
| `POST /logout` | выход, удаляет обе куки | публичный |

Успешный вход → `200` с пустым телом, ставятся сессионная кука и remember-me (30 дней, `alwaysRemember`, `src/main/java/ru/banki/crm/security/SecurityConfig.java:67`); неверная пара → `401`. Имена кук свои на каждой среде — [[Среды и деплой]], [[Конфигурация]].

## Профиль и среда

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/me` | кто я: `email`, `displayName`, `role`, `canEdit`, `isAdmin`, `sections`, `isSuperAdmin`, `caps` | аутентификация |
| `PUT /api/me/password` | сменить свой пароль: `{currentPassword, newPassword}` | аутентификация |
| `GET /api/env` | `{name, devFeatures}` — среда инстанса и флаг dev-разделов | аутентификация |

`sections` — что показывать в NAV, `caps` — карта «раздел → `{read, add, edit, delete}`», по ней фронт прячет кнопки; правила их наполнения (админу — всё, `journeys` не-админу — никогда, супер-роль под именем «Админ») разобраны в [[Безопасность и RBAC]]. Код — `src/main/java/ru/banki/crm/web/AuthController.java:27`.

`PUT /api/me/password` (`src/main/java/ru/banki/crm/web/AuthController.java:69`): `400 «Текущий пароль неверен»`, `400` валидации (`newPassword` — минимум 8 символов).

## Шаблоны коммуникаций → [[Шаблоны и мастер коммуникаций]]

Канал в пути: `sms | push | email | cc | fa | vk | la` (регистр нормализуется, неизвестный → `400 «Неизвестный канал: …»`). `code` — бизнес-идентификатор строкой.

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/templates` | единый список с фильтрами и пагинацией (`src/main/java/ru/banki/crm/web/TemplateController.java:30`) | READ в `templates` или `admin` |
| `GET /api/templates/facets` | значения фильтров (продукт/точка/триггер) из реальных данных | READ в `templates` или `admin` |
| `GET /api/templates/count` | `{total, active}` под теми же фильтрами | READ в `templates` или `admin` |
| `GET /api/templates/{channel}/{code}` | полная карточка `TemplateDto` | READ в `templates` или `admin` |
| `POST /api/templates/{channel}` | создать шаблон → `{code}`; `?force=true` — подтверждённый дубль по source | ADD в `admin` или `templates` |
| `GET /api/templates/{channel}/duplicates` | занят ли этот `source` (и `letterosId` у писем) → коды шаблонов или `null` | READ в `templates`, `admin` или `viewer` |
| `POST /api/templates/{channel}/chain` | батч «цепочка дней»: `{base, days[]}` → `{codes[]}` | ADD в `admin` или `templates` |
| `PUT /api/templates/{channel}/{code}` | обновить | EDIT в `admin` или `templates` |
| `DELETE /api/templates/{channel}/{code}` | удалить | DELETE в `admin` или `templates` |

Query-параметры списка (все опциональны, множественные — повторяемые): `channel`, `product`, `touch`, `trigger`, `partner`, `active` (`active` / любое другое непустое = неактивные), `q` (свободный поиск), `sort`, `dir`, `limit`, `offset`. У `count` тот же набор без `sort`/`dir`/`limit`/`offset`.

Ошибки: `404 «Шаблон не найден: {channel}/{code}»`; `400 «Для КЦ обязателен номер сегмента»`; `409 «Сегмент уже заведён: …»`; `400 «Нужны base и непустой список days»`.

Каждая мутация пишется в `arch.t_admin_log` ([[Аудит и журналирование]]) и ставит операцию в очередь синка ([[Синхронизация с прод-БД]]).

## Справочники

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/dictionaries/partners` | `["A7", …]` — партнёры из `dictionary.d_partner` (`V25`), сортировка регистронезависимая | аутентификация |
| `POST /api/dictionaries/partners` | `{"name":"…"}` → `{"name":"…"}` — добавить партнёра из формы | ADD в `admin`, `templates` **или `promo`** |
| `GET /api/dictionaries/cc-segments` | сегменты КЦ | аутентификация |
| `GET /api/dictionaries/comm-names?channel=sms` | значения `communication_name` (параметр `channel` не влияет, оставлен для совместимости) | аутентификация |
| `GET /api/dictionaries/touch-points` | точки касания | аутентификация |
| `GET /api/dictionaries/product-types` | типы продуктов (`d_product_type`, `V19`) | аутентификация |

На чтении ни роль, ни разделы не проверяются: данные нужны формам нескольких разделов.

`POST /api/dictionaries/partners` — единственная мутация среди справочников. Раздел `promo` в списке (`src/main/java/ru/banki/crm/web/DictionaryController.java:41`) не случайно: справочник партнёров общий, и планировщик промо встречает нового партнёра не реже мастера — без этого кнопка «+» в плане упиралась бы в `403`. Имя обрезается по краям, сравнение с существующими **регистронезависимое** (`UNIQUE(name)` в БД считает «Sber» и «sber» разными, а для списка это дубль) — если партнёр уже есть, возвращается его каноническое написание и новой строки не появляется. Ошибки: `400 «Название партнёра пустое»`, `400 «Название партнёра длиннее 200 символов»`.

## Цепочки-схемы → [[Цепочки (Journeys)]]

Контроллер целиком под `@PreAuthorize("hasRole('ADMIN')")` (`src/main/java/ru/banki/crm/web/JourneyController.java:17`), каждый метод дополнительно требует READ на разделе `journeys`.

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/journeys` | список `{id, name, nodeCount, kind}` | ADMIN + раздел `journeys` |
| `GET /api/journeys/{id}` | схема целиком (`JourneyDto`) | ADMIN + раздел |
| `POST /api/journeys` | создать (тело без `id`) | ADMIN + раздел |
| `PUT /api/journeys/{id}` | полная замена схемы | ADMIN + раздел |
| `DELETE /api/journeys/{id}` | удалить | ADMIN + раздел |

На мутациях висит ещё и `hasAnyRole('EDITOR','ADMIN')` (`src/main/java/ru/banki/crm/web/JourneyController.java:41`), но authority `ROLE_EDITOR` больше никому не выдаётся — фактически это «только ADMIN», и класс-гард всё равно строже.

Ошибки: `404 «Цепочка не найдена: {id}»`, `500 «Повреждён JSON цепочки …»`, `400` валидации. Цепочка **без стартового узла** сохраняется штатно — это вложенная цепочка (Subflow).

## Материализация → [[Материализация (Flow)]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `POST /api/flow/preview` | план вставок слоя B: `{problems[], rows[]}` (`src/main/java/ru/banki/crm/web/FlowController.java:43`) | ADMIN + раздел `journeys` |
| `POST /api/flow/materialize` | сохранить цепочку и записать слои A и B одной транзакцией → `{journeyId, created[]}` | ADMIN + раздел `journeys` |

`preview` отдаёт `200` даже при непустом `problems` (проблемы — данные, не ошибка); FK показываются спецзначением `"(auto)"`. `materialize` при проблемах валидации → `400` с их перечнем; недопустимая таблица или колонка (белый список слоя B) → `400`.

## А/Б тесты → [[АБ тесты]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/ab-tests` | все тесты, свежие сверху | READ в `abtests` |
| `POST /api/ab-tests` | завести тест; пустой `tester` заполняется почтой учётки | ADD в `abtests` |
| `PATCH /api/ab-tests/{id}` | правка одного поля: `{field, value, ver}` | EDIT в `abtests` |
| `DELETE /api/ab-tests/{id}` | удалить запись | DELETE в `abtests` |

Ошибки: `400 «Поле нельзя менять: …»` (поле вне белого списка), `400 «Не указана дата начала»`, `409 «Строку изменил другой пользователь»` (разошёлся `ver`), `404 «Строку уже удалили»`. Каждая мутация пишется в `arch.t_admin_log`.

## Планирование промо → [[Планирование промо]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/promo/plan` | весь план (заодно архивирует прошедшие «запланировано») | READ в `promo` |
| `POST /api/promo/plan` | завести промо; мультиканал → столько строк, сколько каналов | ADD в `promo` |
| `PATCH /api/promo/plan/{id}` | правка одного поля: `{field, value, ver}` | EDIT в `promo` |
| `DELETE /api/promo/plan/{id}` | удалить строку | DELETE в `promo` |
| `POST /api/promo/plan/{id}/jira` | завести задачу в Jira по строке плана: `{source}`; ключ пишется в `task_key` | EDIT в `promo` |
| `GET /api/promo/plan/owners` | имена пользователей панели для выпадающего «Ответственный» | READ в `promo` |

`owners` живёт здесь, а не в `/api/admin/users` (`src/main/java/ru/banki/crm/web/PromoPlanController.java:69`): список нужен всем, кто ведёт план, а админская ручка отдаёт учётки целиком и только админу. Отдаются одни имена — ни почты, ни ролей.

`ver` — `timestamp_upd`, который видел клиент: разошёлся → **`409 «Строку изменил другой пользователь»`**, строки уже нет → `404 «Строку уже удалили»`. Неизвестное поле → `400 «Поле нельзя менять: …»`; кривая дата → `400`.

## Отчёты → [[Отчёты]]

### «ЧЕК СМС траффик»

Все пять ручек требуют READ на секции **`rep-smscheck`** — у каждого отчёта своя секция (V29), доступ к этой выгрузке выдаётся отдельно от прочих отчётов.

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/reports/sms-check/config` | текущий источник, список каналов (`sms`, `push`, `email`), `canEdit` | READ в `rep-smscheck` |
| `PUT /api/reports/sms-check/config` | задать источник-DWH: `{connectionId}` (`null` — сбросить) | READ в `rep-smscheck` **+ роль-админ** (проверяет сервис) |
| `GET /api/reports/sms-check/daily` | лист «по дням» как данные — отчёт показывается прямо на странице | READ в `rep-smscheck` |
| `GET /api/reports/sms-check/products` | продукты, встречающиеся в выбранных месяце и канале — для выпадающего списка | READ в `rep-smscheck` |
| `GET /api/reports/sms-check/download` | книга `.xlsx` за месяц | READ в `rep-smscheck` |

Параметры `daily` (`src/main/java/ru/banki/crm/web/SmsCheckReportController.java:62`), `products` (`src/main/java/ru/banki/crm/web/SmsCheckReportController.java:71`) и `download` (`src/main/java/ru/banki/crm/web/SmsCheckReportController.java:79`):

| Параметр | Обязателен | Значения |
|---|---|---|
| `month` | да | `YYYY-MM`; иначе `400 «Месяц должен быть в формате YYYY-MM.»` (`src/main/java/ru/banki/crm/web/SmsCheckReportController.java:96`) |
| `channel` | нет, по умолчанию `sms` | `sms \| push \| email`; иначе `400 «Неизвестный канал. Ожидается sms, push или email.»` |
| `product` | нет | фильтр по продукту; у `products` его нет — ручка сама возвращает список значений |

Почему `daily` отдаёт те же данные, что и `download`: страница показывает отчёт без скачивания файла, но собирать таблицу второй раз на клиенте нельзя — расхождение экрана и книги было бы неотличимо от ошибки данных. Источник-DWH в обеих ручках берётся из серверной конфигурации, а не из запроса, — коннект наружу не отдаётся вовсе.

Ошибки: `403 «Менять источник может только администратор.»` (`src/main/java/ru/banki/crm/service/SmsCheckReportService.java:165` — проверка в сервисе, потому что READ на секцию у автора правки уже есть); `400 «connectionId должен быть числом.»` и `400 «Нет такого подключения.»` на записи конфига; `409`, если источник не выбран или подключение удалено; `502` при ошибке запроса к DWH. Ответ `download` — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment`, имя `check-sms-{channel}-{month}.xlsx`.

### Подключения Tableau

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/reports/connections` | `{canEdit, items}`; **не-админу вместо `token` только `hasToken`**, и в `items` попадают лишь отчёты с READ на свою секцию `rep-*` (`src/main/java/ru/banki/crm/web/ReportConnectionController.java:94`) — иначе спрятанный в меню отчёт открывался бы прямой ссылкой | аутентификация |
| `PUT /api/reports/connections/{report}` | сохранить `{server, view, token}` | ADMIN |
| `DELETE /api/reports/connections/{report}` | сбросить подключение (единственный способ удалить токен) | ADMIN |

`report` — `[a-zA-Z][a-zA-Z0-9_-]{0,31}`, иначе `400`. `PUT` требует непустых `server` и `view` (`400`), пустой `token` не затирает сохранённый: пустое поле слишком легко получить случайно, а токен нигде больше не хранится и его пришлось бы перевыпускать.

## Настройки панели

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/panel-settings/{key}` | значение настройки (`{key, value}`) | аутентификация |
| `PUT /api/panel-settings/{key}` | upsert произвольного JSON | ADMIN |

Ключ — `[a-zA-Z][a-zA-Z0-9_-]{0,63}`, иначе `400`. Основной потребитель — конфиг «приложение → разделы» под ключом `appSections`. **Ключ `tableauReports` этим эндпоинтом не обслуживается вовсе** (`src/main/java/ru/banki/crm/web/PanelSettingsController.java:55`): внутри токен, а GET здесь открыт любой роли. Ответ — `404`, а не `403`, и регистр игнорируется, иначе код ответа превращался бы в детектор «секрет заведён». Каждая запись журналируется.

## Scheme Builder → `/api/schema`

Редактор модели схемы БД из настроечной админки `/settings`. Контроллер целиком под `@PreAuthorize("hasRole('ADMIN')")` (`src/main/java/ru/banki/crm/web/SchemaController.java:29`): ручки лежат **вне** `/api/admin/**`, поэтому право закрыто аннотацией, а не правилом URL — так не приходится трогать `SecurityConfig` и задевать чужие маршруты.

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/schema` | текущая модель (первое обращение засевает её из файла в classpath) | ADMIN |
| `PUT /api/schema` | сохранить модель целиком | ADMIN |
| `POST /api/schema/changes` | записать только дельты из журнала редактора, модель не трогая | ADMIN |
| `GET /api/schema/db` | что реально есть в базе: схемы с вложенными таблицами (только чтение) | ADMIN |
| `GET /api/schema/versions?limit=100` | история версий, заголовки без самих моделей (клампится к 1…500) | ADMIN |
| `GET /api/schema/audit?limit=200` | журнал действий: кто, что и когда (клампится к 1…1000) | ADMIN |
| `POST /api/schema/ddl/preview` | что будет выполнено в базе — без выполнения | ADMIN |
| `POST /api/schema/ddl/apply` | применить модель: схемы, таблицы, колонки, FK. Только аддитивно | ADMIN |
| `POST /api/schema/ddl/drops` | колонки, которые есть в базе, но которых больше нет в модели (только чтение) | ADMIN |
| `POST /api/schema/ddl/drop` | удалить колонки | ADMIN |
| `POST /api/schema/db/adopt` | взять существующие таблицы схемы под управление конструктора → их колонки | ADMIN |
| `POST /api/schema/ddl/table-info` | сколько строк в таблице и кто на неё ссылается — данные для диалога удаления | ADMIN |
| `POST /api/schema/ddl/drop-table` | удалить таблицу и её сущность в модели | ADMIN |
| `POST /api/schema/ddl/drop-schema` | удалить пустую схему, заведённую конструктором | ADMIN |

Особенности контракта:

- **Тело `PUT` принимается в двух видах** — конверт `{model, changes}` (редактор шлёт модель вместе с дельтами своего журнала) или голая модель (`src/main/java/ru/banki/crm/web/SchemaController.java:67`). Второй вариант оставлен ради совместимости с изначальным контрактом редактора.
- **Пустое тело у `ddl/*` — не ошибка**: `modelOf` подставляет сохранённую модель (`src/main/java/ru/banki/crm/web/SchemaController.java:141`), поэтому план по текущей модели можно посмотреть без пересылки её целиком.
- **`db/adopt` расширяет реестр осознанно**: до него запись в `app.schema_owned` появлялась только когда конструктор создавал объект сам. Схемы из стоп-листа так не открыть, а само взятие под управление уходит в журнал (`ADOPT`).
- **Удаление таблицы двухшаговое**: `table-info` отдаёт точное число строк, и это же число обязано вернуться в `drop-table` — разошлось, значит в таблицу писали и удаляют уже не то, про что спрашивали. Связи из чужих таблиц требуют `cascade`, а сущность вычищается из модели в той же транзакции, иначе следующее «Применить» вернуло бы таблицу.
- **`ddl/drop` не верит телу запроса**: список кандидатов сервер пересчитывает сам, из тела берутся только решения по каждой колонке — что делать с данными и со связями (`src/main/java/ru/banki/crm/web/SchemaController.java:130`).
- **Границы разрушительного**: править билдер имеет право только то, что сам и завёл (реестр `app.schema_owned`), схемы из `app.schema_reserved` не трогает ни при каких условиях (миграции `V30`, `V31`).
- Отказ охраны и падение SQL наружу выглядят одинаково — `400` с текстом причины (`src/main/java/ru/banki/crm/web/SchemaController.java:110`); в журнале они разведены на `REJECTED` и `ERROR`.

## Администрирование: `/api/admin/**`

Весь префикс закрыт `hasRole("ADMIN")` на уровне `SecurityFilterChain` (`src/main/java/ru/banki/crm/security/SecurityConfig.java:49`) — не-админ получает `403` до входа в контроллер, матрица разделов тут не участвует. Аннотаций в самих контроллерах поэтому нет.

### Пользователи и каталог разделов → [[Безопасность и RBAC]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/sections` | каталог разделов: `{id, writable, adminOnly, group}` для матрицы прав; `group` — подпись группы сайдбара, по ней матрица рисует заголовки (`src/main/java/ru/banki/crm/web/AdminUserController.java:28`) | ADMIN |
| `GET /api/admin/users` | список `UserView` | ADMIN |
| `POST /api/admin/users` | создать: `{email, displayName, roleId, password}` | ADMIN |
| `PUT /api/admin/users/{id}` | частичное обновление: `{displayName, roleId, enabled}` | ADMIN |
| `DELETE /api/admin/users/{id}` | удалить | ADMIN |
| `PUT /api/admin/users/{id}/password` | сброс пароля админом: `{newPassword}` → `{status:"ok"}` | ADMIN |

**Обычный админ против супер-админа.** Обычный админ ведёт обычные учётки. Назначать и снимать админ-роли, а также трогать учётку с админ-ролью может **только супер-админ**, супер-роль не назначается через панель никому. Отказ всегда один и тот же — `403 «Недостаточно прав для этой операции»`, чтобы по тексту нельзя было выяснить, какие права у чужой учётки. Поле `manageable` в `UserView` заранее говорит фронту, что строка недоступна для правки, не раскрывая причину.

Ошибки: `409 «Пользователь уже существует: …»`, `409 «Нельзя удалить последнего администратора»`, `400 «Разрешены только адреса @…»` (домен проверяется всегда: `APP_EMAIL_DOMAIN`, при пустом значении — `banki.ru`), `400 «Некорректная роль»`, `404 «Пользователь не найден»`.

### Роли → [[Безопасность и RBAC]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/roles` | роли с матрицей прав, счётчиком носителей и `manageable` (супер-роль в список не попадает) | ADMIN |
| `POST /api/admin/roles` | создать: `{name, isAdmin, access[]}` | ADMIN; роль с админ-флагом — только супер-админ |
| `PUT /api/admin/roles/{id}` | переименовать / переписать матрицу | ADMIN; админ-флаг в любую сторону — только супер-админ |
| `DELETE /api/admin/roles/{id}` | удалить | ADMIN |

`access[]` — строки `{section, read, add, edit, delete}`; у не-writable разделов лишние флаги гасятся при сохранении. Ошибки: `409 «Роль с таким названием уже есть»`, `409 «Встроенную роль удалить нельзя»`, `409 «Роль назначена пользователям (N) — сначала переведите их на другую роль»`, `404 «Роль не найдена»`, `403 «Недостаточно прав для этой операции»`.

### Реестр подключений к БД

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/build` | версия сборки контура; отвечает вошедшему пользователю либо соседнему контуру с верным `X-Peer-Token` | вход или секрет |
| `GET /api/admin/deploy` | версии всех контуров: своя из образа, соседние — опросом по внутренней сети | ADMIN |
| `GET /api/admin/deploy/pending` | что есть у нас и чего ещё нет на целевом контуре | ADMIN |
| `POST /api/admin/deploy/plan` | срез коммитов и готовая команда; `record=true` пишет намерение в журнал | ADMIN |
| `GET /api/admin/deploy/history` | журнал выкаток | ADMIN |
| `GET /api/admin/deploy/changes?days=N` | что менялось в контуре и каких объектов пакета это касается | ADMIN |
| `POST /api/admin/deploy/run` | поставить выкат в очередь обработчику на хосте: `{target, upTo}` | ADMIN |
| `GET /api/admin/deploy/runner` | жив ли обработчик и что сейчас в очереди | ADMIN |
| `GET /api/admin/deploy/schema` | отставание структуры базы от модели по контурам | ADMIN |
| `GET /api/schema/ddl/drift` | что есть в модели, но не создано в базе | READ в `set-schema` |
| `GET /api/schema/ddl/drift-peer` | то же для соседнего контура (X-Peer-Token) | вошедший или секрет |
| `POST /api/admin/deploy/runner/pause` | пауза обработчика: `{paused}`; текущее задание не прерывается | ADMIN |
| `GET /api/admin/deploy/jobs?limit=N` | история заданий обработчика | ADMIN |
| `POST /api/admin/deploy/jobs/{id}/cancel` | снять задание, пока его не взяли | ADMIN |
| `POST /api/admin/deploy/jobs/{id}/retry` | повторить неудавшееся задание | ADMIN |
| `POST /api/admin/deploy/reconcile` | закрыть записи журнала, версия которых уже стоит на цели | ADMIN |
| `GET /api/admin/health` | состояние системы: проверки, нагрузка, сутки очереди по часам, возраст последних доставок, состав данных, место в базе, две недели правок, переливы, подключения, версия | READ в `set-dbconn`, `set-sync`, `set-procs` или `set-diag` |
| `GET /api/events/chains` | цепочки онлайн-событий из `commapi.events_chain` (crmdb): по строке на `t_event_comm_id` | READ в `ev-online` |
| `GET /api/events/chains/{id}` | одна цепочка шагами по `order`: пауза, шаблон, событие снятия шага; условие выхода поднято на уровень цепочки | READ в `ev-online` |
| `POST /api/admin/processes/sms-approved/run` | сверка текстов смс для согласования у операторов; без параметров — сухой прогон, с `?apply=true` — запись в боевую базу | READ в `set-procs` для прогона, EDIT — для записи |
| `GET /api/admin/settings-pack` | что можно перенести между контурами и сколько записей в каждом объекте | ADMIN |
| `POST /api/admin/settings-pack/export` | собрать пакет из выбранных объектов | ADMIN |
| `POST /api/admin/settings-pack/preview` | что произойдёт при применении присланного пакета | ADMIN |
| `POST /api/admin/settings-pack/apply` | применить выбранные объекты; перед каждым снимается слепок | ADMIN |
| `GET /api/admin/settings-pack/snapshots` | слепки «как было» | ADMIN |
| `POST /api/admin/settings-pack/snapshots/{id}/restore` | вернуть объект из слепка | ADMIN |
| `GET /api/admin/integrations` | карта интеграций: узлы (внешние системы) и потоки между ними с живым состоянием | READ в `set-dbconn`, `set-sync` или `set-procs` |
| `GET /api/admin/db-connections` | встроенные (наша/прод) + пользовательские, со статусом последней проверки | ADMIN |
| `POST /api/admin/db-connections` | добавить: `{name, jdbcUrl, username, password, purpose, active}` | ADMIN |
| `PUT /api/admin/db-connections/{id}` | изменить (пароль пишется только если прислан непустым) | ADMIN |
| `DELETE /api/admin/db-connections/{id}` | удалить | ADMIN |
| `POST /api/admin/db-connections/{id}/test` | проверить одно (`SELECT 1`); `id` — число либо `our-db` / `prod-db` | ADMIN |
| `POST /api/admin/db-connections/test-all` | проверить все и вернуть свежий список | ADMIN |
| `GET /api/admin/backlog` | бэклог доработок; `?status=` — фильтр по одному статусу | ADMIN |
| `GET /api/admin/backlog/counts` | сколько задач в каждом статусе — для подписей вкладок | ADMIN |
| `GET /api/admin/backlog/assignees` | кому можно поручить: активные учётки с супер-ролью `{email, name}` | ADMIN |
| `POST /api/admin/backlog` | завести задачу: `{title, description, area, priority, assignee}` | ADMIN |
| `PUT /api/admin/backlog/{id}` | правка; поля, которых нет в теле, не трогаются | ADMIN |
| `DELETE /api/admin/backlog/{id}` | удалить задачу | ADMIN |

Пароль наружу не отдаётся — только флаг `hasPassword`. Этот же реестр даёт приёмник синка и источник DWH для отчёта «ЧЕК СМС траффик».

### ETL «прод → мы» → [[Синхронизация с прод-БД]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/etl/status` | включён / идёт ли прогон / водяные знаки по каналам / итоги последнего прогона (`src/main/java/ru/banki/crm/web/EtlController.java:26`) | ADMIN |
| `POST /api/admin/etl/run` | ручной инкремент — то же, что планировщик раз в 5 минут (`ETL_INTERVAL_MS`) | ADMIN |
| `POST /api/admin/etl/run-full` | ручной полный прогон — то же, что ночью в 22:00 (`ETL_FULL_CRON`) | ADMIN |

Обе ручки запуска синхронные и возвращают итог прогона; расписание задаётся переменными окружения — [[Среды и деплой]].

### Прод-БД: очередь и сверка → [[Синхронизация с прод-БД]]

| Метод и путь | Назначение | Право |
|---|---|---|
| `GET /api/admin/prod-db/health` | соединение, наличие канальных таблиц, счётчики очереди | ADMIN |
| `GET /api/admin/prod-db/queue-stats` | только счётчики очереди, без коннекта к проду | ADMIN |
| `GET /api/admin/prod-db/queue?limit=50&status=` | записи очереди (`src/main/java/ru/banki/crm/web/ProdSyncController.java:81`) | ADMIN |
| `POST /api/admin/prod-db/process` | прогнать доставку прямо сейчас, до 200 записей | ADMIN |
| `POST /api/admin/prod-db/retry/{id}` | повторить проблемную запись (статус → `PENDING`, попытки → 0, ошибка стёрта) | ADMIN |
| `POST /api/admin/prod-db/cancel/{id}` | убрать запись из очереди — **только `PENDING` и `ERROR`** | ADMIN |
| `GET /api/admin/prod-db/reconcile` | сверка `d_template` с продом: «только в проде / разошлись / только у нас» | ADMIN |
| `POST /api/admin/prod-db/reconcile/import` | импорт выбранных строк из прода (тело — список `{channel, code}`) | ADMIN |
| `POST /api/admin/prod-db/reconcile/import-all` | фоновый импорт всей прод-базы (одна задача за раз) | ADMIN |
| `GET /api/admin/prod-db/reconcile/import-all/status` | прогресс фонового импорта, для поллинга | ADMIN |

Параметры `queue`: `limit` (по умолчанию 50, клампится к 1…500), `status` — пусто по умолчанию, `all` отдаёт все записи, любое другое значение фильтрует по конкретному статусу.

**Пустой `status` отдаёт `PENDING`, `SENDING` и `ERROR`** (`src/main/java/ru/banki/crm/web/ProdSyncController.java:88`). `SENDING` попал в набор по умолчанию сознательно: это записи «ушли в прод, ответа нет» — ровно тот случай, ради которого очередь и открывают. Из той же логики `cancel` их не удаляет: неизвестно, доехала строка или нет, и молча убрать такую запись значило бы потерять след. Зависший `SENDING` переводит в `ERROR` фоновая уборка, после чего доступны и `retry`, и `cancel`.
