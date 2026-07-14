---
tags: [security, config, spring-security, authorization]
---

# SecurityConfig

Центральная конфигурация Spring Security. Настраивает form-login для SPA на session-cookie, BCrypt, матрицу авторизации URL и обработку 401.

- Аннотации: `@Configuration`, `@EnableMethodSecurity` (включает поддержку `@PreAuthorize` в контроллерах, например в [[TemplateController]])

## Поля

- `PUBLIC` (`String[]`) — публичные пути без аутентификации:
  `/login.html`, `/api/login`, `/logout`, `/favicon.ico`, `/error`

## Бины

### PasswordEncoder passwordEncoder()
Возвращает `new BCryptPasswordEncoder()`. Все пароли хранятся и сравниваются как BCrypt-хеши (`AppUser.passwordHash`).

### SecurityFilterChain filterChain(HttpSecurity http)
Собирает цепочку фильтров.

**Матрица авторизации URL** (`authorizeHttpRequests`):

| Правило | Требование |
|---|---|
| `requestMatchers(PUBLIC)` | `permitAll()` |
| `/api/admin/**` | `hasRole("ADMIN")` |
| `anyRequest()` | `authenticated()` |

Порядок правил важен: `/api/admin/**` проверяется до общего `anyRequest()`. Это единственная точка, где `ADMIN` навязывается для всего [[AdminUserController]] (в его методах нет `@PreAuthorize`).

**CSRF:** `csrf.disable()` — отключён. В коде помечено как временное для внутреннего инструмента за аутентификацией; при внешней экспозиции предлагается вернуть `CookieCsrfTokenRepository` + заголовок с токеном в `api.js`.

**Form-login** (`formLogin`):
- `loginPage("/login.html")`
- `loginProcessingUrl("/api/login")` — сюда POST-ится форма входа
- `usernameParameter("email")`, `passwordParameter("password")`
- `successHandler` → статус `200 OK` (без редиректа, для XHR)
- `failureHandler` → `sendError(401)`
- `permitAll()`

**Logout** (`logout`):
- `logoutUrl("/logout")`
- `logoutSuccessHandler` → статус `200 OK`

**Session:** используется дефолтная сессия Spring Security (session-cookie SPA) — специальной `sessionManagement`-настройки нет, действуют значения по умолчанию (сессия создаётся при необходимости).

**Точка входа 401** (`exceptionHandling`):
`defaultAuthenticationEntryPointFor(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED), ...)` для запросов, чей `requestURI` начинается с `/api/`. То есть неаутентифицированный XHR к `/api/**` получает чистый `401`, а браузерные навигации проваливаются к странице логина.

## Как это связано
- Роли (`ROLE_ADMIN` и т.п.) выдаёт [[AppUserPrincipal]] на основе [[AppUser]] и [[Role]].
- Пользователь загружается через [[CustomUserDetailsService]] по email.
- Пер-секционный ACL поверх ролей проверяет [[AccessGuard]] внутри контроллеров.

## Связанные заметки
[[AppUserPrincipal]] · [[CustomUserDetailsService]] · [[AccessGuard]] · [[CurrentUser]] · [[RBAC]] · [[REST API]]

## Источник
- `src/main/java/ru/banki/crm/security/SecurityConfig.java`
