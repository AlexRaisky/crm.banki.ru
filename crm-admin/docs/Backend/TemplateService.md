---
tags: [backend, service]
---

# TemplateService

`@Service`, центральный сервис CRUD-операций над шаблонами всех четырёх каналов. Диспетчеризует по строке `channel`, работает через канальные репозитории и [[TemplateMapper]], а перед каждой мутацией вызывает [[AuditContext]] `mark()`.

## Зависимости (constructor injection)

- `pushRepo : PushTemplateRepository`, `emailRepo : EmailTemplateRepository`, `smsRepo : SmsTemplateRepository`, `ccRepo : CcSegmentRepository` — [[PushTemplateRepository]], [[EmailTemplateRepository]], [[SmsTemplateRepository]], [[CcSegmentRepository]].
- `mapper : TemplateMapper` — [[TemplateMapper]].
- `audit : AuditContext` — [[AuditContext]].

## Методы

- `List<TemplateListItemDto> list(String channel, String product, String touch, String trigger, String active)` — `@Transactional(readOnly = true)`. Загружает `findAll()` из всех четырёх репозиториев в общий `List<TemplateBase>`, маппит каждый через `mapper::toListItem`, затем фильтрует в памяти по каналу, touch_point, trigger_type, наличию product в `productType`, и по активности (`"active".equals(active) == Boolean.TRUE.equals(i.active())`). Сортировка: по каналу, затем по `code` (null-safe). Возвращает список [[TemplateListItemDto]].
- `TemplateDto get(String channel, String code)` — `@Transactional(readOnly = true)`. `mapper.toDto(load(channel, code))`. Возвращает [[TemplateDto]].
- `String create(TemplateDto dto)` — `@Transactional`. Вызывает `audit.mark()`, затем `switch` по нормализованному каналу:
  - `push` — новый `PushTemplate`, `mapper.apply`, `code = pushRepo.maxCode()+1`, сохраняет, возвращает `code`.
  - `sms` — аналогично, `code = smsRepo.maxCode()+1`.
  - `email` — новый `EmailTemplate`, `mapper.apply`, сохраняет, возвращает `id`.
  - `cc` — требует непустой `dto.code` (иначе `400 "Для КЦ обязателен номер сегмента"`), `setSegment(Integer.valueOf(...))`, `mapper.apply`, возвращает `segment`.
  - иначе — `badChannel`.
  Возвращает бизнес-код созданной записи строкой.
- `List<String> createChain(ChainRequest req)` — `@Transactional`. Валидирует наличие `base` и непустого `days` (иначе `400`). Для каждого дня клонирует `base` через `cloneWithDay` и вызывает `create`. Возвращает список созданных кодов. См. [[ChainRequest]].
- `void update(String channel, String code, TemplateDto dto)` — `@Transactional`. `audit.mark()`, `load(channel, code)`, форсит `dto.setChannel(channel)`, `mapper.apply(e, dto)`; managed-сущность сбрасывается на commit.
- `void delete(String channel, String code)` — `@Transactional`. `audit.mark()`, `load`, `switch` по каналу вызывает `delete` соответствующего репозитория.

## Приватные помощники

- `TemplateBase load(String channel, String code)` — грузит сущность по каналу: push/sms — `findFirstByCode(Integer)`, email — `findById(Long)`, cc — `findFirstBySegment(Integer)`; при отсутствии `404 "Шаблон не найден: ..."`.
- `TemplateDto cloneWithDay(TemplateDto base, String day)` — `BeanUtils.copyProperties` + `setSendingDay(day)`.
- `static String norm(String channel)` — trim + lowercase (null → `""`).
- `static ResponseStatusException badChannel(String channel)` — `400 "Неизвестный канал: ..."`.

## Связи

- [[TemplateMapper]], [[AuditContext]], канальные репозитории, [[TemplateDto]], [[TemplateListItemDto]], [[ChainRequest]].
- Обзор потока запроса — [[Backend Overview]].

## Источник

`src/main/java/ru/banki/crm/service/TemplateService.java`
