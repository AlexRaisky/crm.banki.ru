---
tags: [architecture, tech-stack]
---

# Tech Stack

Технологический стек бэкенда по `pom.xml`. Проект — Maven, `groupId` `ru.banki`, `artifactId` `crm-admin`, версия `0.1.0`, финальное имя артефакта `crm-admin.jar`.

## Платформа и фреймворк

| Технология | Версия | Назначение |
|---|---|---|
| Java | 21 | Язык и рантайм (`java.version=21`) |
| Spring Boot | 3.3.4 | Родительский стартер (`spring-boot-starter-parent`), управляет версиями зависимостей |

## Зависимости Spring Boot

Версии наследуются из BOM Spring Boot 3.3.4 (в `pom.xml` не указаны явно).

| Зависимость | Версия | Назначение |
|---|---|---|
| `spring-boot-starter-web` | 3.3.4 (управл.) | REST-контроллеры, встроенный Tomcat, раздача статики фронта |
| `spring-boot-starter-data-jpa` | 3.3.4 (управл.) | Spring Data JPA + Hibernate ORM, репозитории |
| `spring-boot-starter-security` | 3.3.4 (управл.) | Аутентификация/авторизация: form-login, сессии, BCrypt, `@PreAuthorize` |
| `spring-boot-starter-validation` | 3.3.4 (управл.) | Bean Validation (Hibernate Validator) для DTO |
| `spring-boot-starter-aop` | 3.3.4 (управл.) | AOP — используется для аудита (выставление `app.current_user`) |

## Работа с БД

| Зависимость | Версия | Назначение |
|---|---|---|
| `flyway-core` | 10.x (управл.) | Версионные миграции схемы БД |
| `flyway-database-postgresql` | 10.x (управл.) | Поддержка PostgreSQL для Flyway |
| `postgresql` (JDBC-драйвер) | управл. | Драйвер PostgreSQL (scope `runtime`) |

## Прочее

| Зависимость | Версия | Назначение |
|---|---|---|
| `springdoc-openapi-starter-webmvc-ui` | 2.6.0 | Генерация OpenAPI + Swagger UI (`/swagger-ui.html`) |
| `lombok` | управл. | Сокращение бойлерплейта (scope `provided`, исключён из fat-jar в `spring-boot-maven-plugin`) |
| `spring-boot-starter-test` | 3.3.4 (управл.) | Тестирование (scope `test`) |
| `spring-security-test` | управл. | Тестирование безопасности (scope `test`) |

Подробнее об архитектуре — [[Overview]]; о развёртывании — [[Развёртывание (Docker)]].

## Источник

- `pom.xml`
