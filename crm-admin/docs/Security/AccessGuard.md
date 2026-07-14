---
tags: [security, acl, authorization, sections]
---

# AccessGuard

Компонент проверки пер-секционного ACL. Реализует второй слой авторизации: **роль задаёт возможности (capability), секции задают видимость**. `ADMIN` минует любую секционную проверку.

- Аннотация: `@Component`
- Зависимостей в конструкторе нет; принципал берётся из [[CurrentUser]]

## Методы

### void requireAnySection(String... sectionIds)
Бросает `403 FORBIDDEN`, если текущий пользователь не `ADMIN` и не имеет ни одной из указанных секций.

Логика:
1. `AppUserPrincipal p = CurrentUser.principal().orElseThrow(...)` — иначе `401 UNAUTHORIZED` («Не авторизован»)
2. Если `p.user().getRole() == Role.ADMIN` → `return` (полный обход ACL)
3. Иначе перебор `sectionIds`: если `p.sections().contains(s)` для любого — `return`
4. Если ни одна не совпала — `throw ResponseStatusException(HttpStatus.FORBIDDEN, "Нет доступа к разделу")`

Семантика «anyOf»: достаточно одной из перечисленных секций.

## Где используется
Внутри [[TemplateController]] на всех эндпоинтах:
- `requireAnySection(Sections.TEMPLATES, Sections.ADMIN)` — на чтении (`list`, `get`)
- `requireAnySection(Sections.ADMIN, Sections.TEMPLATES)` — на мутациях (`create`, `createChain`, `update`, `delete`), поверх ролевого `@PreAuthorize("hasAnyRole('EDITOR','ADMIN')")`

Секции — константы из `Sections` (`home, deviations, onelink, admin, templates, dashboard, access`). Набор секций пользователя хранится в [[AppUser]].`sections`.

## Связанные заметки
[[CurrentUser]] · [[AppUserPrincipal]] · [[AppUser]] · [[Role]] · [[TemplateController]] · [[SecurityConfig]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/security/AccessGuard.java`
- `src/main/java/ru/banki/crm/service/Sections.java`
