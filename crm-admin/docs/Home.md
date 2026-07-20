---
tags: [moc, home, index]
---

# Home

Документация проекта **crm-admin** — самописной админ-панели управления CRM-коммуникациями, заменившей low-code-админку на Appsmith. Один артефакт **Java 21 / Spring Boot 3.3** (`crm-admin.jar`) со встроенным **vanilla-JS SPA** (без фреймворков и сборки), поверх **PostgreSQL 16**, развёрнут в **Docker** тремя средами (prod / preprod / test) из одного образа.

Что умеет система:

- **Оболочка в стиле Salesforce Lightning** — App Launcher с пятью приложениями, левый сайдбар с flyout 2-го уровня и обзорными страницами, тема light/dark/system, i18n RU/EN; плюс настроечная админка `/settings` (только ADMIN) с конфигом «приложение → разделы» в БД;
- **Мастер коммуникаций** — единый CRUD шаблонов четырёх каналов (SMS / Push / Email / колл-центр) поверх прод-идентичных таблиц, с автогенерацией имён и кодов и батч-созданием «цепочки дней»; «Список шаблонов» — SF list view, «Просмотр настроек» — SF Details-карточка с inline-редактированием и предпросмотром коммуникаций;
- **Цепочки (Flow Builder)** — визуальный конструктор сценариев коммуникаций на канве Drawflow (по образцу Salesforce Flow Builder), схемы хранятся jsonb-документами; раздел только для ADMIN и только на test;
- **Материализация** — «компиляция» цепочки в реальные строки конфигурационных таблиц, которые читают существующие прод-движки рассылок: нормализованный слой A (`flow.*`, `template.d_template`) + копии прод-таблиц слой B (`tracker/scheduler/template/commapi`); идемпотентно, транзакционно, с журналом;
- **RBAC** — роли READER/EDITOR/ADMIN + персональный ACL разделов, своя аутентификация (form-login, remember-me);
- **Аудит** — прикладной журнал `arch.t_admin_log` + прод-триггерный `arch.arch_log` (GUC `app.current_user`).

> ➜ **[[Флоу системы]] — читать первым**: сквозной рассказ «как всё работает» от входа до прод-движков, со схемами.
> ➜ **[[Шпаргалка]] — держать под рукой**: что и где смотреть при эксплуатации (очередь синка, роли, обновление, типовые сбои).

## Статус: что работает / что отложено

| Работает | Отложено / не реализовано |
|---|---|
| CRUD шаблонов всех 4 каналов + батч-цепочка дней (одной транзакцией); SF list view и SF Details-карточка просмотра/правки | **Движок исполнения цепочек (runs/steps) не реализован** — ноды Pause / Decision / Assignment / Loop / Data чисто визуальные; материализуются только старт + Communication Alert (+ развёрнутые Subflow); задержки в проде задаются `sending_day` шаблонов |
| Оболочка Lightning: App Launcher (5 приложений), сайдбар + flyout, обзорные страницы, тема light/dark/system, i18n RU/EN; настроечная админка `/settings` + `app.panel_settings` | **Мониторинг и Тепловая карта — заглушки** («Статистика в разработке»); дашборд и виджеты главной — демо-данные |
| Пользователи, роли, ACL разделов, бутстрап супер-админа | **Парсер старых цепочек** (импорт существующих прод-конфигураций в Flow Builder) — отложен |
| Flow Builder: канва, компактные узлы, модалка настроек, мультивыделение, Subflow, предпросмотр | **Промоушен на preprod/prod — только по команде**: всё новое сначала на test (`docker compose build app-prod` + `up -d --no-deps app-test`), раздел «Цепочки» виден только на test и только ADMIN |
| Материализация в слои A и B: идемпотентность (`flow.t_materialization`), белый список таблиц, `(auto)`-FK, синк `template.d_template` | CSRF отключён (внутренний инструмент; включить до публикации наружу), SSO/LDAP нет — см. [[Безопасность и RBAC]] |
| Аудит двух уровней, три среды, скрипты reset-test / refresh-preprod | На prod/preprod цепочки в mock-хранилище (in-memory), в БД — только на test (`JOURNEYS_MOCK=false`) |

