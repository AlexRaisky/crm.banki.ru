---
tags: [backend, repo]
---

# EmailTemplateRepository

Spring Data JPA-репозиторий для [[EmailTemplate]]. `extends JpaRepository<EmailTemplate, Long>`.

## Методы запросов

- `List<String> distinctPartnerNames()` — `@Query("select distinct e.partnerName from EmailTemplate e where e.partnerName is not null and e.partnerName <> ''")` — уникальные непустые названия партнёров.
- `List<String> distinctCommunicationNames()` — `@Query("select distinct e.communicationName from EmailTemplate e where e.communicationName is not null and e.communicationName <> ''")` — уникальные непустые communication_name.

Метод `maxCode()` здесь отсутствует: у email код совпадает с PK `id`, который генерируется последовательностью, поэтому вычислять `MAX(code)+1` не нужно. Поиск по коду в [[TemplateService]] выполняется через стандартный `findById`.

## Связи

- Сущность: [[EmailTemplate]].
- Используется в [[TemplateService]] и [[DictionaryService]].

## Источник

`src/main/java/ru/banki/crm/repo/EmailTemplateRepository.java`
