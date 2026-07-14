---
tags: [frontend, api, javascript]
---

# api.js

Тонкий слой доступа к бэкенду. IIFE, публикует `window.CRM`. Загружается в `<head>` до инлайновых скриптов v1, чтобы `CRM` был готов раньше. Связывает «рыхлые» объекты формы v1 с `[[TemplateDto]]` бэкенда и вызывает `[[REST API]]`.

## Обёртка `req(method, url, body)`

`fetch`-обёртка (`api.js:8`):
- `credentials: "same-origin"`, `Accept: application/json`; при наличии `body` — `Content-Type: application/json` + `JSON.stringify`.
- `401` → редирект на `login.html` (если мы не на ней уже) + `throw`.
- не-`ok` → достаёт текст ошибки, пытается распарсить `JSON.message`, кидает `Error`.
- `204` → `null`; иначе по `content-type` возвращает `r.json()` или `r.text()`.

`var BASE = ""` — все пути относительные к origin.

## Методы объекта `CRM`

| Метод | HTTP-вызов | Эндпоинт `[[REST API]]` |
|---|---|---|
| `fetchMe()` | GET | `/api/me` |
| `listTemplates(filters)` | GET | `/api/templates` (+ query из непустых `filters`) |
| `getTemplate(channel, code)` | GET | `/api/templates/{channel}/{code}` |
| `createTemplate(dto)` | POST | `/api/templates/{dto.channel}` |
| `updateTemplate(channel, code, dto)` | PUT | `/api/templates/{channel}/{code}` |
| `deleteTemplate(channel, code)` | DELETE | `/api/templates/{channel}/{code}` |
| `createChain(channel, base, days)` | POST | `/api/templates/{channel}/chain` тело `{base, days}` — метод определён, но **мастером больше не используется** (см. `saveFromV1` ниже) |
| `dictPartners()` | GET | `/api/dictionaries/partners` |
| `dictCcSegments()` | GET | `/api/dictionaries/cc-segments` |
| `dictCommNames(channel)` | GET | `/api/dictionaries/comm-names?channel={channel}` |
| `adminSections()` | GET | `/api/admin/sections` |
| `adminListUsers()` | GET | `/api/admin/users` |
| `adminCreateUser(u)` | POST | `/api/admin/users` |
| `adminUpdateUser(id, u)` | PUT | `/api/admin/users/{id}` |
| `adminDeleteUser(id)` | DELETE | `/api/admin/users/{id}` |
| `adminResetPassword(id, pwd)` | PUT | `/api/admin/users/{id}/password` тело `{newPassword}` |
| `changeOwnPassword(cur, next)` | PUT | `/api/me/password` тело `{currentPassword, newPassword}` |
| `logout()` | POST | `/logout` → редирект на `login.html` |

### `saveFromV1(d)` (`api.js:184`)
Решает create/update по контексту `window.CRM_CURRENT`. Считает это апдейтом, если открытый шаблон того же канала и его `code` совпадает с `dto.code` → `updateTemplate`; иначе `createTemplate`. Возвращает `{code}`.

Это **единственный** путь сохранения из «Мастера коммуникаций» ([[Communication Wizard Forms]]), в т.ч. для цепочки: `saveFromChannelForm` вызывает `saveFromV1` **по одному разу на каждую строку-день** таблицы цепочки (обнулив `CRM_CURRENT` → всегда create). Отдельный серверный `createChain` для этого больше не задействован. `campaign_name` (`source`/`sourceType`) в `d` вычисляется на клиенте функцией `computeCampaignName` (для строки цепочки — со своим днём) ещё до `v1ToDto`.

## Мапперы

### `apiItemToList(t)` (`api.js:40`)
Элемент ответа API → строка списка `ALL_TEMPLATES`:
`id = channel+":"+code`, `channel`, `code`, `name = communicationName || letterosId || (channel+" "+code)`, `product = productType[0] || ""`, `touch = touchPoint`, `trigger = triggerType`, `partner = partnerName`, `active = !!active`.

