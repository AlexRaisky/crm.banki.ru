---
tags: [backend, repo]
---

# SmsTemplateRepository

Spring Data JPA-репозиторий для [[SmsTemplate]]. `extends JpaRepository<SmsTemplate, Integer>` (тип ключа — `Integer`).

## Методы запросов

- `Optional<SmsTemplate> findFirstByCode(Integer code)` — производный запрос: найти первый SMS-шаблон по бизнес-коду `code`.
- `int maxCode()` — `@Query("select coalesce(max(s.code), 0) from SmsTemplate s where s.code < 10000")` — максимальный `code` среди значений `< 10000` (правило v2: бизнес-коды SMS держатся ниже 10000).
- `List<String> distinctPartnerNames()` — `@Query("select distinct s.partnerName from SmsTemplate s where s.partnerName is not null and s.partnerName <> ''")` — уникальные непустые названия партнёров.
- `List<String> distinctCommunicationNames()` — `@Query("select distinct s.communicationName from SmsTemplate s where s.communicationName is not null and s.communicationName <> ''")` — уникальные непустые communication_name.

## Связи

- Сущность: [[SmsTemplate]].
- Используется в [[TemplateService]] и [[DictionaryService]].

## Источник

`src/main/java/ru/banki/crm/repo/SmsTemplateRepository.java`
