---
tags: [frontend, auth, login]
---

# login.html

Отдельная страница входа (не часть SPA). Отдаётся как статика, содержит собственные стили (тёмная тема, те же CSS-переменные `--bg/--panel/--accent`) и инлайновый скрипт. На `401` из [[api.js]] `req()` пользователя редиректит именно сюда.

## Форма

`<form class="card" id="loginForm">`:
- `#email` — `type="email"`, `autocomplete="username"`, `required`, placeholder `name@banki.ru`;
- `#password` — `type="password"`, `autocomplete="current-password"`, `required`;
- `#submitBtn` — кнопка «Войти»;
- `#err` — контейнер сообщения об ошибке (класс `.err`).

## Логика (`login.html:52`)

На `submit` (с `preventDefault`):
1. чистит `#err`, блокирует кнопку;
2. собирает `URLSearchParams` c `email` (trim) и `password`;
3. `fetch("/api/login", { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, credentials:"same-origin", body })`;
4. `r.ok` → `location.href = "/"` (в SPA);
5. иначе — текст «Неверная почта или пароль», кнопка снова активна;
6. сетевой сбой — «Ошибка сети».

Важно: логин уходит form-urlencoded на `POST /api/login` (не JSON), в отличие от остальных вызовов через `CRM.req`. Выход из системы — `CRM.logout()` (`POST /logout`) из [[api.js]].

## Источник

- `src/main/resources/static/login.html` (весь файл, 1–79)
