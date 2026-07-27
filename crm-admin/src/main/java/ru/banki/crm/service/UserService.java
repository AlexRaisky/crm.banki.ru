package ru.banki.crm.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.AppUser;
import ru.banki.crm.domain.Role;
import ru.banki.crm.domain.SectionAccess;
import ru.banki.crm.dto.UserDtos.*;
import ru.banki.crm.repo.AppUserRepository;

import java.util.Comparator;
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
        u.setSectionAccess(buildAccess(req.access(), req.sections(), role));
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
        // Права переписываем, если пришла матрица (access) или старый список (sections).
        // Роль для вывода прав из списка — уже применённая (req.role() выше или прежняя).
        if (req.access() != null || req.sections() != null) {
            u.setSectionAccess(buildAccess(req.access(), req.sections(), u.getRole()));
        }
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

    /**
     * Собрать строки прав. Приоритет — матрица access (новый UI); её нет — старый список
     * разделов, и права выводятся из роли (EDITOR/админ → полный CRUD, READER → только
     * чтение), как было до матрицы. У не-writable разделов (витрины, только чтение)
     * add/edit/delete гасим независимо от входа: серверных ручек записи там нет, а true
     * ввёл бы в заблуждение. Строку заводим только при наличии read — иначе раздел просто
     * невидим (право писать без чтения бессмысленно).
     */
    private Set<SectionAccess> buildAccess(List<SectionAccessDto> access, Set<String> sectionIds, Role role) {
        Set<SectionAccess> out = new HashSet<>();
        if (access != null) {
            for (SectionAccessDto a : access) {
                if (!Sections.isValid(a.section())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный раздел: " + a.section());
                }
                boolean read = a.read() || a.add() || a.edit() || a.delete();
                if (!read) continue;
                boolean w = Sections.isWritable(a.section());
                out.add(new SectionAccess(a.section(), true,
                        w && a.add(), w && a.edit(), w && a.delete()));
            }
            return out;
        }
        if (sectionIds != null) {
            boolean editor = role == Role.EDITOR || role.isAdminLevel();
            for (String s : sectionIds) {
                if (!Sections.isValid(s)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный раздел: " + s);
                }
                boolean w = Sections.isWritable(s) && editor;
                out.add(new SectionAccess(s, true, w, w, w));
            }
        }
        return out;
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
        List<SectionAccessDto> access = u.getSectionAccess().stream()
                .map(sa -> new SectionAccessDto(sa.getSectionId(), sa.isCanRead(),
                        sa.isCanAdd(), sa.isCanEdit(), sa.isCanDelete()))
                .sorted(Comparator.comparing(SectionAccessDto::section))
                .toList();
        return new UserView(u.getId(), u.getEmail(), u.getDisplayName(),
                role, u.isEnabled(), u.getSections(), access, manageable);
    }
}
