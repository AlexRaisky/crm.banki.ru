---
tags: [backend, config, spring, profiles, flyway]
---

# application.yml

Конфигурация Spring Boot приложения `crm-admin`. Один документ базовых настроек + два профиля (`docker`, `prod`), разделённых `---`.

## Базовые настройки (без профиля)

### spring.application
- `name: crm-admin`

### spring.datasource (переменные окружения)
| Свойство | Env-переменная | Значение по умолчанию |
|---|---|---|
| `url` | `DB_URL` | `jdbc:postgresql://localhost:5432/crm` |
| `username` | `DB_USER` | `crm` |
| `password` | `DB_PASSWORD` | `crm` |

Значения по умолчанию заданы синтаксисом `${VAR:default}` — переопределяются переменными окружения без правки кода.

### spring.jpa
- `open-in-view: false`
- `hibernate.ddl-auto: none` — схемой управляет Flyway, не Hibernate
- `properties.hibernate.jdbc.time_zone: Europe/Moscow`

### spring.flyway
- `enabled: true`
- `schemas: notice, callcenter, retention, arch, app`
- `default-schema: app`
- `create-schemas: true`

### server
- `port: 8080`
- `forward-headers-strategy: framework` (за реверс-прокси)
- `error.include-message: always`, `error.include-binding-errors: always` — сообщения ошибок и ошибки валидации отдаются в ответе

### springdoc
- `swagger-ui.path: /swagger-ui.html`

### app.* (прикладные настройки)
- **`app.admin`** — первый супер-админ, создаётся идемпотентно при старте:
  - `email` ← `ADMIN_EMAIL` (по умолчанию `admin@banki.ru`)
  - `password` ← `ADMIN_PASSWORD` (по умолчанию `admin12345`)
- **`app.email-domain`** ← `APP_EMAIL_DOMAIN` (по умолчанию пусто) — ограничение домена email при входе/регистрации; пусто = без ограничения
- **`app.audit.enabled: true`** — писать `app.current_user` перед мутациями (аудит-триггер на `arch.arch_log`)
- **`app.tables.*`** — физическое расположение таблиц, переопределяемое по окружению без правки кода:
  | Ключ | Таблица |
  |---|---|
  | `push` | `notice.push_template` |
  | `email` | `notice.email_template` |
  | `sms` | `notice.d_com_sms_template` |
  | `cc` | `callcenter.d_segment_properties` |

### logging
- `level.org.flywaydb: info`

## Профиль `docker` (локальная разработка / демо)

Активируется `spring.config.activate.on-profile: docker`. Bundled БД для local/dev + demo: Flyway строит prod-идентичную схему и наполняет демо-данными.
- `spring.flyway.locations: classpath:db/migration, classpath:db/seed` — помимо миграций подключается сид демо-данных

## Профиль `prod` (продакшн)

Активируется `spring.config.activate.on-profile: prod`. Подключение к существующему корпоративному PostgreSQL, где таблицы уже есть.
- `spring.flyway.enabled: false` — миграции схемы **выключены**
- `app.audit.enabled: true`

## Что различается между профилями

| Аспект | `docker` | `prod` |
|---|---|---|
| Flyway | включён, `locations = migration + seed` | **выключен** (`enabled: false`) |
| Схема БД | строится и сидируется Flyway | уже существует в корпоративном PG |
| Демо-данные | да (`db/seed`) | нет |
| Datasource | из env/`localhost` по умолчанию | из env (`DB_URL`/`DB_USER`/`DB_PASSWORD`) |
| Аудит | наследует базовый `true` | явно `true` |

Datasource, `app.tables.*`, `app.admin.*` и `app.email-domain` берутся из базового документа и переопределяются переменными окружения в обоих профилях.

## Связанные заметки
[[SecurityConfig]] · [[RBAC]] · [[REST API]]

## Источник
- `src/main/resources/application.yml`
