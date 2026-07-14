---
tags: [database, table, notice, sms]
---

# d_com_sms_template (таблица)

Схема-квалифицированное имя: **`notice.d_com_sms_template`**.

Таблица шаблонов **SMS-коммуникаций**. Одна из четырёх «канальных» таблиц шаблонов; воспроизводит боевой DDL прод-схемы. JPA-сущность — [[SmsTemplate]]. Физическое расположение задаётся в `application.yml` (`app.tables.sms`).

- **Первичный ключ:** `id` (integer, а не bigint), DEFAULT из последовательности `notice.d_com_sms_template_id_seq` (`OWNED BY` колонкой `id`).
- **Бизнес-код:** `code` (integer).
- **Массивы:** `product_type text[]` и `required_attrs text[]` (обязательные атрибуты).
- **JSONB:** `default_attrs` — атрибуты по умолчанию.
- **Специфика SMS:** `sender_name`, `antispam_check`, `attribute_values`.
- **Аудит:** триггер `trg_audit_sms` → `arch.log_change()` → [[arch.arch_log (таблица)]]. См. [[Схема БД]].

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| id | integer | да (PK) | Суррогатный первичный ключ, DEFAULT `nextval('notice.d_com_sms_template_id_seq')` |
| code | integer | нет | Бизнес-код шаблона |
| brief | varchar(60) | нет | Краткое описание/бриф |
| name | varchar(60) | нет | Техническое имя шаблона |
| msg_text | text | нет | Текст сообщения |
| default_attrs | jsonb | нет | Атрибуты по умолчанию (JSON) |
| required_attrs | text[] | нет | Массив обязательных атрибутов |
| attribute_values | varchar | нет | Значения атрибутов |
| source_type | varchar(128) | да | Тип источника, DEFAULT `''` |
| product_type | text[] | да | Массив типов продуктов, DEFAULT `'{}'` |
| communication_type | varchar(16) | да | Тип коммуникации, DEFAULT `''` |
| source | varchar(100) | нет | Источник кампании |
| trigger_type | varchar(8) | да | Тип триггера, DEFAULT `''` |
| sending_day | smallint | да | День отправки, DEFAULT `0` |
| partner_name | varchar(100) | нет | Партнёр |
| ab_group | varchar(8) | нет | Группа A/B-теста |
| aff_sub3 | varchar(255) | да | Метка партнёрской ссылки (aff_sub3), DEFAULT `''` |
| active_flag | boolean | нет | Флаг активности, DEFAULT `true` |
| communication_name | varchar | да | Имя коммуникации, DEFAULT `''` |
| touch_point | varchar | да | Точка касания, DEFAULT `''` |
| permanent_exclude | boolean | нет | Постоянное исключение |
| business_communication_type | varchar(16) | да | Бизнес-тип коммуникации, DEFAULT `''` |
| night_send | boolean | да | Разрешена ночная отправка, DEFAULT `false` |
| selection_wizard_service | varchar(16) | нет | Сервис мастера подбора |
| national_rating | boolean | да | Признак «Народный рейтинг», DEFAULT `false` |
| marketplace | boolean | да | Признак маркетплейса, DEFAULT `false` |
| mobile_app | boolean | да | Признак мобильного приложения, DEFAULT `false` |
| loyalty | boolean | да | Признак программы лояльности, DEFAULT `false` |
| dialog | boolean | да | Признак диалога, DEFAULT `false` |
| news | boolean | да | Признак новостей, DEFAULT `false` |
| sender_name | varchar(30) | нет | Имя отправителя (альфа-имя) |
| antispam_check | boolean | да | Проверка антиспама, DEFAULT `false` |

## Источник

- `src/main/resources/db/migration/V1__template_schema.sql`
- `src/main/resources/db/seed/V900__seed_dev.sql`
- `src/main/resources/application.yml` (`app.tables.sms`)
