---
tags: [database, table, notice, push]
---

# push_template (таблица)

Схема-квалифицированное имя: **`notice.push_template`**.

Таблица шаблонов **push-коммуникаций** (мобильные пуш-уведомления). Одна из четырёх «канальных» таблиц шаблонов; воспроизводит боевой DDL прод-схемы. JPA-сущность — [[PushTemplate]]. Физическое расположение задаётся в `application.yml` (`app.tables.push`), чтобы переключение dev→prod не требовало правок кода.

- **Первичный ключ:** `id` (bigint), значение по умолчанию из последовательности `notice.push_template_id_seq` (`OWNED BY` колонкой `id`).
- **Бизнес-код:** `code` (integer) — исторический идентификатор шаблона (в v2 генерировался как `MAX(code)+1`).
- **Массивы:** `product_type text[]` — список типов продуктов.
- **JSONB:** `action_buttons` (кнопки действия), также `jsonb` мог бы использоваться в спец-полях.
- **Аудит:** триггер `trg_audit_push` (AFTER INSERT/UPDATE/DELETE) вызывает `arch.log_change()` → пишет в [[arch.arch_log (таблица)]]. См. [[Схема БД]].

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| id | bigint | да (PK) | Суррогатный первичный ключ, DEFAULT `nextval('notice.push_template_id_seq')` |
| code | integer | нет | Бизнес-код шаблона |
| brief | varchar(100) | нет | Краткое описание/бриф |
| name | varchar(64) | нет | Техническое имя шаблона |
| title | varchar(60) | нет | Заголовок пуша |
| msg_text | text | нет | Текст сообщения |
| deep_link | varchar(255) | нет | Диплинк для перехода в приложении |
| product_type | text[] | да | Массив типов продуктов, DEFAULT `'{}'` |
| source | varchar(100) | нет | Источник кампании |
| communication_type | varchar(16) | да | Тип коммуникации, DEFAULT `''` |
| trigger_type | varchar(8) | да | Тип триггера, DEFAULT `''` |
| sending_day | smallint | да | День отправки, DEFAULT `0` |
| partner_name | varchar(100) | нет | Партнёр |
| ab_group | varchar(8) | нет | Группа A/B-теста |
| aff_sub3 | varchar(255) | нет | Метка партнёрской ссылки (aff_sub3) |
| webview_url | varchar(2048) | нет | URL для webview |
| source_type | varchar(128) | нет | Тип источника |
| active_flag | boolean | нет | Флаг активности, DEFAULT `true` |
| communication_name | varchar | да | Имя коммуникации (генерируется NamingService), DEFAULT `''` |
| touch_point | varchar | да | Точка касания, DEFAULT `''` |
| business_communication_type | varchar(16) | нет | Бизнес-тип коммуникации |
| night_send | boolean | да | Разрешена ночная отправка, DEFAULT `false` |
| selection_wizard_service | varchar(16) | нет | Сервис мастера подбора |
| national_rating | boolean | да | Признак «Народный рейтинг», DEFAULT `false` |
| marketplace | boolean | да | Признак маркетплейса, DEFAULT `false` |
| mobile_app | boolean | да | Признак мобильного приложения, DEFAULT `false` |
| loyalty | boolean | да | Признак программы лояльности, DEFAULT `false` |
| dialog | boolean | да | Признак диалога, DEFAULT `false` |
| news | boolean | да | Признак новостей, DEFAULT `false` |
| img_ios | varchar(255) | нет | Изображение для iOS |
| img_android | varchar(255) | нет | Изображение для Android |
| action_buttons | jsonb | нет | Кнопки действия (JSON) |
| permanent_exclude | boolean | нет | Постоянное исключение |
| time_to_live | integer | нет | Время жизни сообщения (TTL) |

## Источник

- `src/main/resources/db/migration/V1__template_schema.sql`
- `src/main/resources/db/seed/V900__seed_dev.sql`
- `src/main/resources/application.yml` (`app.tables.push`)
