---
tags: [backend, controller, rest, admin, users, access]
---

# AdminUserController

REST-контроллер управления пользователями и доступом (только для ADMIN). Раздел «Управление доступом».

- Базовый путь: `@RequestMapping("/api/admin")`
- Аннотация класса: `@RestController`
- Зависимость: [[UserService]] `users`

Авторизация: **весь префикс `/api/admin/**` защищён на уровне [[SecurityConfig]] правилом `hasRole("ADMIN")`**. Поэтому отдельных `@PreAuthorize` в методах нет — доступ к любому эндпоинту имеет только `ADMIN`. См. [[RBAC]].

## Эндпоинты

### GET /api/admin/sections
Каталог секций для отрисовки чекбоксов в админ-UI.

- Метод/путь: `GET /api/admin/sections`
- Параметры: нет
- Авторизация: `ADMIN`
- Логика: возвращает `Sections.ALL`
- Ответ: `List<String>` (`home, deviations, onelink, admin, templates, dashboard, access`)

### GET /api/admin/users
- Метод/путь: `GET /api/admin/users`
- Авторизация: `ADMIN`
- Сервис: `users.list()`
- Ответ: `List<UserView>` (`id, email, displayName, role, enabled, sections`)

### POST /api/admin/users
- Метод/путь: `POST /api/admin/users`
- Тело: `@Valid @RequestBody CreateUser(email, displayName, role, password, sections)` — `email` валиден и не пуст, `role` не пуст, `password` минимум 8 символов
- Авторизация: `ADMIN`
- Сервис: `users.create(req)`
- Ответ: `UserView`

### PUT /api/admin/users/{id}
- Метод/путь: `PUT /api/admin/users/{id}`
- Path-переменная: `Long id`
- Тело: `@RequestBody UpdateUser(displayName, role, enabled, sections)` (частичное обновление)
- Авторизация: `ADMIN`
- Сервис: `users.update(id, req)`
- Ответ: `UserView`

### DELETE /api/admin/users/{id}
- Метод/путь: `DELETE /api/admin/users/{id}`
- Path-переменная: `Long id`
- Авторизация: `ADMIN`
- Сервис: `users.delete(id)`
- Ответ: `void` (200 OK без тела)

### PUT /api/admin/users/{id}/password
Сброс пароля пользователя администратором.

- Метод/путь: `PUT /api/admin/users/{id}/password`
- Path-переменная: `Long id`
- Тело: `@Valid @RequestBody ResetPassword(newPassword)` — минимум 8 символов
- Авторизация: `ADMIN`
- Сервис: `users.resetPassword(id, req.newPassword())`
- Ответ: `Map<String, String>` вида `{"status": "ok"}`

## Связанные заметки
[[UserService]] · [[SecurityConfig]] · [[REST API]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/web/AdminUserController.java`
- `src/main/java/ru/banki/crm/dto/UserDtos.java`
- `src/main/java/ru/banki/crm/service/Sections.java`
