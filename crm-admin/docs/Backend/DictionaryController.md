---
tags: [backend, controller, rest, dictionaries]
---

# DictionaryController

REST-контроллер справочников для выпадающих списков UI (партнёры, CC-сегменты, названия коммуникаций).

- Базовый путь: `@RequestMapping("/api/dictionaries")`
- Аннотация класса: `@RestController`
- Зависимость: [[DictionaryService]] `service`

Авторизация: отдельных `@PreAuthorize` и вызовов [[AccessGuard]] нет. Действует общее правило [[SecurityConfig]] — `anyRequest().authenticated()`, то есть доступ имеет любой аутентифицированный пользователь (READER/EDITOR/ADMIN).

## Эндпоинты

### GET /api/dictionaries/partners
- Метод/путь: `GET /api/dictionaries/partners`
- Параметры: нет
- Авторизация: аутентифицированный (любая роль)
- Сервис: `service.partnerNames()`
- Ответ: `List<String>`

### GET /api/dictionaries/cc-segments
- Метод/путь: `GET /api/dictionaries/cc-segments`
- Параметры: нет
- Авторизация: аутентифицированный (любая роль)
- Сервис: `service.ccSegments()`
- Ответ: `List<CcSegment>`

### GET /api/dictionaries/comm-names
- Метод/путь: `GET /api/dictionaries/comm-names`
- Параметры: `@RequestParam(required = false) String channel`
- Авторизация: аутентифицированный (любая роль)
- Сервис: `service.communicationNames(channel)`
- Ответ: `List<String>`

## Связанные заметки
[[DictionaryService]] · [[SecurityConfig]] · [[REST API]]

## Источник
- `src/main/java/ru/banki/crm/web/DictionaryController.java`
- `src/main/java/ru/banki/crm/domain/CcSegment.java`
