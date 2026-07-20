package ru.banki.crm.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.AppUser;
import ru.banki.crm.domain.Role;
import ru.banki.crm.dto.UserDtos.*;
import ru.banki.crm.repo.AppUserRepository;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class UserService {

    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final String emailDomain;

    public UserService(AppUserRepository users, PasswordEncoder encoder,
                       @Value("${app.email-domain:}") String emailDomain) {
        this.users = users;
        this.encoder = encoder;
        this.emailDomain = emailDomain == null ? "" : emailDomain.trim();
    }

    @Transactional(readOnly = true)
    public List<UserView> list() {
        return users.findAll().stream().map(this::toView).toList();
    }

    @Transactional
    public UserView create(CreateUser req) {
        String email = req.email().trim().toLowerCase();
        validateDomain(email);
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Пользователь уже существует: " + email);
        }
        Role role = parseRole(req.role());
        requireSuperAdminForAdminRole(role, Role.READER);   // создать админа может только супер-админ
        AppUser u = new AppUser();
        u.setEmail(email);
        u.setDisplayName(req.displayName());
        u.setRole(role);
        u.setPasswordHash(encoder.encode(req.password()));
        u.setSections(validSections(req.sections()));
        u.setEnabled(true);
        return toView(users.save(u));
    }

    @Transactional
    public UserView update(Long id, UpdateUser req) {
        AppUser u = get(id);
        requireCanManage(u);
        if (req.displayName() != null) u.setDisplayName(req.displayName());
        if (req.role() != null) {
            Role target = parseRole(req.role());
            // назначать и снимать администраторов может только супер-админ
            if (target != u.getRole()) requireSuperAdminForAdminRole(target, u.getRole());
            u.setRole(target);
        }
        if (req.enabled() != null) u.setEnabled(req.enabled());
        if (req.sections() != null) u.setSections(validSections(req.sections()));
        return toView(users.save(u));
    }

    @Transactional
    public void delete(Long id) {
        AppUser u = get(id);
        requireCanManage(u);
        if (u.getRole().isAdminLevel() && countAdmins() <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Нельзя удалить последнего администратора");
        }
        users.delete(u);
    }

    @Transactional
    public void resetPassword(Long id, String newPassword) {
        AppUser u = get(id);
        requireCanManage(u);
        u.setPasswordHash(encoder.encode(newPassword));
        users.save(u);
    }

    @Transactional
    public void changeOwnPassword(String email, String current, String newPassword) {
        AppUser u = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Не авторизован"));
        if (!encoder.matches(current, u.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Текущий пароль неверен");
        }
        u.setPasswordHash(encoder.encode(newPassword));
        users.save(u);
    }

    // ------------------------------------------------------------------ helpers
    private AppUser get(Long id) {
        return users.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Пользователь не найден"));
    }

    private long countAdmins() {
        return users.findAll().stream().filter(u -> u.getRole().isAdminLevel()).count();
    }

    // ------------------------------------------- правила вокруг роли администратора
    /** Текущий пользователь — супер-админ? */
    private boolean currentIsSuperAdmin() {
        return ru.banki.crm.security.CurrentUser.principal()
                .map(p -> p.user().getRole() == Role.SUPER_ADMIN)
                .orElse(false);
    }

    /**
     * Единый текст отказа для всех админ-уровней: по сообщению нельзя понять,
     * что у конкретной учётки есть расширенные права.
     */
    private static final String NO_RIGHTS = "Недостаточно прав для этой операции";

    /** Назначить или снять роль администратора может только супер-админ. */
    private void requireSuperAdminForAdminRole(Role target, Role currentRole) {
        if (target == Role.SUPER_ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, NO_RIGHTS);
        }
        boolean touchesAdmin = target.isAdminLevel() || currentRole.isAdminLevel();
        if (touchesAdmin && !currentIsSuperAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, NO_RIGHTS);
        }
    }

    /**
     * Учётку супер-админа через панель не меняем вовсе; админ-уровень доступен
     * только супер-админу. Отказ всегда с одинаковым текстом.
     */
    private void requireCanManage(AppUser u) {
        boolean superAdminTarget = u.getRole() == Role.SUPER_ADMIN;
        boolean adminTarget = u.getRole().isAdminLevel();
        if (superAdminTarget || (adminTarget && !currentIsSuperAdmin())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, NO_RIGHTS);
        }
    }

    /** Корпоративный домен по умолчанию: пустой APP_EMAIL_DOMAIN не отключает проверку. */
    private static final String DEFAULT_EMAIL_DOMAIN = "banki.ru";

    private void validateDomain(String email) {
        String domain = emailDomain.isEmpty() ? DEFAULT_EMAIL_DOMAIN : emailDomain;
        if (!email.endsWith("@" + domain)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Разрешены только адреса @" + domain);
        }
    }

    private static Role parseRole(String role) {
        try {
            return Role.valueOf(role.trim().toUpperCase());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректная роль: " + role);
        }
    }

    private static Set<String> validSections(Set<String> sections) {
        if (sections == null) return new HashSet<>();
        for (String s : sections) {
            if (!Sections.isValid(s)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный раздел: " + s);
            }
        }
        return new HashSet<>(sections);
    }

    /**
     * Наружу супер-админ выглядит обычным администратором: роль маскируется,
     * а невозможность его править передаётся нейтральным флагом manageable
     * (он же false для админов, если смотрит не супер-админ).
     */
    private UserView toView(AppUser u) {
        String role = u.getRole() == Role.SUPER_ADMIN ? Role.ADMIN.name() : u.getRole().name();
        boolean manageable = u.getRole() != Role.SUPER_ADMIN
                && (!u.getRole().isAdminLevel() || currentIsSuperAdmin());
        return new UserView(u.getId(), u.getEmail(), u.getDisplayName(),
                role, u.isEnabled(), u.getSections(), manageable);
    }
}
