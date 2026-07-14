---
tags: [backend, repo]
---

# PushTemplateRepository

Spring Data JPA-репозиторий для [[PushTemplate]]. `extends JpaRepository<PushTemplate, Long>`.

## Методы запросов

- `Optional<PushTemplate> findFirstByCode(Integer code)` — производный запрос: найти первый push-шаблон по бизнес-коду `code`.
- `int maxCode()` — `@Query("select coalesce(max(p.code), 0) from PushTemplate p")` — максимальный `code` (0, если таблица пуста); используется для генерации следующего кода при вставке.
- `List<String> distinctPartnerNames()` — `@Query("select distinct p.partnerName from PushTemplate p where p.partnerName is not null and p.partnerName <> ''")` — уникальные непустые названия партнёров.
- `List<String> distinctCommunicationNames()` — `@Query("select distinct p.communicationName from PushTemplate p where p.communicationName is not null and p.communicationName <> ''")` — уникальные непустые communication_name.

## Связи

- Сущность: [[PushTemplate]].
- Используется в [[TemplateService]] (создание/список) и [[DictionaryService]] (справочники).

## Источник

`src/main/java/ru/banki/crm/repo/PushTemplateRepository.java`
