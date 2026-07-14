---
tags: [database, table, arch, audit]
---

# arch.arch_log (таблица)

Схема-квалифицированное имя: **`arch.arch_log`**.

Таблица **аудита изменений** четырёх таблиц шаблонов. Живёт в схеме `arch`. Заполняется автоматически триггерной функцией `arch.log_change()`, навешанной на `notice.push_template`, `notice.email_template`, `notice.d_com_sms_template`, `callcenter.d_segment_properties`. Автор изменения (`changed_by`) берётся из PostgreSQL-настройки `app.current_user`, которую приложение выставляет перед мутирующими запросами через [[AuditContext]]. Общая картина — [[Схема БД]].

- **Первичный ключ:** `id` (bigserial).
- **Механизм автора:** `current_setting('app.current_user', true)` — email текущего пользователя из сессии Spring Security, выставленный в той же транзакции (аналог `set_config` из v2).
- **Ключ строки:** `row_pk` определяется как `COALESCE(code, id, segment)` из NEW/OLD (JSONB) — учитывает разные имена бизнес-ключей у таблиц.
- **Триггеры:** `trg_audit_push`, `trg_audit_email`, `trg_audit_sms`, `trg_audit_cc` — `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW`.

## Колонки

| Колонка | Тип | NOT NULL? | Назначение |
|---|---|---|---|
| id | bigserial | да (PK) | Автоинкрементный первичный ключ |
| table_name | text | да | Схема и имя таблицы (`TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME`) |
| operation | text | да | Тип операции (`TG_OP`: INSERT / UPDATE / DELETE) |
| row_pk | text | нет | Бизнес-ключ изменённой строки (`COALESCE(code, id, segment)`) |
| changed_by | text | нет | Автор изменения из `app.current_user` |
| changed_at | timestamptz | да | Момент изменения, DEFAULT `now()` |

## Источник

- `src/main/resources/db/migration/V1__template_schema.sql` (таблица, функция `arch.log_change()`, триггеры)
- `src/main/resources/application.yml` (`app.audit.enabled`)
