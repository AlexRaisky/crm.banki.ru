package ru.banki.crm.domain;

/**
 * Capability level. Section visibility is orthogonal (per-user, see {@link AppUser#getSections()}).
 * READER  — read-only on assigned sections.
 * EDITOR  — READER + create/edit/delete templates.
 * ADMIN   — EDITOR + user management, role & section assignment.
 */
public enum Role {
    READER,
    EDITOR,
    ADMIN
}
