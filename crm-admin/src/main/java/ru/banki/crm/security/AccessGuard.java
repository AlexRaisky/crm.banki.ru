package ru.banki.crm.security;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.Role;

/** Per-user section ACL checks (role sets capability, sections set visibility). ADMIN bypasses. */
@Component
public class AccessGuard {

    /** Throws 403 unless the current user is ADMIN or has at least one of the given sections. */
    public void requireAnySection(String... sectionIds) {
        AppUserPrincipal p = CurrentUser.principal()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Не авторизован"));
        if (p.user().getRole() == Role.ADMIN) {
            return;
        }
        for (String s : sectionIds) {
            if (p.sections().contains(s)) {
                return;
            }
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Нет доступа к разделу");
    }
}
