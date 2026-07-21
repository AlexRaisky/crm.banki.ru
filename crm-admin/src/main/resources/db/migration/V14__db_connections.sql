-- Реестр подключений к БД для страницы «Диагностика» (/settings, только ADMIN).
-- Пользователь заводит внешние базы через форму; панель хранит их здесь и умеет
-- проверять доступность (SELECT 1). Пароль лежит в НАШЕЙ базе (доверенное хранилище)
-- и наружу через API НЕ отдаётся — в списке только признак hasPassword.
-- Встроенные подключения (наша БД, прод-БД из env) в этой таблице НЕ хранятся —
-- они добавляются к списку сервисом на лету как read-only.
CREATE TABLE IF NOT EXISTS app.db_connection (
    id              bigserial PRIMARY KEY,
    name            varchar(100) NOT NULL UNIQUE,   -- человекочитаемое имя
    jdbc_url        text        NOT NULL,           -- jdbc:postgresql://host:port/db
    username        varchar(200),
    password        text,                           -- plaintext, наружу не отдаётся
    driver          varchar(100),                   -- опц.; по умолчанию PostgreSQL
    purpose         text,                           -- заметка «для чего это подключение»
    is_active       boolean     NOT NULL DEFAULT true,

    -- результат последней проверки соединения (runtime, обновляется при «Проверить»)
    last_status     varchar(20),                    -- OK | ERROR | NULL (не проверялось)
    last_error      text,
    last_latency_ms integer,
    last_checked_at timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      varchar(200)
);
