package ru.banki.crm.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Set;

/** Admin user-management payloads + self password change. */
public final class UserDtos {

    private UserDtos() {}

    public record UserView(
            Long id,
            String email,
            String displayName,
            String role,
            boolean enabled,
            Set<String> sections
    ) {}

    public record CreateUser(
            @NotBlank @Email String email,
            String displayName,
            @NotBlank String role,
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String password,
            Set<String> sections
    ) {}

    public record UpdateUser(
            String displayName,
            String role,
            Boolean enabled,
            Set<String> sections
    ) {}

    public record ResetPassword(
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}

    public record ChangeOwnPassword(
            @NotBlank String currentPassword,
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}
}
