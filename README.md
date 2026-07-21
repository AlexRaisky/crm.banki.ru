# CRM Team · Панель управления

Панель управления CRM-системы в фирменном стиле CRM Team.
Логика — как в свежих версиях Salesforce Lightning: App Launcher (вафля)
с выбором приложения, левый сайдбар разделов; у составных разделов при
наведении всплывает меню 2-го уровня, а по клику открывается обзорная
страница с блоками подразделов.

## Структура репозитория

```
crm.banki.ru/
├── crm-admin/                     ← основное приложение (Spring Boot + REST API)
│   └── src/main/resources/static/ ← ИСХОДНИК фронтенда (править здесь)
│       ├── index.html
│       ├── css/  shell.css, section-*.css
│       ├── js/   shell.js, template-list.js, template-details.js,
│       │         wizard-forms.js, dashboard.js, onelink.js,
│       │         srcbuilder.js, promo.js, heatmap-*.js, boot.js
│       ├── api.js, journeys.js, admin-users.js, combobox.js, wizard.js
│       ├── login.html
│       └── settings/index.html    ← настроечная админка
├── index.html, css/, js/, settings/, …  ← КОПИЯ статики в корне для GitHub Pages
└── README.md
```

**Важно про Pages.** GitHub Pages отдаёт содержимое корня репозитория
(`main` / root), поэтому статика продублирована в корень. Правки делаются
в `crm-admin/src/main/resources/static/`, после чего копия обновляется:

```bash
SRC=crm-admin/src/main/resources/static
rm -rf css js settings login.html api.js admin-users.js combobox.js journeys.js wizard.js drawflow.min.*
cp -r $SRC/css $SRC/js $SRC/settings .
cp $SRC/index.html $SRC/login.html $SRC/api.js $SRC/admin-users.js \
   $SRC/combobox.js $SRC/journeys.js $SRC/wizard.js $SRC/drawflow.min.* .
```

На Pages бэкенда нет: запросы к `/api/...` возвращают 404, интерфейс
работает в демо-режиме на резервных данных (`applyFallbackData`).

## Разделы панели

- **Главная** — настраиваемая (блоки-виджеты, drag&drop, localStorage).
- **Управление коммуникациями** — обзорная страница с блоками; подразделы:
  OneLink Builder, Мастер коммуникаций (канал выбирается настроечным
  блоком, поля зависят от канала), Список шаблонов (Salesforce list view:
  поиск, сортировка, настройка отображаемых полей и фильтров через
  шестерёнку, правка ячеек по карандашу с подтверждением ✓), Просмотр
  настроек (канал → шаблон, поиск по source_type, для Email — по Letteros
  ID; карточка Salesforce Details с карандашами и предпросмотром
  SMS/Push/Letteros), Конструктор source, Планирование промо, Тепловая
  карта (только в приложении «Маркетинг»).
- **Дашборд** — Общая статистика, Панель отклонений.
- **Мониторинг** — Базовая работа кампаний.
- **Загруженные инструменты** — свои HTML-страницы внутри панели
  (масштабируются под окно, оформление не меняется).
- **Цепочки** и **Управление доступом** — только для администраторов.

## Планирование промо

Календарь промо-коммуникаций (дата, продукт, база, каналы, признак
«Тотал», название, ответственный, статус, комментарий). Формулы: день
недели вычисляется из даты, выходные подсвечиваются, строки «Тотал»
выделяются, сводка сверху пересчитывается по текущему фильтру. Есть
фильтры, поиск, добавление и удаление строк, правка ячеек, экспорт CSV;
правки сохраняются в браузере (`crmpanel:promoPlan`).

## Приложения (App Launcher)

Вафля в шапке: **Администрирование (по умолчанию) · Аналитика ·
Маркетинг · Бизнес · Контактный центр**. Набор разделов на приложение
хранится в `localStorage` → `crmpanel:appSections`, серверные права —
в `me.sections`.

## Тема и язык

Настроечная админка (`settings/`) → «Общие параметры»: тема
(светлая/тёмная/системная) и язык (русский/английский) применяются сразу
в обеих панелях, значения хранятся в `crmpanel:theme` / `crmpanel:lang`.

## Запуск

- **Фронтенд отдельно:** любой статик-сервер поверх
  `crm-admin/src/main/resources/static` (API-ошибки в консоли ожидаемы).
- **Полностью:** см. `crm-admin/README.md` и `crm-admin/DEPLOY.md`
  (Spring Boot + PostgreSQL, docker-compose).
