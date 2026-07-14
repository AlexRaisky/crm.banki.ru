---
tags: [frontend, wizard, forms, reference, key]
---

# Communication Wizard Forms

Ключевой справочник по 4 формам «Мастера коммуникаций», пересобранным из Appsmith-экспорта v2. Каждая форма — `<div id="sms|push|email|cc" class="form">` внутри `#sec-admin`, со скрытым `<input class="channel">` и кнопкой `saveFromChannelForm('{channel}')`.

## Как форма превращается в данные

1. **`collectFormData(formEl, channel)`** (`index.html:4502`) обходит все `input/textarea/select` и раскладывает значения по ключам объекта `data` — маппинг **по CSS-классу элемента**, а `Message Text` — по тексту `<label>` (`label.indexOf('message')`). Для чекбоксов берётся `checked`.
2. Пост-обработка в `collectFormData`: для `cc` — `data.code = data.segment`; для `email` — `data.service_flag = biz_type==='service'`, `data.info_flag = biz_type==='info'`.
3. **`saveFromChannelForm(channel)`** (`index.html:4579`) валидирует (КЦ→Segment, Email→Letteros Id — только если это НЕ цепочка, всегда→Communication Name), пересчитывает `campaign_name` через `computeCampaignName` и зовёт `CRM.saveFromV1(d)`: для одиночного шаблона — один вызов; для цепочки — по одному вызову на строку-день (см. «Цепочка (chain)»).
4. **`CRM.v1ToDto`** ([[api.js]]) переводит `data` в `[[TemplateDto]]`, бэкенд `[[TemplateMapper]]` кладёт в нужную таблицу БД.

Колонка «data-ключ» ниже — это ключ в объекте `collectFormData`; «DTO-поле» — поле `[[TemplateDto]]` после `v1ToDto`; «колонка БД» — колонка таблицы канала.

## Редактируемый combobox

Единственный combobox во всех формах — **Communication Name**: `<input class="combo-input comname" ...>` внутри `<div class="combo">` c `.combo-pop`. Обслуживается [[combobox.js]], подсказки задаёт [[wizard.js]] (`COMNAME_SEED` + живые из БД через `CRM.dictCommNames`). Атрибут `data-comname-base` хранит «базу» имени; флаги достраивают суффиксы/префиксы (см. «Производные поля»). **Product Type и Touch point — нативные `<select>`** (наполняются `wizard.js`), не combobox.

---

## SMS — `#sms` (channel `sms`, таблица `[[notice.d_com_sms_template]]`)

| Подпись | Контрол | CSS-класс | data-ключ | DTO-поле | колонка БД |
|---|---|---|---|---|---|
| Message Text | textarea | — (по label) | `message` | `msgText` | `msg_text` |
| Communication Name | combobox | `combo-input comname` | `comname` | `communicationName` (+`name`,`brief`) | `communication_name` (+`name`,`brief`) |
| Landing Page | input | `aff_sub3` | `aff_sub3` | `affSub3` | `aff_sub3` |
| Partner Name | input | `partner` | `partner` | `partnerName` | `partner_name` |
| Sending Day | input number | `day` | `day` | `sendingDay` | `sending_day` |
| Campaign Name | input | `source` | `source` | `sourceType`+`source` | `source_type`+`source` |
| Communication Tunnel | select (adv/service) | `communication_type` | `communication_type` | `communicationType` | `communication_type` |
| Business Communication Type | select (adv/service/info) | `biz_type` | `biz_type` | `businessCommunicationType` | `business_communication_type` |
| Sender Type | select (promo/trigger) | `trigger` | `trigger` | `triggerType` | `trigger_type` |
| Sender Name | select (Banki.ru/Bamm.ru) | `sender_name` | `sender_name` | `senderName` | `sender_name` |
| Product Type | select (нативный) | `product` | `product` | `productType` | `product_type` |
| Touch point | select (нативный) | `touch` | `touch` | `touchPoint` | `touch_point` |
| Active | checkbox | `active_flag` | `active` | `active` | `active_flag` |
| Marketplace | checkbox | `cb-marketplace` | `marketplace` | `marketplace` | `marketplace` |
| Dialog | checkbox | `cb-dialog` | `dialog` | `dialog` | `dialog` |
| loyalty | checkbox | `cb-loyalty` | `loyalty` | `loyalty` | `loyalty` |
| National Rating | checkbox | `cb-national_rating` | `national_rating` | `nationalRating` | `national_rating` |
| News | checkbox | `cb-news` | `news` | `news` | `news` |
| Night Send | checkbox | `cb-night_send` | `night_send` | `nightSend` | `night_send` |
| Mobile App | checkbox | `cb-mobile_app` | `mobile_app` | `mobileApp` | `mobile_app` |
| Cross | checkbox | `cb-cross` | `cross` | — (нет в DTO) | — |
| Is chain | checkbox | `cb-chain` | `chain` | — (клиентская логика цепочки) | — |
| Дни цепочки | input | `chain-days` | — (в таблицу строк) | — | — |
| SMS CallCenter | checkbox | `cb-sms-cc` | `cc_cross` | — (нет в DTO) | — |