### `v1ToDto(d)` (`api.js:58`) — форма v1 → `[[TemplateDto]]`
`bool(v)` = `v==null ? null : !!v`. `products` = массив из `d.product`.

| form-key (v1) | DTO-поле |
|---|---|
| `channel` | `channel` |
| `code` (→ String, иначе null) | `code` |
| `product` (→ массив) | `productType` |
| `source` | `sourceType` **и** `source` |
| `communication_type` | `communicationType` |
| `trigger` | `triggerType` |
| `partner` | `partnerName` |
| `touch` | `touchPoint` |
| `aff_sub3` | `affSub3` |
| `day` (→ String) | `sendingDay` |
| `comname` | `communicationName`, `name`, `brief` (три поля) |
| `message` | `msgText` |
| `title` | `title` |
| `deeplink` | `deepLink` |
| `webview` | `webviewUrl` |
| `sender_name` | `senderName` |
| `email_from` | `emailFrom` |
| `subject` | `subject` |
| `letteros_id` (→ String) | `letterosId` |
| `service_flag` (bool) | `serviceFlag` |
| `info_flag` (bool) | `infoFlag` |
| `source_system` | `sourceSystem` |
| `segment_desc` | `segmentDescr` |
| `host_id` (→ Number) | `hostId` |
| `kvint` | `kvintCampaignId` |
| `biz_type` | `businessCommunicationType` |
| `active` (`!!`, иначе null) | `active` |
| `marketplace` (bool) | `marketplace` |
| `dialog` (bool) | `dialog` |
| `loyalty` (bool) | `loyalty` |
| `national_rating` (bool) | `nationalRating` |
| `news` (bool) | `news` |
| `mobile_app` (bool) | `mobileApp` |
| `night_send` (bool) | `nightSend` |

### `dtoToV1(t)` (`api.js:103`) — `[[TemplateDto]]` → форма v1 (для открытия/редактирования)

| DTO-поле | form-key (v1) |
|---|---|
| `channel` | `channel` |
| `code` | `code` |
| `triggerType` | `trigger` |
| `productType[0]` | `product` |
| `partnerName` | `partner` |
| `touchPoint` | `touch` |
| `affSub3` | `aff_sub3` |
| `communicationType` | `communication_type` |
| `active` (`!!`) | `active` |
| `source` | `source` |
| `communicationName` (или `"NoComName"`) | `comname` |
| `sendingDay` | `day` |
| `msgText` | `message` |
| `title` | `title` |
| `deepLink` | `deeplink` |
| `webviewUrl` | `webview` |
| `senderName` | `sender_name` |
| `emailFrom` | `email_from` |
| `subject` | `subject` |
| `letterosId` (или `code`) | `letteros_id` |
| `serviceFlag` (`!!`) | `service_flag` |
| `infoFlag` (`!!`) | `info_flag` |
| `sourceSystem` | `source_system` |
| `code` при `channel==="cc"` | `segment` (иначе `""`) |
| `segmentDescr` | `segment_desc` |
| `hostId` | `host_id` |
| `kvintCampaignId` | `kvint` |
| `businessCommunicationType` | `biz_type` |
| `marketplace`/`dialog`/`loyalty`/`nationalRating`/`news`/`mobileApp`/`nightSend` (`!!`) | `marketplace`/`dialog`/`loyalty`/`national_rating`/`news`/`mobile_app`/`night_send` |

## Бутстрап `meReady` / `applyNavAcl`

`CRM.meReady` (`api.js:198`) = `fetchMe()`; при успехе кладёт `me` в `CRM.me`/`window.CRM_ME`, ставит `data-role` на `<body>`. Ошибка глотается (редирект уже произошёл в `req` при 401).

`applyNavAcl()` (`api.js:205`) на `DOMContentLoaded` после `meReady`:
- `data-role`, `data-readonly="1"` (если `!me.canEdit`);
- заполняет `#userEmail` (текст = email, `title` = displayName · email (role));
- скрывает `.nav-item`, чей `data-id` нет в `me.sections`;
- открывает первый видимый пункт через `window.openSection`, если нужно.

## Источник

- `src/main/resources/static/api.js` (весь файл, 1–233)
