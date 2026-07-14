---
tags: [frontend, admin, rbac, javascript]
---

# admin-users.js

Раздел «Управление доступом» (только для роли ADMIN). IIFE, публикует `window.renderAccessSection`, который рендерит UI в контейнер `#sec-access`. Все данные и мутации идут через `CRM.admin*` из [[api.js]] → `[[REST API]]`.

## Константы

- `SECTION_LABELS` (`admin-users.js:5`) — человекочитаемые названия разделов: `home`→Главная, `deviations`→Панель отклонений, `onelink`→OneLink Builder, `admin`→Мастер коммуникаций, `templates`→Список шаблонов, `dashboard`→Дашборд, `access`→Управление доступом.
- `ROLES` (`admin-users.js:10`) — три роли: `READER` (только просмотр), `EDITOR` (+ создание/редактирование шаблонов), `ADMIN` (+ управление доступом).

## `window.renderAccessSection()` (`admin-users.js:168`)

Рендерит раздел один раз (флаг `rendered`). Заголовок + подпись, затем:
1. `CRM.adminSections()` → `GET /api/admin/sections` — список всех доступных разделов сохраняется в `allSections` (используется для чекбоксов разделов).
2. Строит форму создания пользователя (`createForm`) и контейнер списка, рендерит список (`renderUsers`).

Вспомогательный `h(tag, attrs, children)` (`admin-users.js:19`) — минимальный DOM-хелпер (обрабатывает `style`, `class`, `on*`-события, прочие атрибуты). UI строится инлайн-стилями (тёмная тема).

### Список — `renderUsers(container)` (`admin-users.js:69`)
`CRM.adminListUsers()` → `GET /api/admin/users`. Таблица: Почта, Имя, Роль, Разделы (через `SECTION_LABELS`), Активен (`enabled`), кнопки **Изменить** / **Пароль** / **Удалить**.

### Создание — `createForm` (`admin-users.js:140`)
Поля: email, имя, пароль, роль (`roleSelect`), чекбоксы разделов (`sectionCheatboxes([], "new_")`). Кнопка «Создать» → `CRM.adminCreateUser({email, displayName, password, role, sections})` → `POST /api/admin/users`, затем перерисовка списка.

### Редактирование — `editUser(u, container)` (`admin-users.js:99`)
Инлайн-панель: имя, роль, `enabled`, чекбоксы разделов (`sectionCheatboxes(u.sections, "edit_"+u.id+"_")`). «Сохранить» → `CRM.adminUpdateUser(u.id, {displayName, role, enabled, sections})` → `PUT /api/admin/users/{id}`.

### Сброс пароля — `resetPwd(u)` (`admin-users.js:122`)
`prompt` нового пароля (мин. 8) → `CRM.adminResetPassword(u.id, pwd)` → `PUT /api/admin/users/{id}/password`.

### Удаление — `delUser(u, container)` (`admin-users.js:128`)
`confirm` → `CRM.adminDeleteUser(u.id)` → `DELETE /api/admin/users/{id}`.

## Сбор разделов — `collectSections(idPrefix)` (`admin-users.js:45`)
Возвращает `allSections`, у которых отмечен чекбокс `#{idPrefix}{section}`. Используется и при создании (`new_`), и при редактировании (`edit_{id}_`).

## Вызывающий контекст
`renderAccessSection` вызывается из `openSection("access")` в `index.html` (`index.html:2527`). Пункт NAV `access` виден только когда `access` есть в `me.sections` (см. `applyNavAcl` в [[api.js]]).

## Используемые эндпоинты `[[REST API]]`
`GET /api/admin/sections`, `GET /api/admin/users`, `POST /api/admin/users`, `PUT /api/admin/users/{id}`, `PUT /api/admin/users/{id}/password`, `DELETE /api/admin/users/{id}`.

## Источник

- `src/main/resources/static/admin-users.js` (весь файл, 1–185)
- `src/main/resources/static/index.html` (вызов `renderAccessSection` `2527`)
