package ru.banki.crm.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Set;

/** Admin user-management payloads + self password change. */
public final class UserDtos {

    private UserDtos() {}

    /** Права одной учётки на один раздел — строка матрицы доступа. */
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
            String role,        // SUPER_ADMIN наружу не показывается — маскируется под ADMIN
            boolean enabled,
            Set<String> sections,          // разделы с read — для обратной совместимости старого UI
            List<SectionAccessDto> access, // полная матрица прав (новый UI)
            boolean manageable  // может ли текущий пользователь править/удалять эту запись
    ) {}

    // В create/update оба поля опциональны: access — новая матрица; sections — старый
    // список id (тогда права выводятся из роли). Приходит access — берём его.
    public record CreateUser(
            @NotBlank @Email String email,
            String displayName,
            @NotBlank String role,
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String password,
            Set<String> sections,
            List<SectionAccessDto> access
    ) {}

    public record UpdateUser(
            String displayName,
            String role,
            Boolean enabled,
            Set<String> sections,
            List<SectionAccessDto> access
    ) {}

    public record ResetPassword(
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}

    public record ChangeOwnPassword(
            @NotBlank String currentPassword,
            @NotBlank @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}
}