## Карта заметок

### Архитектура

- [[Обзор архитектуры]] — общая картина: компоненты, двухслойная модель A/B, ключевые дизайн-решения (почему не low-code, почему свои копии прод-таблиц, почему два слоя);
- [[Технологии]] — стек по `pom.xml`/`Dockerfile`: Java 21, Spring Boot 3.3.4, Flyway, PostgreSQL 16, vanilla JS + вендореный Drawflow, и почему так;
- [[Среды и деплой]] — три compose-стека (prod :8080 / preprod :8081 / test :8082) из одного образа, env-переменные, per-env куки, промоушен, `reset-test.sh` / `refresh-preprod.sh`;
- [[Безопасность и RBAC]] — SecurityConfig, form-login `/api/login`, remember-me, роли + ACL разделов, `AccessGuard`, `AdminBootstrap`, известные follow-ups.

### Бэкенд

- [[Обзор бэкенда]] — структура пакетов `ru.banki.crm`, все контроллеры/сервисы/сущности, сквозные паттерны;
- [[Шаблоны и мастер коммуникаций]] — `TemplateController`/`TemplateService`/`TemplateMapper`: CRUD 4 каналов, генерация кодов, батч `chain`;
- [[Пользователи и доступ]] — `UserService`, `AdminUserController`, защита последнего админа, смена паролей;
- [[Цепочки (Journeys)]] — хранение схем jsonb в `app.journeys`, CRUD `/api/journeys`, DTO узлов/рёбер, Db/Mock-реализации, правило «цепочка без старта = Subflow»;
- [[Материализация (Flow)]] — `FlowController` + `MaterializationService`: validate, preview, materialize, upsert слоя A, разворачивание Subflow, `resolveSource`, синк единого справочника;
- [[Аудит и журналирование]] — `arch.arch_log` (триггер + GUC через `AuditContext`) и `arch.t_admin_log` (`AdminLogService`);
- [[Конфигурация]] — `application.yml`, профили docker/prod, `app.tables.*`, все env-переменные.

### Фронтенд

- [[Обзор фронтенда]] — SPA без сборки: `index.html` + `api.js`, бутстрап `/api/me` + `/api/env`, ACL навигации, клиентские инструменты (Панель отклонений, OneLink, Конструктор source);
- [[Оболочка панели (shell)]] — оболочка Salesforce Lightning: App Launcher (5 приложений), сайдбар `renderNav` + flyout, обзорные страницы, тема light/dark/system, i18n RU/EN, загруженные инструменты, мониторинг-заглушки, ACL-контракт `applyNavAcl`;
- [[Мастер коммуникаций (формы)]] — формы 4 каналов с настроечным блоком канала, автоимена `communication_name`/`campaign_name`, цепочка дней, SF list view и SF Details-карточка просмотра;
- [[Flow Builder (цепочки)]] — `journeys.js`: типы узлов, компактные карточки, модалка настроек (двойной клик), мультивыделение, справочники значений, UX канвы, предпросмотр и материализация с фронта;
- [[Управление доступом и вход]] — `login.html`, `admin-users.js` и настроечная админка `/settings` (только ADMIN).

### База данных

- [[Схема БД]] — все 9 схем, миграции V1–V7 + сиды, ER-диаграмма связей, аудит на уровне БД;
- [[Таблицы приложения]] — `app.users`, `app.user_sections`, `app.journeys`, `app.panel_settings`, `arch.arch_log`, `arch.t_admin_log`;
- [[Справочники шаблонов]] — 4 канальные прод-таблицы (`notice.*`, `callcenter.*`) + единый справочник `template.d_template` (`channel_props jsonb`);
- [[Слой A (flow)]] — нормализованная модель: `flow.d_event` и обвязка, журнал `flow.t_materialization`;
- [[Слой B (процессные таблицы)]] — копии прод-таблиц: `tracker.*`, `scheduler.*`, `template.d_template_mapping*`, `commapi.d_definition_mapping`.

### API

- [[REST API]] — сводка всех эндпоинтов `/api/**` (включая `/api/panel-settings`) с телами запросов, кодами ошибок и правилами доступа; Swagger UI на `/swagger-ui.html`.
