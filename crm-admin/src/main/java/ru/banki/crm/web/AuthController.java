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
        boolean isSuperAdmin = u.getRole() == Role.SUPER_ADMIN;
        // ADMIN обходит ACL разделов на сервере — в NAV ему тоже отдаём всё,
        // чтобы новые разделы появлялись у админов без правки user_sections.
        // «Цепочки» — только админам: не-админу раздел не отдаём даже при ACL.
        java.util.Set<String> sections = isAdmin
                ? java.util.Set.copyOf(ru.banki.crm.service.Sections.ALL)
                : u.getSections().stream()
                        .filter(s -> !ru.banki.crm.service.Sections.JOURNEYS.equals(s))
                        .collect(java.util.stream.Collectors.toUnmodifiableSet());

        // Карта прав по разделам. Админу — всё true по всем разделам (он и так обходит
        // матрицу на сервере). Не-админу — из его строк user_sections.
        java.util.Map<String, MeDto.Caps> caps = new java.util.HashMap<>();
        if (isAdmin) {
            for (String s : ru.banki.crm.service.Sections.ALL) {
                caps.put(s, new MeDto.Caps(true, true, true, true));
            }
        } else {
            for (String s : sections) {
                caps.put(s, new MeDto.Caps(
                        u.hasCapability(s, ru.banki.crm.domain.Capability.READ),
                        u.hasCapability(s, ru.banki.crm.domain.Capability.ADD),
                        u.hasCapability(s, ru.banki.crm.domain.Capability.EDIT),
                        u.hasCapability(s, ru.banki.crm.domain.Capability.DELETE)));
            }
        }
        // Грубый флаг для нынешнего data-readonly (до этапа 3): может ли писать хоть где-то.
        boolean canEdit = isAdmin || caps.values().stream()
                .anyMatch(c -> c.add() || c.edit() || c.delete());

        return new MeDto(u.getEmail(), u.getDisplayName(), u.getRole().name(),
                canEdit, isAdmin, sections, isSuperAdmin, caps);
    }

    @PutMapping("/me/password")
    public void changePassword(@Valid @RequestBody ChangeOwnPassword req) {
        userService.changeOwnPassword(CurrentUser.email(), req.currentPassword(), req.newPassword());
    }
}