`code` для SMS выдаёт бэкенд (в форме поля нет).

---

## Push — `#push` (channel-значение `mobile-push`, таблица `[[notice.push_template]]`)

Отличия от SMS: добавлены Title/Deep Link/Webview, **нет** Sender Name и SMS-CallCenter.

| Подпись | Контрол | CSS-класс | data-ключ | DTO-поле | колонка БД |
|---|---|---|---|---|---|
| Message Text | textarea | — (по label) | `message` | `msgText` | `msg_text` |
| Title Text | input | `title` | `title` | `title` | `title` |
| Deep Link | input | `deeplink` | `deeplink` | `deepLink` | `deep_link` |
| Webview link | input | `webview` | `webview` | `webviewUrl` | `webview_url` |
| Communication Name | combobox | `combo-input comname` | `comname` | `communicationName` (+`name`,`brief`) | `communication_name` (+`name`,`brief`) |
| Landing Page | input | `aff_sub3` | `aff_sub3` | `affSub3` | `aff_sub3` |
| Partner Name | input | `partner` | `partner` | `partnerName` | `partner_name` |
| Sending Day | input number | `day` | `day` | `sendingDay` | `sending_day` |
| Campaign Name | input | `source` | `source` | `sourceType`+`source` | `source_type`+`source` |
| Communication Tunnel | select (adv/service) | `communication_type` | `communication_type` | `communicationType` | `communication_type` |
| Business Communication Type | select (adv/service/info) | `biz_type` | `biz_type` | `businessCommunicationType` | `business_communication_type` |
| Sender Type | select (promo/trigger) | `trigger` | `trigger` | `triggerType` | `trigger_type` |
| Product Type | select (нативный) | `product` | `product` | `productType` | `product_type` |
| Touch Point | select (нативный) | `touch` | `touch` | `touchPoint` | `touch_point` |
| Active | checkbox | `active_flag` | `active` | `active` | `active_flag` |
| Marketplace / Dialog / loyalty / National Rating / News | checkbox | `cb-marketplace` / `cb-dialog` / `cb-loyalty` / `cb-national_rating` / `cb-news` | `marketplace` / `dialog` / `loyalty` / `national_rating` / `news` | `marketplace` / `dialog` / `loyalty` / `nationalRating` / `news` | одноимённые |
| Night Send / Mobile App / Cross | checkbox | `cb-night_send` / `cb-mobile_app` / `cb-cross` | `night_send` / `mobile_app` / `cross` | `nightSend` / `mobileApp` / — | `night_send` / `mobile_app` / — |
| Is chain (+Дни цепочки) | checkbox / input | `cb-chain` / `chain-days` | `chain` / — | — (клиентская логика цепочки) | — |

---

## Email — `#email` (channel `email`, таблица `[[notice.email_template]]`)

