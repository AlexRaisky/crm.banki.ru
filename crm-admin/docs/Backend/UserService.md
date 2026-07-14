---
tags: [backend, service, security]
---

# UserService

`@Service`. Управление пользователями админ-панели: список, создание, обновление, удаление, сброс и смена пароля. Работает с [[AppUserRepository]] и `PasswordEncoder` (BCrypt).

## Зависимости

- `users : AppUserRepository` — [[AppUserRepository]].
- `encoder : PasswordEncoder`.
- `emailDomain : String` — из `@Value("${app.email-domain:}")`; если задан, разрешаются только адреса в этом домене.

## Методы

- `List<UserView> list()` — `@Transactional(readOnly = true)`. Все пользователи → `toView`.
- `UserView create(CreateUser req)` — `@Transactional`. Нормализует email (trim+lowercase), `validateDomain`, проверка на дубликат (`409 "Пользователь уже существует"`), создаёт [[AppUser]] с BCrypt-хешем пароля, ролью (`parseRole`), валидными разделами (`validSections`), `enabled=true`. Возвращает `UserView`.
- `UserView update(Long id, UpdateUser req)` — `@Transactional`. Точечно обновляет только не-null поля (`displayName`, `role`, `enabled`, `sections`).
- `void delete(Long id)` — `@Transactional`. Запрещает удаление последнего ADMIN (`409 "Нельзя удалить последнего администратора"`, проверка через `countAdmins() <= 1`).
- `void resetPassword(Long id, String newPassword)` — `@Transactional`. Админский сброс пароля (BCrypt-перекодирование).
- `void changeOwnPassword(String email, String current, String newPassword)` — `@Transactional`. Находит пользователя по email (`401` если нет), проверяет текущий пароль через `encoder.matches` (`400 "Текущий пароль неверен"`), сохраняет новый хеш.

## Приватные / статические помощники

- `AppUser get(Long id)` — `findById` или `404`.
- `long countAdmins()` — число пользователей с ролью `ADMIN`.
- `void validateDomain(String email)` — проверка домена, если `emailDomain` задан (иначе `400`).
- `static Role parseRole(String role)` — `Role.valueOf(upper)`; при ошибке `400 "Некорректная роль"`.
- `static Set<String> validSections(Set<String> sections)` — проверяет каждый раздел через [[Sections]] `isValid` (`400` при неизвестном).
- `static UserView toView(AppUser u)` — маппинг сущности в `UserView`.

## Связи

- [[AppUserRepository]], [[AppUser]], [[Role]], [[Sections]], [[UserDtos]] (`UserView`, `CreateUser`, `UpdateUser` и др.).

## Источник

`src/main/java/ru/banki/crm/service/UserService.java`
