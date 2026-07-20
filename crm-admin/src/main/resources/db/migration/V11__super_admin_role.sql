-- Роль SUPER_ADMIN: назначает и снимает администраторов; выдаётся только учётной
-- записи из конфигурации (app.admin.email) при старте приложения (AdminBootstrap).
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE app.users ADD CONSTRAINT chk_users_role
    CHECK (role = ANY (ARRAY['READER', 'EDITOR', 'ADMIN', 'SUPER_ADMIN']));
