---
tags: [backend, repo]
---

# CcSegmentRepository

Spring Data JPA-репозиторий для [[CcSegment]]. `extends JpaRepository<CcSegment, Long>`.

## Методы запросов

- `Optional<CcSegment> findFirstBySegment(Integer segment)` — производный запрос: найти первый CC-сегмент по бизнес-номеру `segment`.
- `List<String> distinctPartnerNames()` — `@Query("select distinct c.partnerName from CcSegment c where c.partnerName is not null and c.partnerName <> ''")` — уникальные непустые названия партнёров.
- `List<String> distinctCommunicationNames()` — `@Query("select distinct c.communicationName from CcSegment c where c.communicationName is not null and c.communicationName <> ''")` — уникальные непустые communication_name.

У CC нет `maxCode()`: номер сегмента задаёт пользователь, а PK `id` генерируется последовательностью.

## Связи

- Сущность: [[CcSegment]].
- Используется в [[TemplateService]] и [[DictionaryService]] (`ccSegments()`).

## Источник

`src/main/java/ru/banki/crm/repo/CcSegmentRepository.java`
