package ru.banki.crm.dto;

import java.util.Map;
import java.util.Set;

/** Identity + capabilities the frontend uses to build the NAV and hide edit controls. */
public record MeDto(
        String email,
        String displayName,
        String role,          // READER | EDITOR | ADMIN | SUPER_ADMIN
        boolean canEdit,      // есть ли право писать хоть где-то (грубый data-readonly до этапа 3)
        boolean isAdmin,      // ADMIN или SUPER_ADMIN
        Set<String> sections, // разделы, которые видно (read) — для NAV
        boolean isSuperAdmin, // только SUPER_ADMIN: назначает и снимает администраторов
        Map<String, Caps> caps // раздел → права; по нему фронт прячет кнопки add/edit/delete
) {
    /** Права на один раздел. */
    public record Caps(boolean read, boolean add, boolean edit, boolean delete) {}
}
