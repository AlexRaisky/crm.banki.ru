---
tags: [backend, dto]
---

# ChainRequest

DTO «Цепочка»: создать N шаблонов, которые разделяют одну базу, но отличаются днём отправки. Заменяет клиентский цикл отдельных INSERT-ов из v2 на один batch/транзакцию. Аннотация `@Data` (Lombok).

## Поля

- `base : TemplateDto` — базовый шаблон (см. [[TemplateDto]]).
- `days : List<String>` — список дней отправки; для каждого создаётся копия `base` с проставленным `sendingDay`.

## Связи

- Обрабатывается в [[TemplateService]] `createChain(...)` (клонирует `base` по каждому дню через `cloneWithDay`).
- Содержит [[TemplateDto]].

## Источник

`src/main/java/ru/banki/crm/dto/ChainRequest.java`
