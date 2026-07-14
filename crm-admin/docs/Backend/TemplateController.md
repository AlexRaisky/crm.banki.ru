---
tags: [backend, controller, rest, templates]
---

# TemplateController

REST-контроллер шаблонов коммуникаций. Единая точка API для раздела «Список шаблонов» и мастера коммуникаций. Работает поверх нескольких физических таблиц (push / email / sms / cc), маршрутизация по `channel` выполняется в [[TemplateService]].

- Базовый путь: `@RequestMapping("/api/templates")`
- Аннотация класса: `@RestController`
- Зависимости (constructor injection): [[TemplateService]] `service`, [[AccessGuard]] `access`

Двухслойная авторизация:
- **Роль** проверяется методом (`@PreAuthorize`) — на мутациях требуется `EDITOR` или `ADMIN`.
- **Раздел (ACL)** проверяется через `access.requireAnySection(...)` — нужен доступ к секции `templates` или `admin` (`ADMIN` минует проверку). См. [[AccessGuard]], [[RBAC]].

## Эндпоинты

### GET /api/templates
Единый список для «Список шаблонов» (v2 `FetchAllTemplates`).

- Метод/путь: `GET /api/templates`
- Параметры (все `@RequestParam(required = false)`): `channel`, `product`, `touch`, `trigger`, `active`
- Авторизация: `access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN)` (роль — любой аутентифицированный)
- Сервис: `service.list(channel, product, touch, trigger, active)`
- Ответ: `List<TemplateListItemDto>`

### GET /api/templates/{channel}/{code}
Получение одного шаблона.

- Метод/путь: `GET /api/templates/{channel}/{code}`
- Path-переменные: `channel`, `code`
- Авторизация: `access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN)`
- Сервис: `service.get(channel, code)`
- Ответ: `TemplateDto`

### POST /api/templates/{channel}
Создание шаблона в заданном канале.

- Метод/путь: `POST /api/templates/{channel}`
- Path-переменная: `channel`
- Тело: `@Valid @RequestBody TemplateDto` (в контроллере `dto.setChannel(channel)`)
- Авторизация: `@PreAuthorize("hasAnyRole('EDITOR','ADMIN')")` + `access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES)`
- Сервис: `service.create(dto)`
- Ответ: `Map<String, String>` вида `{"code": <созданный код>}`

### POST /api/templates/{channel}/chain
Создание «цепочки»: N шаблонов с общей базой, различающихся днём отправки.

- Метод/путь: `POST /api/templates/{channel}/chain`
- Path-переменная: `channel`
- Тело: `@RequestBody ChainRequest` (поля `base: TemplateDto`, `days: List<String>`; в контроллере `req.getBase().setChannel(channel)`, если база задана)
- Авторизация: `@PreAuthorize("hasAnyRole('EDITOR','ADMIN')")` + `access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES)`
- Сервис: `service.createChain(req)`
- Ответ: `Map<String, List<String>>` вида `{"codes": [...]}`

### PUT /api/templates/{channel}/{code}
Обновление шаблона.

- Метод/путь: `PUT /api/templates/{channel}/{code}`
- Path-переменные: `channel`, `code`
- Тело: `@RequestBody TemplateDto`
- Авторизация: `@PreAuthorize("hasAnyRole('EDITOR','ADMIN')")` + `access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES)`
- Сервис: `service.update(channel, code, dto)`
- Ответ: `void` (200 OK без тела)

### DELETE /api/templates/{channel}/{code}
Удаление шаблона.

- Метод/путь: `DELETE /api/templates/{channel}/{code}`
- Path-переменные: `channel`, `code`
- Авторизация: `@PreAuthorize("hasAnyRole('EDITOR','ADMIN')")` + `access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES)`
- Сервис: `service.delete(channel, code)`
- Ответ: `void` (200 OK без тела)

## Связанные заметки
[[TemplateService]] · [[AccessGuard]] · [[SecurityConfig]] · [[REST API]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/web/TemplateController.java`
- `src/main/java/ru/banki/crm/dto/TemplateDto.java`
- `src/main/java/ru/banki/crm/dto/TemplateListItemDto.java`
- `src/main/java/ru/banki/crm/dto/ChainRequest.java`
