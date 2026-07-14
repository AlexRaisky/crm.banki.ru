---
tags: [backend, service]
---

# DictionaryService

`@Service`. Справочные данные: названия партнёров (v2 `AllPartnerName`) и сегменты КЦ (v2 `FetchCCSegments`), а также подсказки communication_name.

## Зависимости

- `pushRepo`, `emailRepo`, `smsRepo`, `ccRepo` — [[PushTemplateRepository]], [[EmailTemplateRepository]], [[SmsTemplateRepository]], [[CcSegmentRepository]].

## Методы

- `List<String> partnerNames()` — `@Transactional(readOnly = true)`. Собирает `distinctPartnerNames()` из всех четырёх репозиториев в `TreeSet` (сортировка + дедуп), возвращает `List.copyOf`.
- `List<CcSegment> ccSegments()` — `@Transactional(readOnly = true)`. `ccRepo.findAll()` — список сегментов [[CcSegment]].
- `List<String> communicationNames(String channel)` — `@Transactional(readOnly = true)`. Возвращает уникальные `communication_name` для указанного канала (`push`/`email`/`sms`/`cc`); при неизвестном/пустом канале объединяет значения всех каналов. Собираются в `TreeSet`, возвращается `List.copyOf`. Используется для редактируемого combobox.

## Связи

- Канальные репозитории; сущность [[CcSegment]].
- Данные из [[TemplateBase]] (partnerName, communicationName).

## Источник

`src/main/java/ru/banki/crm/service/DictionaryService.java`
