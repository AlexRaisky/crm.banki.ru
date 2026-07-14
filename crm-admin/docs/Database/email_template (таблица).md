---
tags: [database, table, notice, email]
---

# email_template (таблица)

Схема-квалифицированное имя: **`notice.email_template`**.

Таблица шаблонов **email-коммуникаций**. Одна из четырёх «канальных» таблиц шаблонов; воспроизводит боевой DDL прод-схемы. JPA-сущность — [[EmailTemplate]]. Физическое расположение задаётся в `application.yml` (`app.tables.email`).

- **Первичный ключ:** `id` (bigint), DEFAULT из последовательности `notice.email_template_id_seq` (`OWNED BY` колонкой `id`).
- **Бизнес-код:** здесь это `trigger_code` (integer), а не `code`.
- **Массивы:** `product_type text[]`.
- **JSONB:** `links_info` — информация о ссылках письма.
- **Специфика email:** `subject`, `email_from`, `letteros_id`, `preheader`, `is_service`, `is_info`, `utm_custom`, `mail_text`.
- **Аудит:** триггер `trg_audit_email` → `arch.log_change()` → [[arch.arch_log (таблица)]]. См. [[Схема БД]].

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| id | bigint | да (PK) | Суррогатный первичный ключ, DEFAULT `nextval('notice.email_template_id_seq')` |
| trigger_code | integer | нет | Бизнес-код триггера письма |
| msg_text | text | нет | Текст сообщения |
| subject | text | да | Тема письма, DEFAULT `''` |
| email_from | varchar(64) | да | Адрес/имя отправителя, DEFAULT `''` |
| letteros_id | bigint | нет | ID шаблона в системе Letteros |
| is_service | boolean | да | Признак сервисного письма, DEFAULT `false` |
| preheader | varchar | нет | Прехедер письма |
| utm_custom | varchar | нет | Кастомные UTM-метки |
| source_type | varchar(128) | да | Тип источника, DEFAULT `''` |
| product_type | text[] | да | Массив типов продуктов, DEFAULT `'{}'` |
| source | varchar(100) | нет | Источник кампании |
| is_info | boolean | да | Признак информационного письма, DEFAULT `false` |
| trigger_type | varchar(8) | да | Тип триггера, DEFAULT `''` |
| sending_day | smallint | да | День отправки, DEFAULT `0` |
| partner_name | varchar(100) | нет | Партнёр |
| ab_group | varchar(8) | нет | Группа A/B-теста |
| aff_sub3 | varchar(255) | да | Метка партнёрской ссылки (aff_sub3), DEFAULT `''` |
| communication_name | varchar(255) | да | Имя коммуникации, DEFAULT `''` |
| active_flag | boolean | нет | Флаг активности, DEFAULT `true` |
| touch_point | varchar | да | Точка касания, DEFAULT `''` |
| communication_type | varchar(16) | да | Тип коммуникации, DEFAULT `''` |
| permanent_exclude | boolean | нет | Постоянное исключение |
| business_communication_type | varchar(16) | да | Бизнес-тип коммуникации, DEFAULT `''` |
| selection_wizard_service | varchar(16) | нет | Сервис мастера подбора |
| national_rating | boolean | да | Признак «Народный рейтинг», DEFAULT `false` |
| marketplace | boolean | нет | Признак маркетплейса |
| mobile_app | boolean | нет | Признак мобильного приложения |
| loyalty | boolean | нет | Признак программы лояльности |
| dialog | boolean | нет | Признак диалога |
| news | boolean | нет | Признак новостей |
| mail_text | varchar | нет | Дополнительный текст письма |
| links_info | jsonb | нет | Информация о ссылках письма (JSON) |

## Источник

- `src/main/resources/db/migration/V1__template_schema.sql`
- `src/main/resources/db/seed/V900__seed_dev.sql`
- `src/main/resources/application.yml` (`app.tables.email`)