Отличия: есть Sender Email и Letteros Id, **нет** Message Text и Sender Name; email-CallCenter вместо sms. Производные `service_flag`/`info_flag` вычисляются из Business Communication Type.

| Подпись | Контрол | CSS-класс | data-ключ | DTO-поле | колонка БД |
|---|---|---|---|---|---|
| Communication Name | combobox | `combo-input comname` | `comname` | `communicationName` (+`name`,`brief`) | `communication_name` |
| Sender Email | input | `email_from` | `email_from` | `emailFrom` | `email_from` |
| Letteros Id | input | `letteros_id` | `letteros_id` | `letterosId` | `letteros_id` |
| Landing Page | input | `aff_sub3` | `aff_sub3` | `affSub3` | `aff_sub3` |
| Partner Name | input | `partner` | `partner` | `partnerName` | `partner_name` |
| Sending Day | input number | `day` | `day` | `sendingDay` | `sending_day` |
| Campaign Name | input | `source` | `source` | `sourceType`+`source` | `source_type`+`source` |
| Communication Tunnel | select (adv/service) | `communication_type` | `communication_type` | `communicationType` | `communication_type` |
| Business Communication Type | select (adv/service/info) | `biz_type` | `biz_type` | `businessCommunicationType` | `business_communication_type` |
| Sender Type | select (promo/trigger) | `trigger` | `trigger` | `triggerType` | `trigger_type` |
| Product Type | select (нативный) | `product` | `product` | `productType` | `product_type` |
| Touch Point | select (нативный) | `touch` | `touch` | `touchPoint` | `touch_point` |
| Active | checkbox | `active_flag` | `active` | `active` | `active_flag` |
| _(производное)_ Service | — (из biz_type) | — | `service_flag` | `serviceFlag` | `is_service` |
| _(производное)_ Info | — (из biz_type) | — | `info_flag` | `infoFlag` | `is_info` |
| Marketplace / Dialog / loyalty / National Rating / News | checkbox | `cb-*` | одноимённые | одноимённые | одноимённые |
| Night Send / Mobile App / Cross | checkbox | `cb-night_send` / `cb-mobile_app` / `cb-cross` | `night_send` / `mobile_app` / `cross` | `nightSend` / `mobileApp` / — | `night_send` / `mobile_app` / — |
| Is chain (+Дни цепочки) | checkbox / input | `cb-chain` / `chain-days` | `chain` / — | — (клиентская логика цепочки) | — |
| Email CallCenter | checkbox | `cb-email-cc` | `cc_cross` | — (нет в DTO) | — |

Бизнес-идентификатор письма — `letteros_id` (обязателен при сохранении). У email-таблицы также есть `night_send`? Нет — колонки `night_send` в `email_template` нет, поэтому `nightSend` для email в БД не сохраняется (флаг присутствует в форме и DTO).

---

## КЦ — `#cc` (channel `cc`, таблица `[[callcenter.d_segment_properties]]`)

Отличия: бизнес-идентификатор — **Segment** (число, обязателен), становится `code`/`segment`. Есть Source System, Host Id, Segment Descr, Kvint. **Нет** Message, Title, Sender, CallCenter-чекбокса и **цепочки** (у КЦ она не поддерживается — нет ни `cb-chain`, ни `CHAIN_COLUMNS.cc`). A/B из формы также убран.

