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
import ru.banki.crm.repo.RoleRepository;

import java.util.Comparator;
import java.util.List;

@Service
public class UserService {

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder encoder;
    private final String emailDomain;

    public UserService(AppUserRepository users, RoleRepository roles, PasswordEncoder encoder,
                       @Value("${app.email-domain:}") String emailDomain) {
        this.users = users;
        this.roles = roles;
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
        Role role = resolveRole(req.roleId());
        requireCanAssign(role);
        AppUser u = new AppUser();
        u.setEmail(email);
        u.setDisplayName(req.displayName());
        u.setRole(role);
        u.setPasswordHash(encoder.encode(req.password()));
        u.setEnabled(true);
        return toView(users.save(u));
    }

    @Transactional
    public UserView update(Long id, UpdateUser req) {
        AppUser u = get(id);
        requireCanManage(u);
        if (req.displayName() != null) u.setDisplayName(req.displayName());
        if (req.roleId() != null) {
            Role target = resolveRole(req.roleId());
            if (!target.getId().equals(u.getRole().getId())) {
                requireCanAssign(target);   // назначить админ-роль может только супер-админ
                u.setRole(target);
            }
        }
        if (req.enabled() != null) u.setEnabled(req.enabled());
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

    private Role resolveRole(Long roleId) {
        if (roleId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Не указана роль");
        }
        Role role = roles.findById(roleId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректная роль"));
        /* Неактивная роль не пускает своих носителей в панель, поэтому назначать её —
           значит завести учётку, которая сразу не работает. Отказываем внятно. */
        if (!role.isActive()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Роль «" + role.getName() + "» отключена — назначить её нельзя. Включите роль или выберите другую.");
        }
        return role;
    }

    private long countAdmins() {
        return users.findAll().stream().filter(u -> u.getRole().isAdminLevel()).count();
    }

    // ------------------------------------------- правила вокруг админ-ролей
    private boolean currentIsSuperAdmin() {
        return ru.banki.crm.security.CurrentUser.principal()
                .map(p -> p.user().getRole().isSuperAdmin())
                .orElse(false);
    }

    /**
     * Единый текст отказа для всех админ-уровней: по сообщению нельзя понять,
     * что у конкретной учётки/роли есть расширенные права.
     */
    private static final String NO_RIGHTS = "Недостаточно прав для этой операции";

    /** Назначить учётке роль: супер-роль через панель нельзя, админ-роль — только супер-админ. */
    private void requireCanAssign(Role target) {
        if (target.isSuperAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, NO_RIGHTS);
        }
        if (target.isAdminLevel() && !currentIsSuperAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, NO_RIGHTS);
        }
    }

    /**
     * Учётку супер-админа через панель не меняем вовсе; учётку с админ-ролью —
     * только супер-админ. Отказ всегда с одинаковым текстом.
     */
    private void requireCanManage(AppUser u) {
        boolean superAdminTarget = u.getRole().isSuperAdmin();
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

    /**
     * Наружу супер-админ выглядит обычным администратором: его роль не супер-админу
     * маскируется под обычную админ-роль, а невозможность его править передаётся
     * нейтральным флагом manageable.
     */
    private UserView toView(AppUser u) {
        boolean superTarget = u.getRole().isSuperAdmin();
        boolean mask = superTarget;   // супер-роль везде показываем как обычного «Админ», даже самому супер-админу
        String roleName = mask ? coverRoleName() : u.getRole().getName();
        Long roleId = mask ? null : u.getRole().getId();
        boolean manageable = !superTarget
                && (!u.getRole().isAdminLevel() || currentIsSuperAdmin());
        return new UserView(u.getId(), u.getEmail(), u.getDisplayName(),
                roleName, roleId, u.isEnabled(), manageable);
    }

    /** Имя-прикрытие для супер-роли: предпочитаем роль «Админ»; иначе первая обычная
     *  админ-роль по порядку; если такой нет — «Админ». */
    private String coverRoleName() {
        return roles.findByNameIgnoreCase("Админ")
                .map(Role::getName)
                .orElseGet(() -> roles.findAll().stream()
                        .filter(r -> r.isAdmin() && !r.isSuperAdmin())
                        .min(Comparator.comparingInt(Role::getSortOrder))
                        .map(Role::getName)
                        .orElse("Админ"));
    }
}
