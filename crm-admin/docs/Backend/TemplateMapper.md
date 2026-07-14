---
tags: [backend, service, mapper]
---

# TemplateMapper

`@Component`. Маппит единый [[TemplateDto]] на четыре канальные сущности и обратно, а также строит строку списка [[TemplateListItemDto]].

## Методы

- `TemplateListItemDto toListItem(TemplateBase e)` — строит строку списка. `letterosId` заполняется только если `e instanceof EmailTemplate` с ненулевым `letterosId`. Поля берутся из [[TemplateBase]] (`channel()`, `businessCode()`, `communicationName`, `productType`, `touchPoint`, `triggerType`, `partnerName`, `activeFlag`).
- `TemplateDto toDto(TemplateBase e)` — полное чтение сущности в DTO. Сначала переносит общие поля [[TemplateBase]] (`sendingDay` конвертируется в строку), затем через `instanceof`-паттерн добавляет поля конкретного канала: `PushTemplate` (source, msgText, title, brief, name, deepLink, webviewUrl, nightSend), `SmsTemplate` (source, msgText, brief, name, senderName, nightSend), `EmailTemplate` (source, letterosId→String, subject, emailFrom, service→serviceFlag, info→infoFlag, msgText, preheader, utmCustom), `CcSegment` (sourceSystem, segmentDescr, hostId, mlCheckProbability, mlProbabilityRequired, cutpercent, nocutpercent, kvintCampaignId).
- `void apply(TemplateBase e, TemplateDto d)` — записывает НЕ-null поля DTO на сущность (годится и для create, и для update). Переносит общие поля, затем канальные через `instanceof`. Для `sendingDay` — `setInt`, для `letterosId` — `setLong`.

## Приватные помощники

- `static <T> void set(T value, Consumer<T> setter)` — применяет setter только если `value != null`.
- `static void setInt(String value, Consumer<Integer> setter)` — парсит числовую строку (например `sending_day`); пустое/невалидное значение пропускается (остаётся default сущности).
- `static void setLong(String value, Consumer<Long> setter)` — парсит `letteros_id` (bigint); нечисловой ввод игнорируется.

## Связи

- Используется [[TemplateService]].
- Сущности: [[TemplateBase]], [[PushTemplate]], [[EmailTemplate]], [[SmsTemplate]], [[CcSegment]].
- DTO: [[TemplateDto]], [[TemplateListItemDto]].

## Источник

`src/main/java/ru/banki/crm/service/TemplateMapper.java`
