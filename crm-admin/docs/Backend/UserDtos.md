---
tags: [backend, dto, security]
---

# UserDtos

Финальный класс-контейнер (`final`, приватный конструктор) с вложенными `record`-ами для админского управления пользователями и самостоятельной смены пароля. Используется в [[UserService]].

## Вложенные records

### `UserView`
Представление пользователя для ответа.
- `id : Long`
- `email : String`
- `displayName : String`
- `role : String`
- `enabled : boolean`
- `sections : Set<String>`

### `CreateUser`
Payload создания пользователя.
- `email : String` — `@NotBlank @Email`
- `displayName : String`
- `role : String` — `@NotBlank`
- `password : String` — `@NotBlank @Size(min = 8, message = "Пароль минимум 8 символов")`
- `sections : Set<String>`

### `UpdateUser`
Payload обновления (все поля опциональны; `null` = не менять).
- `displayName : String`
- `role : String`
- `enabled : Boolean`
- `sections : Set<String>`

### `ResetPassword`
Сброс пароля админом.
- `newPassword : String` — `@NotBlank @Size(min = 8, ...)`

### `ChangeOwnPassword`
Смена собственного пароля.
- `currentPassword : String` — `@NotBlank`
- `newPassword : String` — `@NotBlank @Size(min = 8, ...)`

## Связи

- Обрабатываются в [[UserService]] (`create`, `update`, `resetPassword`, `changeOwnPassword`).
- Сущность: [[AppUser]]; роли: [[Role]]; разделы: [[Sections]].

## Источник

`src/main/java/ru/banki/crm/dto/UserDtos.java`