| Подпись | Контрол | CSS-класс | data-ключ | DTO-поле | колонка БД |
|---|---|---|---|---|---|
| Communication Name | combobox | `combo-input comname` | `comname` | `communicationName` (+`name`,`brief`) | `communication_name` |
| Source System | select (KASKO/INVEST/INSMORTGAGE/CPA/MPK/OSAGO/RKO) | `source_system` | `source_system` | `sourceSystem` | `source_system` |
| Segment | input number | `segment` | `segment` → `code` | `code` | `segment` (бизнес-ключ) |
| Host Id | input number | `host_id` | `host_id` | `hostId` | `host_id` |
| Segment Descr | textarea | `segment_desc` | `segment_desc` | `segmentDescr` | `segment_descr` |
| Landing Page | input | `aff_sub3` | `aff_sub3` | `affSub3` | `aff_sub3` |
| Partner Name | input | `partner` | `partner` | `partnerName` | `partner_name` |
| Sending Day | input number | `day` | `day` | `sendingDay` | `sending_day` |
| Kvint Campaign Id | input | `kvint` | `kvint` | `kvintCampaignId` | `kvint_campaign_id` |
| Campaign Name | input | `source` | `source` | `sourceType`+`source` | `source_type`+`source` |
| Communication Tunnel | select (adv/service) | `communication_type` | `communication_type` | `communicationType` | `communication_type` |
| Business Communication Type | select (adv/service/info) | `biz_type` | `biz_type` | `businessCommunicationType` | `business_communication_type` |
| Sender Type | select (promo/trigger) | `trigger` | `trigger` | `triggerType` | `trigger_type` |
| Product Type | select (нативный) | `product` | `product` | `productType` | `product_type` |
| Touch Point | select (нативный) | `touch` | `touch` | `touchPoint` | `touch_point` |
| Active Flag | checkbox | `active_flag` | `active` | `active` | `active_flag` |
| Marketplace / Dialog / loyalty / National Rating / News | checkbox | `cb-*` | одноимённые | одноимённые | одноимённые |
| Night Send / Mobile App / Cross | checkbox | `cb-night_send` / `cb-mobile_app` / `cb-cross` | `night_send` / `mobile_app` / `cross` | `nightSend` / `mobileApp` / — | (в `d_segment_properties` нет `night_send`) / `mobile_app` / — |

---

## Цепочка (chain)

Только **SMS / Push / Email** (у КЦ цепочки нет). Модель v2: список дней → таблица → отдельный шаблон на строку.

1. Чекбокс `Is chain` (`.cb-chain`) через **`toggleChainField(el)`** ([[wizard.js]], `wizard.js:57`) показывает блок `.chain-field`: текстовое поле **«Дни цепочки»** (`.chain-days`, список чисел вида `0, 3, 7`) и кнопку «Сгенерировать строки».
2. **`buildChainRows(el)`** (`wizard.js:71`) парсит дни (запятая/пробел/`;`, без повторов) и строит редактируемую **таблицу** `.chain-rows` — одна строка на день, столбцы по каналу из `CHAIN_COLUMNS`:
   - **SMS** — Message Text (`message`);
   - **Push** — Title Text (`title`), Message Text (`message`), Deep Link (`deeplink`), Webview link (`webview`);
   - **Email** — Letteros Id (`letteros_id`).
3. При сохранении `saveFromChannelForm` (при `isChainOn`) зовёт **`readChainRows(formEl, channel)`** (`wizard.js:102`) → `[{day, overrides}]` с проверкой обязательных полей (SMS→`message`; Push→`title`,`message`; Email→`letteros_id`). Валидация верхнего Letteros Id для email при включённой цепочке пропускается (значение задаётся в строках).
4. Контекст обнуляется (`window.CRM_CURRENT = null` → всегда создание), затем **по одному `CRM.saveFromV1`** на строку (последовательно, через reduce/Promise): для каждой строки `data` мержится с её `overrides`, `day` = день строки, а `source` пересчитывается своим днём — `computeCampaignName(formEl, row.day)`. Итог — по одному шаблону на день; `createChain` больше не используется.

## campaign_name (source)

Поле **Campaign Name** (`.source`) генерируется строго по правилам Appsmith v2 функцией **`computeCampaignName(form, overrideDay)`** (`index.html:3772`). Пересчитывается вживую при изменении полей (через `buildSource` / `updateComnameFromCheckboxes` / `onComnameEdited`) и повторно при сохранении; `overrideDay` подставляет день строки цепочки.

