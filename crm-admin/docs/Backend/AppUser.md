---
tags: [backend, domain, entity, security]
---

# AppUser

JPA-сущность пользователя админ-панели. Маппится на таблицу `app.users`. Хранит учётные данные, роль ([[Role]]) и набор разрешённых разделов (`sections`).

Аннотации: `@Entity`, `@Table(name = "users", schema = "app")`, `@Getter`, `@Setter`.

## Поля

- `id : Long` — `@Id`, `@GeneratedValue(strategy = GenerationType.IDENTITY)`.
- `email : String` — `@Column(nullable = false, unique = true)`.
- `passwordHash : String` — колонка `password_hash`, `nullable = false`. BCrypt-хеш (кодируется через `PasswordEncoder`).
- `displayName : String` — колонка `display_name`.
- `role : Role` — `@Enumerated(EnumType.STRING)`, `nullable = false`, default `Role.READER`. См. [[Role]].
- `enabled : boolean` — `@Column(nullable = false)`, default `true`.
- `createdAt : OffsetDateTime` — колонка `created_at`, `insertable = false, updatable = false` (проставляется БД).
- `sections : Set<String>` — `@ElementCollection(fetch = FetchType.EAGER)`, `@CollectionTable(name = "user_sections", schema = "app", joinColumns = @JoinColumn(name = "user_id"))`, `@Column(name = "section_id")`. Набор id разделов, которые пользователь может видеть (home, deviations, onelink, admin, templates, dashboard, access). Валидные значения — см. [[Sections]].

## Связи

- Роль: [[Role]]; валидные разделы: [[Sections]].
- Репозиторий: [[AppUserRepository]].
- Управляется сервисом [[UserService]]; первый супер-админ создаётся в [[AdminBootstrap]].
- DTO-представления: [[UserDtos]], [[MeDto]].

## Источник

`src/main/java/ru/banki/crm/domain/AppUser.java`
