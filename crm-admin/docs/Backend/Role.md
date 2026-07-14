---
tags: [backend, domain, enum, security]
---

# Role

Enum уровня прав пользователя. Видимость разделов ортогональна и задаётся отдельно per-user (см. `AppUser.getSections()` и [[Sections]]).

## Значения

- `READER` — только чтение назначенных разделов.
- `EDITOR` — READER + создание/редактирование/удаление шаблонов.
- `ADMIN` — EDITOR + управление пользователями, назначение ролей и разделов.

## Связи

- Используется в [[AppUser]] (`@Enumerated(EnumType.STRING)`).
- Парсится/проверяется в [[UserService]] (`parseRole`, защита от удаления последнего ADMIN).
- Маппится в capability-флаги `canEdit` / `isAdmin` в [[MeDto]].

## Источник

`src/main/java/ru/banki/crm/domain/Role.java`
