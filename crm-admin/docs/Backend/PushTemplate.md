---
tags: [backend, domain, entity]
---

# PushTemplate

JPA-сущность канала push-уведомлений. Наследует общие поля от [[TemplateBase]]. Маппится на таблицу `notice.push_template` — см. [[push_template (таблица)]].

Аннотации: `@Entity`, `@Table(name = "push_template", schema = "notice")`, `@Getter`, `@Setter`.

## Поля

- `id : Long` — `@Id`, `@GeneratedValue(strategy = SEQUENCE, generator = "push_seq")`, `@SequenceGenerator(name = "push_seq", sequenceName = "notice.push_template_id_seq", allocationSize = 1)`.
- `code : Integer` — колонка `code`. Бизнес-код, при вставке вычисляется как `MAX(code)+1` (см. [[PushTemplateRepository]] `maxCode()`).
- `brief : String` — колонка `brief`.
- `name : String` — колонка `name`.
- `title : String` — колонка `title`.
- `msgText : String` — колонка `msg_text`.
- `deepLink : String` — колонка `deep_link`.
- `source : String` — колонка `source` (отсутствует в [[TemplateBase]], объявлено здесь).
- `abGroup : String` — колонка `ab_group`.
- `webviewUrl : String` — колонка `webview_url`.
- `nightSend : Boolean` — колонка `night_send`, default `false`.

## Методы

- `String channel()` — возвращает `"push"`.
- `String businessCode()` — `code == null ? null : String.valueOf(code)`.

## Связи

- Базовый класс: [[TemplateBase]].
- Репозиторий: [[PushTemplateRepository]].
- Таблица БД: [[push_template (таблица)]].
- Маппинг DTO: [[TemplateMapper]], [[TemplateDto]].

## Источник

`src/main/java/ru/banki/crm/domain/PushTemplate.java`
