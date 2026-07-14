---
tags: [moc, home, index]
---

# Home

Точка входа в документацию проекта **CRM-админки коммуникаций** — самописного сервиса на Java/Spring + PostgreSQL + Docker, заменяющего рабочую админку из Appsmith (v2) и сохраняющего UX/UI прототипа v1 (в стиле Salesforce Lightning). Ниже — карта содержания (MOC) по разделам.

## Архитектура

- [[Overview]] — цель, скоуп, 2-контейнерная архитектура
- [[Tech Stack]] — стек по `pom.xml` (Java 21, Spring Boot и др.)
- [[Развёртывание (Docker)]] — Dockerfile, docker-compose, env, запуск
- [[RBAC]] — роли reader / editor / admin и per-user ACL разделов

## Бэкенд

- [[Backend Overview]] — устройство серверной части
- [[REST API]] — эндпоинты `/api/**`

## Фронтенд

- [[Frontend Overview]] — статика v1, вшивание REST, OneLink 1:1
- [[Communication Wizard Forms]] — формы «Мастера коммуникаций»
- [[combobox.js]] — компонент выпадающего списка

## База данных

- [[Схема БД]] — 5 схем (notice / callcenter / retention / arch / app), аудит, dev→prod
- [[push_template (таблица)]] — `notice.push_template` (push)
- [[email_template (таблица)]] — `notice.email_template` (email)
- [[d_com_sms_template (таблица)]] — `notice.d_com_sms_template` (SMS)
- [[d_segment_properties (таблица)]] — `callcenter.d_segment_properties` (колл-центр)
- [[app.users (таблица)]] — пользователи (аутентификация, роли)
- [[app.user_sections (таблица)]] — ACL разделов по пользователям
- [[arch.arch_log (таблица)]] — журнал аудита изменений

## Источник

- `C:\Users\i.zolotonosha\.claude\plans\giggly-bubbling-fox.md`
- `pom.xml`, `docker-compose.yml`, `application.yml`, `db/migration/`, `db/seed/`
