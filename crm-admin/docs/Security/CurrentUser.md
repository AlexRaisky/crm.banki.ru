---
tags: [security, helper, context]
---

# CurrentUser

Утилитный финальный класс с удобными аксессорами для аутентифицированного принципала. Инкапсулирует работу с `SecurityContextHolder`.

- `public final class CurrentUser` с приватным конструктором (не инстанцируется)

## Методы

### static Optional<AppUserPrincipal> principal()
- Берёт `Authentication a = SecurityContextHolder.getContext().getAuthentication()`
- Если `a != null` и `a.getPrincipal() instanceof AppUserPrincipal p` → `Optional.of(p)`
- Иначе → `Optional.empty()`

### static String email()
- `principal().map(AppUserPrincipal::email).orElse("system")`
- Фолбэк `"system"` используется, когда контекст без нашего принципала (например, фоновые/аудитные операции)

## Использование
- [[AuthController]].`me()` — `CurrentUser.principal().orElseThrow(...401)`
- [[AuthController]].`changePassword()` — `CurrentUser.email()`
- [[AccessGuard]].`requireAnySection()` — `CurrentUser.principal().orElseThrow(...401)`

## Связанные заметки
[[AppUserPrincipal]] · [[AccessGuard]] · [[AuthController]] · [[SecurityConfig]]

## Источник
- `src/main/java/ru/banki/crm/security/CurrentUser.java`
