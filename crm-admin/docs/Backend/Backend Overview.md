---
tags: [backend, moc, overview]
---

# Backend Overview

Индекс (MOC) backend-слоя админ-панели CRM (`ru.banki.crm`). Приложение на Java/Spring заменяет самописную панель на Appsmith: единый CRUD над четырьмя каналами коммуникаций (push / email / sms / call-center) поверх схем БД `notice`, `callcenter`, `app`.

## Точка входа

- [[CrmAdminApplication]] — `@SpringBootApplication`.

## domain/ (JPA-сущности)

- [[TemplateBase]] — `@MappedSuperclass`, общие колонки всех каналов.
- [[PushTemplate]] → [[push_template (таблица)]]
- [[EmailTemplate]] → [[email_template (таблица)]]
- [[SmsTemplate]] → [[d_com_sms_template (таблица)]]
- [[CcSegment]] → [[d_segment_properties (таблица)]]
- [[AppUser]] — пользователь (`app.users`).
- [[Role]] — enum ролей (READER / EDITOR / ADMIN).

## repo/ (Spring Data JPA)

- [[PushTemplateRepository]], [[EmailTemplateRepository]], [[SmsTemplateRepository]], [[CcSegmentRepository]], [[AppUserRepository]].

## dto/

- [[TemplateDto]] — единый payload create/read/update.
- [[TemplateListItemDto]] — строка объединённого списка.
- [[ChainRequest]] — batch-создание «цепочки» по дням.
- [[MeDto]] — идентичность/возможности текущего пользователя.
- [[UserDtos]] — payloads управления пользователями.

## service/

- [[TemplateService]] — CRUD-диспетчер по каналам.
- [[TemplateMapper]] — маппинг DTO ↔ сущности.
- [[DictionaryService]] — справочники (партнёры, сегменты, communication_name).
- [[NamingService]] — суффиксы A/B-вариантов.
- [[UserService]] — управление пользователями.
- [[AuditContext]] — проброс актора в GUC `app.current_user` для аудита.
- [[Sections]] — канонические id разделов NAV.

## config/

- [[AdminBootstrap]] — создание первого супер-админа при старте.

## Поток create/update запроса

Запрос приходит в web-контроллер (`TemplateController`, вне этого scope) с телом [[TemplateDto]]. Контроллер вызывает [[TemplateService]] `create` / `update`. Сервис в рамках `@Transactional` сначала вызывает [[AuditContext]] `mark()` (устанавливает `app.current_user` для аудит-триггера БД), затем по строке `channel` выбирает нужную сущность ([[PushTemplate]] / [[EmailTemplate]] / [[SmsTemplate]] / [[CcSegment]]). Перенос полей DTO на сущность делает [[TemplateMapper]] `apply` (только не-null поля). При create для push/sms код вычисляется как `maxCode()+1` из соответствующего репозитория, для email — генерируется последовательностью PK, для cc — берётся из тела как номер сегмента. Сущность сохраняется через канальный репозиторий (для update — managed-сущность сбрасывается на commit транзакции). Обратное чтение (`get`, `list`) идёт через [[TemplateMapper]] `toDto` / `toListItem` в [[TemplateDto]] / [[TemplateListItemDto]].

## Источник

`src/main/java/ru/banki/crm/` (пакеты `domain`, `repo`, `dto`, `service`, `config`, `CrmAdminApplication.java`)
