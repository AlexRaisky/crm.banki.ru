---
tags: [backend, controller, rest, auth, identity]
---

# AuthController

REST-контроллер идентичности текущего пользователя: отдаёт «кто я» (для построения NAV и скрытия кнопок редактирования на фронте) и смену собственного пароля.

- Базовый путь: `@RequestMapping("/api")`
- Аннотация класса: `@RestController`
- Зависимость: [[UserService]] `userService`

Авторизация: специальных `@PreAuthorize` нет — работает общее правило [[SecurityConfig]] `anyRequest().authenticated()`. Внутри `me()` принципал берётся из [[CurrentUser]]; при отсутствии — `401 UNAUTHORIZED` («Не авторизован»).

Обратите внимание: сам вход/выход (`/api/login`, `/logout`) обрабатывается не этим контроллером, а form-login цепочкой из [[SecurityConfig]].

## Эндпоинты

### GET /api/me
Идентичность + возможности, на основе которых фронт строит навигацию и прячет элементы редактирования.

- Метод/путь: `GET /api/me`
- Параметры: нет
- Авторизация: аутентифицированный (иначе `401`)
- Логика: `AppUserPrincipal p = CurrentUser.principal().orElseThrow(...)`; вычисляет `canEdit = role == EDITOR || ADMIN`, `isAdmin = role == ADMIN`
- Ответ: `MeDto(email, displayName, role, canEdit, isAdmin, sections)` — где `role` строка `READER|EDITOR|ADMIN`, `sections` — `Set<String>` доступных секций
- Роль сервиса: напрямую сервис не вызывается, данные берутся из [[AppUserPrincipal]] / [[AppUser]]

### PUT /api/me/password
Смена собственного пароля.

- Метод/путь: `PUT /api/me/password`
- Тело: `@Valid @RequestBody ChangeOwnPassword(currentPassword, newPassword)` — `newPassword` минимум 8 символов
- Авторизация: аутентифицированный
- Сервис: `userService.changeOwnPassword(CurrentUser.email(), req.currentPassword(), req.newPassword())`
- Ответ: `void` (200 OK без тела)

## Связанные заметки
[[UserService]] · [[CurrentUser]] · [[AppUserPrincipal]] · [[SecurityConfig]] · [[REST API]] · [[RBAC]]

## Источник
- `src/main/java/ru/banki/crm/web/AuthController.java`
- `src/main/java/ru/banki/crm/dto/MeDto.java`
- `src/main/java/ru/banki/crm/dto/UserDtos.java`
