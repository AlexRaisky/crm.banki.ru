---
tags: [architecture, docker, deployment]
---

# Развёртывание (Docker)

Проект разворачивается двумя контейнерами: приложение (`app`) и база (`db`). Spring Boot сам раздаёт статику фронта, поэтому отдельного веб-сервера не нужно. См. [[Overview]] и [[Tech Stack]].

## Dockerfile (multi-stage)

Двухстадийная сборка — сборка через Maven, рантайм на лёгком JRE.

1. **build** — образ `maven:3.9-eclipse-temurin-21`:
   - `WORKDIR /build`; сначала копируется только `pom.xml` и прогревается кэш зависимостей (`mvn dependency:resolve dependency:resolve-plugins`, best-effort через `|| true`);
   - затем копируется `src` и выполняется `mvn clean package -DskipTests` → артефакт `target/crm-admin.jar`.
2. **runtime** — образ `eclipse-temurin:21-jre`:
   - `WORKDIR /app`; создаётся непривилегированный пользователь `app` (`groupadd`/`useradd`);
   - копируется jar из стадии build в `/app/app.jar`; `USER app`; `EXPOSE 8080`;
   - `ENTRYPOINT ["java","-jar","/app/app.jar"]`.

## docker-compose.yml

| Сервис | Образ / сборка | Порты | Особенности |
|---|---|---|---|
| `db` | `postgres:16` (`container_name: crm-admin-db`) | `${DB_PORT:-5432}:5432` | volume `crm_db_data` → `/var/lib/postgresql/data`; healthcheck `pg_isready` (interval 5s, timeout 5s, retries 10) |
| `app` | `build: .` (`container_name: crm-admin-app`) | `${APP_PORT:-8080}:8080` | `depends_on: db` с `condition: service_healthy` |

Именованный volume `crm_db_data` хранит данные Postgres между перезапусками.

## Переменные окружения (.env.example)

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `APP_PORT` | 8080 | Внешний порт приложения |
| `SPRING_PROFILES_ACTIVE` | docker | Профиль Spring: `docker` (своя БД + схема + сид) или `prod` (внешняя БД) |
| `ADMIN_EMAIL` | admin@banki.ru | Почта первого супер-админа |
| `ADMIN_PASSWORD` | change-me-please | Пароль первого супер-админа (создаётся при старте) |
| `APP_EMAIL_DOMAIN` | (пусто) | Ограничение домена логина (например, `banki.ru`); пусто = без ограничения |
| `DB_NAME` | crm | Имя БД (для контейнера `db`) |
| `DB_USER` | crm | Пользователь БД |
| `DB_PASSWORD` | crm | Пароль БД |
| `DB_PORT` | 5432 | Внешний порт Postgres |
| `DB_URL` | jdbc:postgresql://db:5432/crm | JDBC-URL для приложения |

Примечание из файла: в `.env` всё после `=` — значение, инлайн-комментарии после значений недопустимы.

## Как запустить

```
cp .env.example .env   # и поправить значения (как минимум ADMIN_PASSWORD)
docker compose up -d --build
```

Приложение поднимется на `http://localhost:8080` (Swagger UI — `/swagger-ui.html`). В профиле `docker` Flyway создаёт прод-идентичную схему и заливает демо-данные, а из env идемпотентно создаётся супер-админ.

## Переключение dev → prod

- **Dev (`docker`):** свой Postgres в compose, Flyway применяет `db/migration` + `db/seed`.
- **Prod (`prod`):** в `.env` установить `SPRING_PROFILES_ACTIVE=prod` и указать `DB_URL` / `DB_USER` / `DB_PASSWORD` на корпоративную PostgreSQL. Таблицы там уже существуют, поэтому Flyway отключается (`spring.flyway.enabled=false`) — правок кода не требуется. Подробнее — [[Схема БД]].

## Источник

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `src/main/resources/application.yml`
