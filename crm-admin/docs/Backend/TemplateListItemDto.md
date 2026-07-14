---
tags: [backend, dto]
---

# TemplateListItemDto

Java `record` — одна строка объединённого «Списка шаблонов» (зеркалит UNION `FetchAllTemplates` из v2). Формируется в [[TemplateMapper]] `toListItem`.

## Поля

- `channel : String` — канал (`push` / `email` / `sms` / `cc`).
- `code : String` — бизнес-код (`businessCode()` сущности).
- `communicationName : String`
- `productType : List<String>`
- `touchPoint : String`
- `triggerType : String`
- `partnerName : String`
- `active : Boolean` (из `activeFlag`).
- `letterosId : String` — заполняется только для email (иначе `null`).

## Связи

- Создаётся в [[TemplateMapper]]; возвращается [[TemplateService]] `list(...)`.
- Источник данных: [[TemplateBase]] и наследники.

## Источник

`src/main/java/ru/banki/crm/dto/TemplateListItemDto.java`
