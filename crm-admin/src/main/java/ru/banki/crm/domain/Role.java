package ru.banki.crm.domain;

/**
 * Capability level. Section visibility is orthogonal (per-user, see {@link AppUser#getSections()}).
 * READER      — read-only on assigned sections.
 * EDITOR      — READER + create/edit/delete templates.
 * ADMIN       — EDITOR + user management (кроме назначения/снятия администраторов).
 * SUPER_ADMIN — ADMIN + единственный, кто может назначать и снимать роль ADMIN.
 *               Выдаётся только супер-админу из конфигурации (app.admin.email).
 */
public enum Role {
    READER,
    EDITOR,
    ADMIN,
    SUPER_ADMIN;

    /** Полномочия администратора: и ADMIN, и SUPER_ADMIN. */
    public boolean isAdminLevel() {
        return this == ADMIN || this == SUPER_ADMIN;
    }
}
