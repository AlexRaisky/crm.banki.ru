package ru.banki.crm.dto;

import java.util.Set;

/** Identity + capabilities the frontend uses to build the NAV and hide edit controls. */
public record MeDto(
        String email,
        String displayName,
        String role,        // READER | EDITOR | ADMIN
        boolean canEdit,    // EDITOR or ADMIN
        boolean isAdmin,    // ADMIN
        Set<String> sections
) {}
