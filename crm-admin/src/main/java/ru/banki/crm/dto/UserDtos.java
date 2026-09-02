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

    /* Сообщения проставлены у каждого ограничения намеренно: по умолчанию Bean Validation
       отдаёт английские фразы вроде "must not be blank", а наружу они уезжают как есть
       (ValidationErrorHandler склеивает именно их). Человек должен прочитать, что поправить. */
    public record CreateUser(
            @NotBlank(message = "Укажите почту")
            @Email(message = "Почта должна быть вида name@banki.ru") String email,
            String displayName,
            @NotNull(message = "Выберите роль") Long roleId,
            @NotBlank(message = "Укажите пароль")
            @Size(min = 8, message = "Пароль минимум 8 символов") String password
    ) {}

    public record UpdateUser(
            String displayName,
            Long roleId,
            Boolean enabled
    ) {}

    public record ResetPassword(
            @NotBlank(message = "Укажите пароль")
            @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}

    public record ChangeOwnPassword(
            @NotBlank(message = "Укажите текущий пароль") String currentPassword,
            @NotBlank(message = "Укажите новый пароль")
            @Size(min = 8, message = "Пароль минимум 8 символов") String newPassword
    ) {}
}
