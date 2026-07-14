---
tags: [backend, domain, entity]
---

# SmsTemplate

JPA-сущность SMS-канала. Наследует общие поля от [[TemplateBase]]. Маппится на таблицу `notice.d_com_sms_template` — см. [[d_com_sms_template (таблица)]].

Аннотации: `@Entity`, `@Table(name = "d_com_sms_template", schema = "notice")`, `@Getter`, `@Setter`.

## Поля

- `id : Integer` — `@Id`, `@GeneratedValue(strategy = SEQUENCE, generator = "sms_seq")`, `@SequenceGenerator(name = "sms_seq", sequenceName = "notice.d_com_sms_template_id_seq", allocationSize = 1)`. Обратите внимание: тип PK — `Integer` (в отличие от `Long` у push/email).
- `code : Integer` — колонка `code`. Бизнес-код, `MAX(code)+1` при вставке, по правилу v2 держится `< 10000` (см. [[SmsTemplateRepository]] `maxCode()`).
- `brief : String` — колонка `brief`.
- `name : String` — колонка `name`.
- `msgText : String` — колонка `msg_text`.
- `source : String` — колонка `source`.
- `abGroup : String` — колонка `ab_group`.
- `senderName : String` — колонка `sender_name`.
- `nightSend : Boolean` — колонка `night_send`, default `false`.
- `antispamCheck : Boolean` — колонка `antispam_check`, default `false`.

## Методы

- `String channel()` — возвращает `"sms"`.
- `String businessCode()` — `code == null ? null : String.valueOf(code)`.

## Связи

- Базовый класс: [[TemplateBase]].
- Репозиторий: [[SmsTemplateRepository]].
- Таблица БД: [[d_com_sms_template (таблица)]].
- Маппинг DTO: [[TemplateMapper]], [[TemplateDto]].

## Источник

`src/main/java/ru/banki/crm/domain/SmsTemplate.java`
