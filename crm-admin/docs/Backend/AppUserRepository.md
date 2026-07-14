---
tags: [backend, repo]
---

# AppUserRepository

Spring Data JPA-репозиторий для [[AppUser]]. `extends JpaRepository<AppUser, Long>`.

## Методы запросов

- `Optional<AppUser> findByEmailIgnoreCase(String email)` — производный (derived) запрос: поиск пользователя по email без учёта регистра.
- `boolean existsByEmailIgnoreCase(String email)` — проверка существования пользователя с данным email без учёта регистра.

Плюс стандартные методы `JpaRepository` (`findAll`, `findById`, `save`, `delete` и т. д.).

## Связи

- Сущность: [[AppUser]].
- Используется в [[UserService]], [[AdminBootstrap]] и security-слое (аутентификация).

## Источник

`src/main/java/ru/banki/crm/repo/AppUserRepository.java`
