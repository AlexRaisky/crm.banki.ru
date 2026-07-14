---
tags: [frontend, wizard, forms, javascript]
---

# wizard.js

Инициализация форм «Мастера коммуникаций» под набор полей v2. IIFE. Наполняет нативные селекты, задаёт сид-подсказки редактируемого combobox «Communication Name» ([[combobox.js]]), подтягивает живые значения из БД, переключает поле цепочки. Значения взяты из Appsmith-экспорта v2 (`sourceData` соответствующих SELECT-виджетов).

## Константы

### `PRODUCT_OPTIONS` (`wizard.js:10`)
`rko`, `deposits`, `creditcards`, `business_credits`, `insurance_etc`, `investments`, `savings_account`, `mortgages`, `osago`, `debitcards`, `microloans`, `insurance_health`, `autocredits`, `kasko`, `lsre`, `general`, `cash_register`, `insurance_combo`, `exchange_rate`, `insurance_estate`, `credits`.
Дефолт при заполнении — `credits`.

### `TOUCH_OPTIONS` (`wizard.js:17`)
`promo`, `abandoned-view`, `abandoned-form`, `abandoned-showcase`, `abandoned-application`, `abandoned-approval`, `abandoned-splash`, `abandoned-rejection`, `abandoned-identification`, `abandoned-doc-load`, `sign`, `abandoned-payment`, `abandoned-refill`, `issue`, `renewal`, `mobile-app`.
Дефолт — `promo`.

### `COMNAME_SEED` (`wizard.js:24`)
Стартовые подсказки communication_name (как в v1): `NoComName`, `subscription`, `out-trigger-`, `promo`, `reset-email`, `reset-password`, `change-email`, `change-password`, `change-phone`, `confirm-email`, `confirm-phone`, `promocode`, `nps`, `loyalty`, `welcome`, `-cross`, `-marketplace`, `-nr`, `-loyalty`, `abandoned-view`, `abandoned-form`, `abandoned-showcase`, `abandoned-application`, `abandoned-approval`, `abandoned-rejection`, `abandoned-identification`, `abandoned-doc-load`, `sign`, `abandoned-payment`, `abandoned-refill`, `issue`, `renewal`.
Живые значения из БД добавляются сверху.

### `CHAIN_COLUMNS` (`wizard.js:47`)
Столбцы таблицы цепочки по каналу (день + редактируемые поля шаблона), как в v2 `generateRows`:
- `sms` → `message` (Message Text, `textarea`);
- `push` → `title` (Title Text), `message` (Message Text, `textarea`), `deeplink` (Deep Link), `webview` (Webview link);
- `email` → `letteros_id` (Letteros Id).

У КЦ (`cc`) цепочки нет, поэтому в `CHAIN_COLUMNS` его ключа нет.

## Функции

### `fillSelect(sel, options, def)` (`wizard.js:34`)
Наполняет `<select>` опциями. Идемпотентно (флаг `sel.dataset.filled`). Если `def` есть в списке — ставит его выбранным.

### `toggleChainField(el)` (`wizard.js:57`, `window.toggleChainField`)
Переключатель блока цепочки. По чекбоксу `Is chain` (`.cb-chain`) в текущей `.form` показывает/прячет блок `.chain-field` (поле дней + таблица). При выключении дополнительно очищает поле дней `.chain-days` и вычищает таблицу `.chain-rows`. Вешается через `onchange` в разметке форм SMS/Push/Email (у КЦ цепочки нет).

### `buildChainRows(el)` (`wizard.js:71`, `window.buildChainRows`)
Строит редактируемую таблицу цепочки из списка дней. Канал берётся из `form.id` (`sms | push | email`), набор столбцов — из `CHAIN_COLUMNS[channel]`. Читает `.chain-days`, парсит числа через запятую/пробел/`;`, отбрасывает пустое и нечисловое. Валидирует: минимум один день (иначе `alert`), дни не должны повторяться. Затем рендерит `<table class="chain-table">` в `.chain-rows`: первый столбец «День» (значение хранится и в `data-day` строки), далее по колонке на каждое поле из `CHAIN_COLUMNS` (`textarea` для `message`, иначе `input`; классы вида `crow-{key}`). Вызывается кнопкой «Сгенерировать строки» и по Enter в поле дней.

### `readChainRows(formEl, channel)` (`wizard.js:102`, `window.readChainRows`)
Считывает строки таблицы цепочки для сохранения. По `.chain-rows tr[data-chain-row]` собирает `[{day, overrides:{...}}]`, где `overrides` — значения полей канала из `CHAIN_COLUMNS`. Проверяет обязательные поля по каналу (`sms` → `message`; `push` → `title`, `message`; `email` → `letteros_id`); при незаполненном поле показывает `alert` с днём и возвращает `null`. Пустая таблица → `[]`. Результат использует `saveFromChannelForm` ([[Communication Wizard Forms]]) — по одному `CRM.saveFromV1` на строку.

### `initForms(root)` (`wizard.js:128`)
- `select.product` → `fillSelect(PRODUCT_OPTIONS, "credits")`;
- `select.touch` → `fillSelect(TOUCH_OPTIONS, "promo")`;
- для каждого `input.combo-input.comname`: `Combobox.setOptions(inp, COMNAME_SEED.slice())` и при ручном вводе (`input`) фиксирует базу — вызывает `inferComNameBase(inp.value)` (функция из `index.html`) и пишет её в `data-comname-base` (для авто-достройки флагов);
- вызывает `Combobox.attach(root)`.

### `loadLiveComNames()` (`wizard.js:150`)
Живые значения communication_name из БД по каналам → в подсказки combobox. Для пар `[["sms","sms"],["push","push"],["email","email"],["cc","cc"]]` вызывает `CRM.dictCommNames(channel)` → `[[REST API]]` (`GET /api/dictionaries/comm-names`). Полученный список мержит с `COMNAME_SEED` (без дублей) и ставит через `Combobox.setOptions` в `#{domId} input.combo-input.comname`. Ошибка/отсутствие эндпоинта — молча остаются сид-подсказки.

Инициализация: `initForms(document)` + `loadLiveComNames()` на `DOMContentLoaded`.

## Связанные детали

- Product Type и Touch point — **нативные `<select>`** (наполняются здесь), а не combobox.
- Communication Name — единственный редактируемый **combobox** в формах. См. [[Communication Wizard Forms]].

## Источник

- `src/main/resources/static/wizard.js` (весь файл, 1–168; `CHAIN_COLUMNS` `47`, `toggleChainField` `57`, `buildChainRows` `71`, `readChainRows` `102`, `initForms` `128`, `loadLiveComNames` `150`)
