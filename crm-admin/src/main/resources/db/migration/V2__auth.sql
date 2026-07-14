-- Authentication & RBAC. Lives in the app's own "app" schema, separate from the
-- corporate template schemas. Users log in with their corporate email (self-chosen
-- password, BCrypt). Role = capability level; user_sections = per-user visible sections.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users (
    id            bigserial   PRIMARY KEY,
    email         text        NOT NULL UNIQUE,
    password_hash text        NOT NULL,
    display_name  text,
    role          text        NOT NULL DEFAULT 'READER',   -- READER | EDITOR | ADMIN
    enabled       boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_role CHECK (role IN ('READER','EDITOR','ADMIN'))
);

CREATE TABLE IF NOT EXISTS app.user_sections (
    user_id    bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    section_id text   NOT NULL,          -- home | deviations | onelink | admin | templates | dashboard | access
    PRIMARY KEY (user_id, section_id)
);
