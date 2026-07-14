---
tags: [backend, service, audit]
---

# AuditContext

`@Component`. Воспроизводит вызов v2 `set_config('app.current_user', <email>, true)`, чтобы production-триггер аудита (`arch.arch_log`) записывал реального актора. Должен вызываться внутри той же транзакции, что и мутация, — чтобы GUC установился на том же соединении.

## Поля

- `em : EntityManager` — `@PersistenceContext`.
- `enabled : boolean` — `@Value("${app.audit.enabled:true}")`.

## Методы

- `void mark()` — если `enabled == false`, ничего не делает. Иначе выполняет нативный запрос `select set_config('app.current_user', :email, true)` с email текущего пользователя из `CurrentUser.email()` (security-слой).

## Связи

- Вызывается в [[TemplateService]] перед каждой мутацией (`create`, `update`, `delete`).
- Зависит от `ru.banki.crm.security.CurrentUser` (email актора).

## Источник

`src/main/java/ru/banki/crm/service/AuditContext.java`
