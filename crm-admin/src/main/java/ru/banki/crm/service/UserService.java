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
        return users.findAll().stream().map(UserService::toView).toList();
    }

    @Transactional
    public UserView create(CreateUser req) {
        String email = req.email().trim().toLowerCase();
        validateDomain(email);
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Пользователь уже существует: " + email);
        }
        AppUser u = new AppUser();
        u.setEmail(email);
        u.setDisplayName(req.displayName());
        u.setRole(parseRole(req.role()));
        u.setPasswordHash(encoder.encode(req.password()));
        u.setSections(validSections(req.sections()));
        u.setEnabled(true);
        return toView(users.save(u));
    }

    @Transactional
    public UserView update(Long id, UpdateUser req) {
        AppUser u = get(id);
        if (req.displayName() != null) u.setDisplayName(req.displayName());
        if (req.role() != null) u.setRole(parseRole(req.role()));
        if (req.enabled() != null) u.setEnabled(req.enabled());
        if (req.sections() != null) u.setSections(validSections(req.sections()));
        return toView(users.save(u));
    }

    @Transactional
    public void delete(Long id) {
        AppUser u = get(id);
        if (u.getRole() == Role.ADMIN && countAdmins() <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Нельзя удалить последнего администратора");
        }
        users.delete(u);
    }

    @Transactional
    public void resetPassword(Long id, String newPassword) {
        AppUser u = get(id);
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
        return users.findAll().stream().filter(u -> u.getRole() == Role.ADMIN).count();
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

    static UserView toView(AppUser u) {
        return new UserView(u.getId(), u.getEmail(), u.getDisplayName(),
                u.getRole().name(), u.isEnabled(), u.getSections());
    }
}
