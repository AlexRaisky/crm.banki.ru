---
tags: [frontend, moc, spa]
---

# Frontend Overview

Карта фронтенда самостоятельной CRM-панели. Это одностраничное приложение (SPA) в стиле Salesforce Lightning, отдаётся как статика из `src/main/resources/static/` и общается с бэкендом только через `[[api.js]]` (объект `window.CRM`).

## Состав файлов

| Файл | Роль |
|---|---|
| `index.html` | Основной SPA (~5700 строк): верхняя навигация, все разделы (view), «Мастер коммуникаций» с 4 формами каналов, список шаблонов, дашборд, OneLink Builder, панель отклонений. См. [[Communication Wizard Forms]]. |
| `[[api.js]]` | Тонкий слой доступа к бэкенду. Объект `CRM` + мапперы `v1ToDto`/`dtoToV1`, обёртка `req()`, бутстрап `meReady`/`applyNavAcl`. Грузится в `<head>` до инлайновых скриптов. |
| `[[combobox.js]]` | Переиспользуемый редактируемый выпадающий список (`window.Combobox`). |
| `[[wizard.js]]` | Инициализация форм мастера: наполнение селектов Product/Touch, сид-подсказки Communication Name, переключатель цепочки. |
| `[[admin-users.js]]` | Раздел «Управление доступом» (`renderAccessSection`), только для ADMIN. |
| `[[login.html]]` | Отдельная страница входа (POST `/api/login`). |

## Структура SPA

Навигация задаётся массивом `NAV` (`index.html:2484`). Каждый пункт: `{ id, label, icon, view, adminMode? }`.

| `id` | Пункт | `view` (section id) | `adminMode` |
|---|---|---|---|
| `home` | Главная | `view-home` | — |
| `deviations` | Панель отклонений | `sec-deviations` | — |
| `onelink` | OneLink Builder | `sec-onelink` | — |
| `admin` | Мастер коммуникаций | `sec-admin` | `wizard` |
| `templates` | Список шаблонов | `sec-admin` | `list` |
| `dashboard` | Дашборд | `sec-admin` | `dashboard` |
| `access` | Управление доступом | `sec-access` | — |

Пункты NAV рендерятся в `#nav` как `.nav-item` c `data-id` (`index.html:2510`). Клик вызывает `openSection(id)`.

- **`openSection(id)`** (`index.html:2522`) — переключает активные `.nav-item` и `.view` по `data-id`/`id`, вызывает `setAdminMode` для admin-разделов, рендерит раздел доступа (`renderAccessSection`), запоминает `lastSection` в `localStorage`.
- **`setAdminMode(mode)`** (`index.html:2547`) — три пункта (`admin`/`templates`/`dashboard`) делят одну секцию `#sec-admin`: режим `wizard` показывает вкладки, `list`/`dashboard` скрывают панель вкладок `#tabsBar` и активируют форму `#list`/`#dashboard`.

### Вкладки мастера

Внутри `#sec-admin` — панель `#tabsBar` с вкладками, переключаемыми `openTab(id, el)` (`index.html:3638`): `sms`, `push`, `email`, `cc`, `view` (Просмотр настроек), `list`, `dashboard`. При открытии вкладки создания канала (`sms/push/email/cc`) сбрасывается `window.CRM_CURRENT` — сохранение пойдёт как INSERT. 4 формы каналов детально описаны в [[Communication Wizard Forms]].

### Разделы вне мастера

- `#sec-onelink` — **OneLink Builder** (`index.html:1301`): сборщик диплинк-ссылок AppsFlyer OneLink. Селекты `#channel`, `#mailingType` и др., живой результат в `#resultCard`/`#result`, состояние-черновик (`.is-draft`).
- `#sec-deviations` — **Панель отклонений**: графики Chart.js (пересоздаются в `openSection` при первом показе из-за нулевого размера в скрытой секции).
- `#sec-access` — **Управление доступом**: пустой контейнер, наполняется из [[admin-users.js]].
- `view-home` — **Главная**: настраиваемая сетка виджетов (`WIDGETS`, `renderGrid`), данные в `localStorage` под префиксом `crmpanel:`.

## Связь с бэкендом

Весь HTTP идёт через `[[api.js]]` → `[[REST API]]`. Данные списка шаблонов грузит `loadMockData()` (`index.html:4954`) через `CRM.listTemplates()` → `CRM.apiItemToList`, заполняя глобальный `ALL_TEMPLATES`. Сохранение форм — `saveFromChannelForm` → `CRM.saveFromV1`. Полное открытие шаблона — `viewFromList` → `CRM.getTemplate` → `CRM.dtoToV1`.

## RBAC / скрытие NAV

Роль и разрешённые разделы приходят из `GET /api/me` (`CRM.meReady`). Функция `applyNavAcl` в [[api.js]]:
- ставит `data-role` (и `data-readonly` если `!canEdit`) на `<body>`;
- скрывает `.nav-item`, чей `data-id` отсутствует в `me.sections` (`el.style.display = "none"`);
- открывает первый видимый раздел, если текущий скрыт.

Раздел `access` дополнительно рендерится только когда доступен (пункт NAV виден лишь у ADMIN, у которого `access` есть в `sections`).

## Источник

- `src/main/resources/static/index.html` (NAV `2484`, `openSection` `2522`, `setAdminMode` `2547`, `openTab` `3638`, `loadMockData` `4954`)
- `src/main/resources/static/api.js` (`applyNavAcl` `205`)
