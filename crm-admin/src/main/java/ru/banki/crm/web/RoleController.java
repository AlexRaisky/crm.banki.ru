package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.dto.RoleDtos.RoleView;
import ru.banki.crm.dto.RoleDtos.SaveRole;
import ru.banki.crm.service.RoleService;

import java.util.List;

/** Управление ролями (под /api/admin/** => hasRole ADMIN в SecurityConfig). */
@RestController
@RequestMapping("/api/admin/roles")
public class RoleController {

    private final RoleService roles;

    public RoleController(RoleService roles) {
        this.roles = roles;
    }

    @GetMapping
    public List<RoleView> list() {
        return roles.list();
    }

    @PostMapping
    public RoleView create(@Valid @RequestBody SaveRole req) {
        return roles.create(req);
    }

    @PutMapping("/{id}")
    public RoleView update(@PathVariable Long id, @Valid @RequestBody SaveRole req) {
        return roles.update(id, req);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        roles.delete(id);
    }
}
