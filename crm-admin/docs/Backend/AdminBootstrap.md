---
tags: [backend, config, security]
---

# AdminBootstrap

`@Component`, реализует `CommandLineRunner`. Создаёт первого супер-админа из переменных окружения при старте приложения (идемпотентно).

## Зависимости

- `users : AppUserRepository` — [[AppUserRepository]].
- `encoder : PasswordEncoder`.
- `adminEmail : String` — `@Value("${app.admin.email:}")` (trim + lowercase).
- `adminPassword : String` — `@Value("${app.admin.password:}")`.

## Методы

- `void run(String... args)` — при пустых email/password логирует warning и пропускает bootstrap. Если пользователь с таким email уже есть — логирует info и выходит. Иначе создаёт [[AppUser]] с ролью `ADMIN` ([[Role]]), BCrypt-хешем пароля, `displayName = "Администратор"`, `enabled = true` и всеми разделами ([[Sections]] `ALL`), сохраняет.

## Связи

- [[AppUserRepository]], [[AppUser]], [[Role]], [[Sections]].
- Конфигурация: `app.admin.email`, `app.admin.password`.

## Источник

`src/main/java/ru/banki/crm/config/AdminBootstrap.java`
