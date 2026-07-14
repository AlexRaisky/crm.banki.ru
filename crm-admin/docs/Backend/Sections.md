---
tags: [backend, service, security]
---

# Sections

Финальный utility-класс (приватный конструктор) с каноническими id разделов. Должны совпадать с id NAV во фронтенде v1.

## Константы

- `HOME = "home"`
- `DEVIATIONS = "deviations"`
- `ONELINK = "onelink"`
- `ADMIN = "admin"` — Мастер коммуникаций
- `TEMPLATES = "templates"` — Список шаблонов
- `DASHBOARD = "dashboard"`
- `ACCESS = "access"` — Управление доступом (только ADMIN)
- `ALL : List<String>` — упорядоченный список всех семи id.
- `VALID : Set<String>` — `Set.copyOf(ALL)`.

## Методы

- `static boolean isValid(String id)` — содержится ли id в `VALID`.

## Связи

- Валидация разделов в [[UserService]] (`validSections`).
- Полный набор разделов проставляется супер-админу в [[AdminBootstrap]].
- Хранятся в [[AppUser]] `sections`; отдаются во фронт через [[MeDto]].

## Источник

`src/main/java/ru/banki/crm/service/Sections.java`
