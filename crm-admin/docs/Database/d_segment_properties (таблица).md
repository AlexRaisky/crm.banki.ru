---
tags: [database, table, callcenter, cc]
---

# d_segment_properties (таблица)

Схема-квалифицированное имя: **`callcenter.d_segment_properties`**.

Таблица свойств **сегментов колл-центра (КЦ)** — «канал» коммуникаций через оператора/обзвон. Одна из четырёх «канальных» таблиц шаблонов; воспроизводит боевой DDL прод-схемы. JPA-сущность — [[CcSegment]]. Физическое расположение задаётся в `application.yml` (`app.tables.cc`).

- **Первичный ключ:** `id` (bigint), DEFAULT из последовательности `callcenter.d_segment_properties_id_seq` (`OWNED BY` колонкой `id`).
- **Бизнес-номер:** `segment` (integer, NOT NULL) — отдельный бизнес-номер сегмента, который задаёт пользователь; приложение ищет шаблоны именно по нему (не по `id`).
- **Массивы:** `product_type text[]`.
- **Специфика КЦ:** `source_system`, `host_id`, ML-поля (`ml_check_probability`, `ml_probability_required`, `ml_check_probability_loyal`, `ml_probability_required_loyal`, `ml_probability_required_uplift`, `active_ml_probability_type`), `cutpercent`, `nocutpercent`, `kvint_campaign_id`, `placement`, `send_loyal_info`.
- **Аудит:** триггер `trg_audit_cc` → `arch.log_change()` → [[arch.arch_log (таблица)]]. См. [[Схема БД]].

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| id | bigint | да (PK) | Суррогатный первичный ключ, DEFAULT `nextval('callcenter.d_segment_properties_id_seq')` |
| source_system | varchar | да | Система-источник, DEFAULT `''` |
| segment | integer | да | Бизнес-номер сегмента (ключ поиска шаблона) |
| segment_descr | text | нет | Описание сегмента |
| active_flag | boolean | нет | Флаг активности, DEFAULT `true` |
| host_id | bigint | нет | Идентификатор хоста |
| ml_check_probability | boolean | нет | Проверять ML-вероятность |
| ml_probability_required | numeric | нет | Требуемая ML-вероятность |
| cutpercent | integer | нет | Процент отсечения |
| nocutpercent | integer | нет | Процент без отсечения |
| send_loyal_info | boolean | нет | Отправлять информацию по лояльности |
| product_type | text[] | да | Массив типов продуктов, DEFAULT `'{}'` |
| ml_check_probability_loyal | boolean | нет | Проверять ML-вероятность (лояльность) |
| ml_probability_required_loyal | numeric | нет | Требуемая ML-вероятность (лояльность) |
| trigger_type | varchar(8) | да | Тип триггера, DEFAULT `''` |
| sending_day | smallint | да | День отправки, DEFAULT `0` |
| ab_group | varchar(8) | нет | Группа A/B-теста |
| aff_sub3 | varchar(255) | да | Метка партнёрской ссылки (aff_sub3), DEFAULT `''` |
| communication_type | varchar(16) | да | Тип коммуникации, DEFAULT `''` |
| partner_name | varchar(100) | нет | Партнёр |
| communication_name | varchar(255) | да | Имя коммуникации, DEFAULT `''` |
| source_type | varchar(128) | да | Тип источника, DEFAULT `''` |
| placement | varchar(20) | нет | Размещение |
| touch_point | varchar | да | Точка касания, DEFAULT `''` |
| kvint_campaign_id | varchar(100) | нет | ID кампании в системе Kvint |
| ml_probability_required_uplift | numeric | нет | Требуемая ML-вероятность (uplift) |
| active_ml_probability_type | varchar(100) | нет | Активный тип ML-вероятности |
| business_communication_type | varchar(16) | да | Бизнес-тип коммуникации, DEFAULT `''` |
| selection_wizard_service | varchar(16) | нет | Сервис мастера подбора |
| national_rating | boolean | да | Признак «Народный рейтинг», DEFAULT `false` |
| marketplace | boolean | да | Признак маркетплейса, DEFAULT `false` |
| mobile_app | boolean | да | Признак мобильного приложения, DEFAULT `false` |
| loyalty | boolean | да | Признак программы лояльности, DEFAULT `false` |
| dialog | boolean | да | Признак диалога, DEFAULT `false` |
| news | boolean | да | Признак новостей, DEFAULT `false` |
| permanent_exclude | boolean | нет | Постоянное исключение |

## Источник

- `src/main/resources/db/migration/V1__template_schema.sql`
- `src/main/resources/db/seed/V900__seed_dev.sql`
- `src/main/resources/application.yml` (`app.tables.cc`)
