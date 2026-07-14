---
tags: [security, principal, userdetails]
---

# AppUserPrincipal

Реализация `UserDetails` из Spring Security, оборачивающая доменную сущность [[AppUser]]. Несёт роль (capability) и пер-секционный ACL. Именно этот объект лежит в `SecurityContext` как principal и достаётся через [[CurrentUser]].

- `implements UserDetails`
- Поле: `private final AppUser user`

## Методы

| Метод | Возвращает | Поведение |
|---|---|---|
| `user()` | `AppUser` | обёрнутая сущность |
| `email()` | `String` | `user.getEmail()` |
| `sections()` | `Set<String>` | `user.getSections()` — секции ACL |
| `getAuthorities()` | `Collection<? extends GrantedAuthority>` | `List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()))` — одна authority вида `ROLE_READER` / `ROLE_EDITOR` / `ROLE_ADMIN` |
| `getPassword()` | `String` | `user.getPasswordHash()` (BCrypt) |
| `getUsername()` | `String` | `user.getEmail()` |
| `isAccountNonExpired()` | `boolean` | всегда `true` |
| `isAccountNonLocked()` | `boolean` | всегда `true` |
| `isCredentialsNonExpired()` | `boolean` | всегда `true` |
| `isEnabled()` | `boolean` | `user.isEnabled()` — отключённый пользователь не проходит аутентификацию |

Важно: у пользователя ровно одна authority — префиксированная роль. Именно на неё опираются `hasRole("ADMIN")` в [[SecurityConfig]] и `hasAnyRole('EDITOR','ADMIN')` в [[TemplateController]]. Секционный ACL (`sections`) — это отдельное измерение, проверяемое [[AccessGuard]], а не через authorities.

## Связанные заметки
[[AppUser]] · [[Role]] · [[CurrentUser]] · [[CustomUserDetailsService]] · [[AccessGuard]] · [[SecurityConfig]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/security/AppUserPrincipal.java`
- `src/main/java/ru/banki/crm/domain/AppUser.java`
