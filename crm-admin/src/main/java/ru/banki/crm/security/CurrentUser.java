package ru.banki.crm.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

/** Convenience accessors for the authenticated principal. */
public final class CurrentUser {

    private CurrentUser() {}

    public static Optional<AppUserPrincipal> principal() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a != null && a.getPrincipal() instanceof AppUserPrincipal p) {
            return Optional.of(p);
        }
        return Optional.empty();
    }

    public static String email() {
        return principal().map(AppUserPrincipal::email).orElse("system");
    }
}
