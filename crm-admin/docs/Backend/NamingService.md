---
tags: [backend, service]
---

# NamingService

`@Service`. Правила именования коммуникаций, портированные из v2 (`CommunicationNameJS`) / v1 `saveTemplate`. Сейчас реализовано суффиксирование A/B-вариантов (`-a`, `-b`, …). Полный генератор communication_name на основе префиксов — задача на будущее; v1 уже собирает communication_name на клиенте и присылает как есть.

## Поля

- `static final String LETTERS = "abcdefghijklmnopqrstuvwxyz"` — алфавит суффиксов.

## Методы

- `List<String> abVariants(String base, int count)` — из базы `"foo"` и count `3` → `["foo-a","foo-b","foo-c"]`. Пустая база заменяется на `"NoComName"`; существующий хвост `-x` сначала срезается (`replaceAll("-[a-zA-Z]$", "")`). Количество зажимается в диапазон `[2, 26]` (`Math.max(2, Math.min(count, 26))`).

## Связи

- Данные communication_name живут в [[TemplateBase]] / [[TemplateDto]].

## Источник

`src/main/java/ru/banki/crm/service/NamingService.java`
