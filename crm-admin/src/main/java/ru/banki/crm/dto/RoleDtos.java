package ru.banki.crm.dto;

import jakarta.validation.constraints.NotBlank;
import ru.banki.crm.dto.UserDtos.SectionAccessDto;

import java.util.List;

/** Управление ролями (справочник app.role). */
public final class RoleDtos {

    private RoleDtos() {}

    public record RoleView(
            Long id,
            String name,
            boolean isAdmin,       // админ-полномочия (управление доступом + обход матрицы)
            boolean isSuperAdmin,  // всё; привязана к ADMIN_EMAIL
            boolean isSystem,      // встроенная: удалить/переименовать нельзя
            List<SectionAccessDto> access,   // матрица прав роли по разделам
            boolean manageable,    // может ли текущий пользователь править/удалять эту роль
            long users             // сколько учёток на роли (для защиты от удаления)
    ) {}

    // isSuperAdmin через панель не задаётся — супер-роль одна, встроенная.
    public record SaveRole(
            @NotBlank String name,
            boolean isAdmin,
            List<SectionAccessDto> access
    ) {}
}
