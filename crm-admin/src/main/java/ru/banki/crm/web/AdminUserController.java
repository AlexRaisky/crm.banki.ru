package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.dto.UserDtos.*;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.UserService;

import java.util.List;
import java.util.Map;

/** ADMIN-only user & access management (guarded by /api/admin/** => hasRole ADMIN in SecurityConfig). */
@RestController
@RequestMapping("/api/admin")
public class AdminUserController {

    private final UserService users;

    public AdminUserController(UserService users) {
        this.users = users;
    }

    /** Section catalogue for the admin UI to render checkboxes. */
    @GetMapping("/sections")
    public List<String> sections() {
        return Sections.ALL;
    }

    @GetMapping("/users")
    public List<UserView> list() {
        return users.list();
    }

    @PostMapping("/users")
    public UserView create(@Valid @RequestBody CreateUser req) {
        return users.create(req);
    }

    @PutMapping("/users/{id}")
    public UserView update(@PathVariable Long id, @RequestBody UpdateUser req) {
        return users.update(id, req);
    }

    @DeleteMapping("/users/{id}")
    public void delete(@PathVariable Long id) {
        users.delete(id);
    }

    @PutMapping("/users/{id}/password")
    public Map<String, String> resetPassword(@PathVariable Long id, @Valid @RequestBody ResetPassword req) {
        users.resetPassword(id, req.newPassword());
        return Map.of("status", "ok");
    }
}
