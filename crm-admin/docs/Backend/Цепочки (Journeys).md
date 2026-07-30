---
tags: [backend, journeys, flow]
---

# Цепочки (Journeys)

Хранение **цепочек-схем** — блок-схем коммуникаций, которые рисуют в [[Flow Builder (цепочки)]]. Здесь только модель и CRUD; превращение схемы в строки процессных таблиц — [[Материализация (Flow)]].

Ключевая идея: **вся схема (узлы + связи + позиции на канве) — один jsonb-документ** в колонке `definition` таблицы `app.journeys` (структура таблицы — [[Таблицы приложения]]). Читается и пишется атомарно, никакой нормализации узлов по строкам: схема принадлежит редактору и меняется целиком.

| Компонент | Файл |
|---|---|
| `JourneyController` | `src/main/java/ru/banki/crm/web/JourneyController.java` |
| `JourneyService` | `src/main/java/ru/banki/crm/service/JourneyService.java` |
| `DbJourneyService` | `src/main/java/ru/banki/crm/service/DbJourneyService.java` |
| `MockJourneyService` | `src/main/java/ru/banki/crm/service/MockJourneyService.java` |
| `Journey` | `src/main/java/ru/banki/crm/domain/Journey.java` |
| `JourneyDtos` | `src/main/java/ru/banki/crm/dto/JourneyDtos.java` |
| миграции | `V3__journeys.sql`, `V6__flow_layer_a.sql` (добавила `kind`, `continues_journey_id`) |

## JourneyController — `/api/journeys`

