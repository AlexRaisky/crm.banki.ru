---
tags: [backend, domain, entity, mapped-superclass]
---

# TemplateBase

`@MappedSuperclass`-базовый класс с колонками, общими для всех четырёх канальных таблиц (push / email / sms / cc). Значения по умолчанию заданы так, чтобы INSERT удовлетворял production-ограничениям NOT NULL, даже когда упрощённая форma v1 не передаёт поле. Важно: поле `source` здесь НЕ объявлено — в таблице call-центра такой колонки нет, оно живёт только в `PushTemplate` / `EmailTemplate` / `SmsTemplate`.

Аннотации класса: `@Getter`, `@Setter` (Lombok), `@MappedSuperclass`. Класс `abstract`.

## Ключевые поля (все `@Column`)

- `sourceType : String` — колонка `source_type`, default `""`.
- `productType : List<String>` — колонка `product_type`, тип `text[]`, маппинг через `@JdbcTypeCode(SqlTypes.ARRAY)`, default пустой `ArrayList`.
- `communicationType : String` — колонка `communication_type`, default `""`.
- `triggerType : String` — колонка `trigger_type`, default `""`.
- `sendingDay : Integer` — колонка `sending_day`, default `0`. В notice-таблицах это `smallint`, в callcenter — `integer`; `Integer` маппится на оба.
- `partnerName : String` — колонка `partner_name` (без default).
- `affSub3 : String` — колонка `aff_sub3`, default `""`.
- `activeFlag : Boolean` — колонка `active_flag`, default `true`.
- `communicationName : String` — колонка `communication_name`, default `""`.
- `touchPoint : String` — колонка `touch_point`, default `""`.
- `businessCommunicationType : String` — колонка `business_communication_type`, default `""`.
- `selectionWizardService : String` — колонка `selection_wizard_service`. В prod это `varchar(16)` (сервисный тег), НЕ boolean.
- `nationalRating : Boolean` — колонка `national_rating`, default `false`.
- `marketplace : Boolean` — колонка `marketplace`, default `false`.
- `mobileApp : Boolean` — колонка `mobile_app`, default `false`.
- `loyalty : Boolean` — колонка `loyalty`, default `false`.
- `dialog : Boolean` — колонка `dialog`, default `false`.
- `news : Boolean` — колонка `news`, default `false`.

## Абстрактные методы

- `abstract String channel()` — дискриминатор канала для объединённого списка (`"push"` / `"email"` / `"sms"` / `"cc"`).
- `abstract String businessCode()` — бизнес-идентификатор, показываемый пользователю (code / id / segment), строкой.

## Связи

- Наследники: [[PushTemplate]], [[EmailTemplate]], [[SmsTemplate]], [[CcSegment]].
- Используется в [[TemplateMapper]] и [[TemplateService]].
- DTO-представление: [[TemplateDto]], [[TemplateListItemDto]].

## Источник

`src/main/java/ru/banki/crm/domain/TemplateBase.java`
