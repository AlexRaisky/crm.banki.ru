package ru.banki.crm.dto;

import java.util.Set;

/** Identity + capabilities the frontend uses to build the NAV and hide edit controls. */
public record MeDto(
        String email,
        String displayName,
        String role,          // READER | EDITOR | ADMIN | SUPER_ADMIN
        boolean canEdit,      // EDITOR, ADMIN или SUPER_ADMIN
        boolean isAdmin,      // ADMIN или SUPER_ADMIN
        Set<String> sections,
        boolean isSuperAdmin  // только SUPER_ADMIN: назначает и снимает администраторов
) {}