Составляющие: `tab` = значение канала (`sms` / `mobile-push` / `email` / `cc`), либо `contact`, если включён SMS/Email CallCenter-флаг (`isCallcenterOn`); `senderType` = селект **Sender Type** (`.trigger`, `promo` | `trigger`); `product`, `partner`, `comname`, `day`, `segment` — из соответствующих полей; `date` = `ddmmyy` (сегодня).

Формулы:

| Условие | Формула |
|---|---|
| promo (не КЦ) | `{tab}_{senderType}_{product}_{partner}_{comname}_{ddmmyy}` |
| trigger (не КЦ) | `{tab}_{senderType}_{product}_{comname}_{sendingDay}day` |
| КЦ trigger | `contact_{senderType}_{product}_{comname}_{segment}_{day}day` |
| КЦ promo | `contact_{senderType}_{product}_{partner}_{comname}_{ddmmyy}day` |

`channelTab(form)` (`index.html:3761`) даёт `tab` из `.channel`, `isCallcenterOn(form)` (`index.html:3765`) — флаг `contact`.

## Производные поля

- **name / brief = communication_name.** В `v1ToDto` поля `name` и `brief` присваиваются из `comname`. В UI `syncNameFromCom` (`index.html:3839`) дублирует значение в `.name`.
- **Communication Name достраивается из флагов** — `updateComNameFromContext(comnameInput)` (`index.html:3809`) по v2 `generateCommunicationName`: база берётся из `data-comname-base`; спереди префикс `marketplace-` (флаг Marketplace), затем суффиксы в порядке `-dialog` (Dialog), `-loyalty` (loyalty), `-nr` (National Rating), `-news` (News), `-mobile-app` (Mobile App); для базы `out-trigger-` добавляется partner; базы с ведущим/замыкающим `-` достраиваются product-ом. Обратная синхронизация — `updateCheckboxesFromComname` (`index.html:3857`) выставляет чекбоксы по подстрокам имени (`marketplace-`, `-dialog`, `-loyalty`, `-nr`, `-news`, `-mobile-app`).
- **Campaign Name (source)** генерирует `computeCampaignName(form, overrideDay)` (см. раздел «campaign_name»); `buildSource(el)` (`index.html:3792`) — обёртка: сперва достраивает `comname` через `updateComNameFromContext`, затем пишет `computeCampaignName(form)` в `.source`. Ручной ввод имени (`onComnameEdited`) и смена чекбоксов (`updateComnameFromCheckboxes`) тоже пересчитывают `.source`.
- **Email is_service / is_info** выводятся из Business Communication Type (`biz_type==='service'` / `==='info'`) в `collectFormData` (`index.html:4550`). Отдельно `updateEmailSenderName` (`index.html:3878`) подставляет адрес отправителя по biz_type/touch/trigger.
- **КЦ code = segment** — `collectFormData` (`index.html:4548`) копирует `segment` в `code`; `dtoToV1` восстанавливает `segment` из `code` при `channel==="cc"`.

## Сохранение и контекст

`window.CRM_CURRENT` определяет INSERT vs UPDATE: открытие вкладки создания (`openTab`) обнуляет его → INSERT; `viewFromList` ставит `{channel, code}` → UPDATE. Решение принимает `CRM.saveFromV1` ([[api.js]]).

## Источник

- `src/main/resources/static/index.html` (`channelTab` `3761`, `isCallcenterOn` `3765`, `computeCampaignName` `3772`, `buildSource` `3792`, `updateComNameFromContext` `3809`, `updateCheckboxesFromComname` `3857`, `onComnameEdited` `3871`, `collectFormData` `4502`, `isChainOn` `4570`, `saveFromChannelForm` `4579`)
- `src/main/resources/static/wizard.js` (`CHAIN_COLUMNS` `47`, `toggleChainField` `57`, `buildChainRows` `71`, `readChainRows` `102`)
- `src/main/resources/static/api.js` (`v1ToDto` `58`, `saveFromV1` `184`)
- `src/main/resources/db/migration/V1__template_schema.sql` (колонки таблиц каналов)
