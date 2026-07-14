---
tags: [backend, domain, entity]
---

# EmailTemplate

JPA-сущность e-mail-канала. Наследует общие поля от [[TemplateBase]]. Маппится на таблицу `notice.email_template` — см. [[email_template (таблица)]]. Особенность: у email первичный ключ `id` И ЕСТЬ бизнес-код, показываемый в списке.

Аннотации: `@Entity`, `@Table(name = "email_template", schema = "notice")`, `@Getter`, `@Setter`.

## Поля

- `id : Long` — `@Id`, `@GeneratedValue(strategy = SEQUENCE, generator = "email_seq")`, `@SequenceGenerator(name = "email_seq", sequenceName = "notice.email_template_id_seq", allocationSize = 1)`.
- `triggerCode : Integer` — колонка `trigger_code`.
- `letterosId : Long` — колонка `letteros_id` (bigint).
- `subject : String` — колонка `subject`, default `""`.
- `emailFrom : String` — колонка `email_from`, default `""`.
- `source : String` — колонка `source`.
- `abGroup : String` — колонка `ab_group`.
- `service : Boolean` — колонка `is_service`, default `false`. Поле названо `service` (без префикса `is`), чтобы избежать особой обработки boolean-аксессоров в Lombok.
- `info : Boolean` — колонка `is_info`, default `false`. Аналогично названо `info`.
- `msgText : String` — колонка `msg_text`.
- `preheader : String` — колонка `preheader`.
- `utmCustom : String` — колонка `utm_custom`.
- `mailText : String` — колонка `mail_text`.

## Методы

- `String channel()` — возвращает `"email"`.
- `String businessCode()` — `id == null ? null : String.valueOf(id)` (для email код = PK).

## Связи

- Базовый класс: [[TemplateBase]].
- Репозиторий: [[EmailTemplateRepository]].
- Таблица БД: [[email_template (таблица)]].
- Маппинг DTO: [[TemplateMapper]], [[TemplateDto]].

## Источник

`src/main/java/ru/banki/crm/domain/EmailTemplate.java`
