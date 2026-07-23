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
        // isAdminLevel(), а не == ADMIN: супер-админ полномочнее админа, и отсекать его здесь
        // неверно. Раньше это не всплывало — набор разделов супер-админу проставляется при
        // заведении копией Sections.ALL, и он проходил проверку по разделам. Но всякий раздел,
        // добавленный ПОСЛЕ создания пользователя, в этот набор уже не попадает: на promo
        // супер-админ получал 403 там, где обычный админ проходил.
        if (p.user().getRole().isAdminLevel()) {
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
