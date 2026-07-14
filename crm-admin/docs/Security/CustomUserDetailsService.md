---
tags: [security, userdetails, service]
---

# CustomUserDetailsService

Реализация `UserDetailsService`, которую Spring Security использует при аутентификации для загрузки пользователя по email.

- Аннотация: `@Service`
- `implements UserDetailsService`
- Зависимость: `AppUserRepository users`

## Методы

### UserDetails loadUserByUsername(String email)
- Ищет пользователя: `users.findByEmailIgnoreCase(email)` (регистронезависимо)
- При успехе оборачивает в [[AppUserPrincipal]] (`.map(AppUserPrincipal::new)`)
- Если не найден — бросает `UsernameNotFoundException("Пользователь не найден: " + email)`

Поскольку form-login в [[SecurityConfig]] задаёт `usernameParameter("email")`, «username» здесь — это email. Проверку пароля затем выполняет `DaoAuthenticationProvider` через `BCryptPasswordEncoder` (см. [[SecurityConfig]]) по `getPassword()` из принципала.

## Связанные заметки
[[AppUserPrincipal]] · [[AppUser]] · [[SecurityConfig]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/security/CustomUserDetailsService.java`
