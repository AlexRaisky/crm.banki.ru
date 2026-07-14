---
tags: [backend, dto, security]
---

# MeDto

Java `record` — идентичность + возможности текущего пользователя, которые фронтенд использует для построения NAV и скрытия элементов редактирования.

## Поля

- `email : String`
- `displayName : String`
- `role : String` — `READER | EDITOR | ADMIN` (см. [[Role]]).
- `canEdit : boolean` — `true` для EDITOR или ADMIN.
- `isAdmin : boolean` — `true` для ADMIN.
- `sections : Set<String>` — разрешённые разделы (см. [[Sections]]).

## Связи

- Отражает [[AppUser]] и [[Role]]; список разделов — [[Sections]].
- Возвращается endpoint-ом текущего пользователя (auth-слой).

## Источник

`src/main/java/ru/banki/crm/dto/MeDto.java`