Класс целиком помечен `@PreAuthorize("hasRole('ADMIN')")` — раздел «Цепочки» доступен только админам; сверх этого каждый метод вызывает `guard.requireAnySection(Sections.JOURNEYS)`, а мутирующие несут ещё и `hasAnyRole('EDITOR','ADMIN')`. Модель доступа — [[Безопасность и RBAC]], сводка эндпоинтов — [[REST API]].

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/journeys` | `List<JourneyListItem>`, отсортирован по имени |
| GET | `/api/journeys/{id}` | вся схема; 404 «Цепочка не найдена: {id}» |
| POST | `/api/journeys` | создать, id генерирует сервер, тело `@Valid` |
| PUT | `/api/journeys/{id}` | полная перезапись схемы |
| DELETE | `/api/journeys/{id}` | удалить цепочку |

Отдельного «сохранить и материализовать» здесь нет: `POST /api/flow/materialize` сам вызывает `create`/`update`, чтобы у материализации был стабильный `journey_id`.

## Модель данных — JourneyDtos

Четыре record в `JourneyDtos`. Этот же формат (без обёртки id/name/kind) лежит в jsonb и им же ходит фронт — смена хранилища DTO не трогает.

### JourneyNode

| Поле | Тип | Смысл |
|---|---|---|
| `id` | `String`, `@NotBlank` | клиентский id узла, стабильный внутри цепочки |
| `type` | `String` | тип узла (см. ниже); **`null` у старых данных = `comm`** |
| `day` | `int` | день отправки (для `comm`); в UI readonly, подтягивается из `sending_day` шаблона |
| `channel` | `String` | канал коммуникации (для `comm`) |
| `templateCode` | `String` | код шаблона в [[Справочники шаблонов]] (для `comm`) |
| `title` | `String` | короткое название узла |
| `note` | `String` | комментарий «что происходит» |
| `active` | `boolean` | активен ли узел |
| `posX`, `posY` | `double` | позиция на канве Drawflow |
| `props` | `Map<String,String>` | поля, специфичные для типа узла |

### Типы узлов

| Группа | Типы |
|---|---|
| Старт | `startIncome` (Income event), `startTime` (Time event) |
| Действия | `comm` (Communication Alert), `subflow` |
| Логика | `assignment`, `decision`, `pause`, `loop` |
| Данные | `createRecords`, `updateRecords`, `getRecords`, `deleteRecords` |

Узлы групп «Логика» и «Данные» **чисто визуальные**: движка исполнения нет, при материализации они игнорируются. Реальные задержки между коммуникациями задаёт `sending_day` шаблонов.

### props по типам

**`startIncome`**: `event_name`, `system`, `notify_channel`, `sub_channel`, `platform`, `group_event_descr`, `send_delay`, `life_time`, `allow_ml`, `definition_key`, `business_key_prefix`, `is_active`.

**`startTime`**: `event_name`, `system`, `notify_channel`, `is_batch`, `crontab`, `database`, `process_name`, `sql_steps`, `definition_key`, `business_key_prefix`, `is_active`.

Два флага стоит выделить — они появились правкой от 30.07.2026 и раньше жёстко уезжали в прод как `true`:

- **`is_active`** — активность события (плюс отдельный флаг активности у каждого SQL-шага, см. ниже);
- **`is_batch`** — массовый метод отправки против единичного (только `startTime`).

У цепочек, сохранённых раньше, этих ключей в `props` просто нет; «пусто» читается как прежнее поведение — `true` (`MaterializationService.boolProp` с умолчанием).

**`sql_steps`** — JSON-массив шагов выборки. Формат сменился со списка строк на **`[{sql, active}]`**; старый читается как прежде: строка = активный шаг, отсутствующий `active` = `true`.

```json
[{"sql": "select ...", "active": true}, {"sql": "select ...", "active": false}]
```

**`subflow`**: `journey` — id вложенной цепочки. **`decision`**: `title`, `sql`. **`pause`**: `title`, `duration`, `until`. **`assignment`**: `title`, `variable`, `value`. **`loop`**: `title`, `collection`. **`*Records`**: `title`, `object`, `filter`, `fieldsMap`, `into`.

Значения справочников (`notify_channel` КАПСОМ, `definition_key`, `business_key_prefix`, `database`) живут в клиентском реестре типов узлов — см. [[Flow Builder (цепочки)]].

### JourneyEdge, JourneyDto, JourneyListItem

- `JourneyEdge(from, to, fromPort)` — `fromPort` указывает выход узла (`output_1` / `output_2` у Decision «Да/Нет» и Loop «Для каждого / После последнего»).
- `JourneyDto(id, name, kind, continuesJourneyId, nodes, edges)` — `id = null` при создании; `kind = null` у старых данных трактуется как `online`.
- `JourneyListItem(id, name, nodeCount, kind)` — для списка цепочек и options у Subflow.

## kind: online | offline

`online` — цепочка стартует с Income event, `offline` — с Time event. Нормализация одинаковая во всех реализациях: всё, что не строка `"offline"`, становится `"online"`. Соответствие типа старта виду цепочки проверяется **при материализации**, а не при сохранении.

`continuesJourneyId` — информационная метка у offline-цепочки («продолжение какой online-цепочки»); у online принудительно `null`, на логику не влияет.

## DbJourneyService — хранение в PostgreSQL

Активен по умолчанию (`@ConditionalOnProperty(name = "app.journeys.mock", havingValue = "false", matchIfMissing = true)`).

Внутренний record `Definition(nodes, edges)` — ровно содержимое колонки `definition`: узлы и связи **без** `id`/`name`/`kind`/`continues_journey_id`, они лежат отдельными колонками. Сериализация — копией общего `ObjectMapper` с `JsonInclude.NON_NULL`, чтобы null-поля узлов не раздували документ.

- **`list()`** — `findAll()` + разбор каждого документа ради `nodeCount`, сортировка по имени. O(n) по полным документам — при десятках цепочек осознанное упрощение.
- **`get(id)`** — 404 «Цепочка не найдена: {id}»; `parse` терпит `nodes`/`edges` = null (пустые списки), битый JSON → 500 «Повреждён JSON цепочки {id}: …».
- **`create(dto)`** — id = **первые 8 символов случайного UUID** (`"3f9a12bc"`).
- **`update(id, dto)`** — загрузка (404) + полная перезапись имени, вида и схемы.
- **`delete(id)`** — удаление строки.

Общий `save` дополнительно нормализует `kind`, обнуляет `continuesJourneyId` у online, а при ошибке сериализации кидает 400 «Не удалось сериализовать схему: …». Пишет `updatedBy = CurrentUser.email()` и `updatedAt = Instant.now()` — простейший след «кто последний трогал»; полноценного журнала у CRUD цепочек нет, он есть только у материализации ([[Аудит и журналирование]]).

## MockJourneyService — in-memory

Включается `JOURNEYS_MOCK=true` (`app.journeys.mock`), данные в `ConcurrentHashMap` до рестарта. Семантика идентична Db-реализации: те же 8-символьные id, та же нормализация `kind`/`continuesJourneyId`, те же 404. В `@PostConstruct seed()` создаётся демо-цепочка `demo-welcome` из 7 узлов (`startIncome` → `comm` → `decision` → ветки `comm` / `pause`→`comm` → `subflow`) — чтобы сразу увидеть все типы узлов на канве.

Замечание: javadoc интерфейса `JourneyService` устарел — говорит, что единственная реализация мок; фактически основная давно Db.

## Валидация

Ни контроллер, ни сервисы **не требуют стартового узла при сохранении**. Это осознанно: цепочка без `startIncome`/`startTime` считается **вложенной (Subflow)** по autolaunched-модели — её сохраняют самостоятельным объектом, вставляют узлом `subflow` в родительские цепочки, а материализуется она только в составе родителя. Попытка материализовать её саму даёт проблему валидации с этим же объяснением, см. [[Материализация (Flow)]].

Единственная проверка на сохранении — клиентская: `journeys.js` требует, чтобы у каждой `comm`-ноды существовал шаблон в справочнике. Сервер дублирует это не на CRUD, а на материализации.

Bean validation покрывает только структуру: `@NotBlank` на `JourneyNode.id`, `JourneyEdge.from`/`to` и `JourneyDto.name`, `@NotNull @Valid` на списках узлов и рёбер.

## Связанные заметки

[[Материализация (Flow)]] · [[Flow Builder (цепочки)]] · [[Таблицы приложения]] · [[Слой A (flow)]] · [[Справочники шаблонов]] · [[Обзор бэкенда]] · [[Безопасность и RBAC]] · [[REST API]]
