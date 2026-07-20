package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.AppUser;
import ru.banki.crm.domain.Role;
import ru.banki.crm.dto.MeDto;
import ru.banki.crm.dto.UserDtos.ChangeOwnPassword;
import ru.banki.crm.security.AppUserPrincipal;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.UserService;

@RestController
@RequestMapping("/api")
public class AuthController {

    private final UserService userService;

    public AuthController(UserService userService) {
        this.userService = userService;
    }

    /** Identity + capabilities the frontend uses to build the NAV and hide edit controls. */
    @GetMapping("/me")
    public MeDto me() {
        AppUserPrincipal p = CurrentUser.principal()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Не авторизован"));
        AppUser u = p.user();
        boolean isAdmin = u.getRole().isAdminLevel();
        boolean canEdit = u.getRole() == Role.EDITOR || isAdmin;
        boolean isSuperAdmin = u.getRole() == Role.SUPER_ADMIN;
        // ADMIN обходит ACL разделов на сервере — в NAV ему тоже отдаём всё,
        // чтобы новые разделы появлялись у админов без правки user_sections.
        // «Цепочки» — только админам: не-админу раздел не отдаём даже при ACL.
        java.util.Set<String> sections = isAdmin
                ? java.util.Set.copyOf(ru.banki.crm.service.Sections.ALL)
                : u.getSections().stream()
                        .filter(s -> !ru.banki.crm.service.Sections.JOURNEYS.equals(s))
                        .collect(java.util.stream.Collectors.toUnmodifiableSet());
        return new MeDto(u.getEmail(), u.getDisplayName(), u.getRole().name(),
                canEdit, isAdmin, sections, isSuperAdmin);
    }

    @PutMapping("/me/password")
    public void changePassword(@Valid @RequestBody ChangeOwnPassword req) {
        userService.changeOwnPassword(CurrentUser.email(), req.currentPassword(), req.newPassword());
    }
}
