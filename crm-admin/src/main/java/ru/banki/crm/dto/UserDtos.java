package ru.banki.crm.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Admin user-management payloads + self password change. */
public final class UserDtos {

    private UserDtos() {}

    /** Права одной роли на один раздел — строка матрицы доступа роли. */
    public record SectionAccessDto(
            String section,
            boolean read,
            boolean add,
            boolean edit,
            boolean delete
    ) {}

    public record UserView(
            Long id,
            String email,
            String displayName,
            String role,        // имя роли; супер-роль не супер-админу маскируется
            Long roleId,        // id роли (для формы правки); маскируется вместе с именем
            boolean enabled,
            boolean manageable  // может ли текущий пользователь править/удалять эту запись
    ) {}

    public record CreateUser(
            @NotBlank @Email String email,
            String displayName,
            @NotNull Long roleId,
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String password
    ) {}

    public record UpdateUser(
            String displayName,
            Long roleId,
            Boolean enabled
    ) {}

    public record ResetPassword(
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}

    public record ChangeOwnPassword(
            @NotBlank String currentPassword,
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}
}
