---
tags: [backend, dto]
---

# TemplateDto

Единый payload для create/read/update по всем каналам (push / email / sms / cc). Заполняются только поля, относящиеся к конкретному каналу; сервис ([[TemplateService]]) через [[TemplateMapper]] переносит их на нужную сущность. Аннотация `@Data` (Lombok).

## Поля

Общие:
- `channel : String` — `push | email | sms | cc`.
- `code : String` — бизнес-идентификатор (code / email id / cc segment), строкой по проводу.

Общее ядро (маппится на [[TemplateBase]]):
- `productType : List<String>`
- `sourceType : String`
- `communicationType : String`
- `source : String`
- `triggerType : String`
- `sendingDay : String`
- `partnerName : String`
- `affSub3 : String`
- `active : Boolean` (→ `activeFlag`)
- `communicationName : String`
- `touchPoint : String`
- `businessCommunicationType : String`
- `nationalRating : Boolean`
- `marketplace : Boolean`
- `mobileApp : Boolean`
- `loyalty : Boolean`
- `dialog : Boolean`
- `news : Boolean`
- `selectionWizardService : String`

push / sms:
- `msgText : String`
- `title : String`
- `brief : String`
- `name : String`
- `deepLink : String`
- `webviewUrl : String`
- `senderName : String`
- `nightSend : Boolean`

email:
- `letterosId : String`
- `subject : String`
- `emailFrom : String`
- `serviceFlag : Boolean` (→ `is_service`)
- `infoFlag : Boolean` (→ `is_info`)
- `preheader : String`
- `utmCustom : String`

cc:
- `sourceSystem : String`
- `segmentDescr : String`
- `hostId : Long`
- `mlCheckProbability : Boolean`
- `mlProbabilityRequired : BigDecimal`
- `cutpercent : Integer`
- `nocutpercent : Integer`
- `kvintCampaignId : String`

## Связи

- Маппинг на сущности: [[TemplateMapper]] (`apply`, `toDto`).
- Обрабатывается в [[TemplateService]]; входит в [[ChainRequest]] как `base`.
- Сущности: [[PushTemplate]], [[EmailTemplate]], [[SmsTemplate]], [[CcSegment]], [[TemplateBase]].

## Источник

`src/main/java/ru/banki/crm/dto/TemplateDto.java`
