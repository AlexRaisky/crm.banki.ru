---
tags: [backend, config, entrypoint]
---

# CrmAdminApplication

Точка входа Spring Boot приложения. Аннотация `@SpringBootApplication`.

## Методы

- `static void main(String[] args)` — `SpringApplication.run(CrmAdminApplication.class, args)`.

Пакет: `ru.banki.crm`. Компонент-сканирование покрывает `domain`, `repo`, `dto`, `service`, `config`, `security`, `web` внутри этого пакета.

## Связи

- Запускает всё приложение; при старте отрабатывает [[AdminBootstrap]] (`CommandLineRunner`).
- Обзор слоёв — [[Backend Overview]].

## Источник

`src/main/java/ru/banki/crm/CrmAdminApplication.java`
