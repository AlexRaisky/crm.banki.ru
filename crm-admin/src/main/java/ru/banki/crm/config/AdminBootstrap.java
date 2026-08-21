package ru.banki.crm.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import ru.banki.crm.domain.AppUser;
import ru.banki.crm.domain.Role;
import ru.banki.crm.repo.AppUserRepository;
import ru.banki.crm.repo.RoleRepository;

import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Держит супер-админов привязанными к списку учёток из конфигурации (ADMIN_EMAIL). Роль
 * супер-админа — запись справочника (флаг is_super_admin, засеяна миграцией). На старте:
 * понижаем любого чужого носителя супер-роли до обычной админ-роли и назначаем/создаём
 * супер-роль каждому адресу из списка.
 * <p>
 * Адресов может быть несколько (через запятую) — иначе уход единственного супер-админа
 * означал бы, что отключить его учётку некому: панель не даёт править супер-админа никому,
 * кроме другого супер-админа. Источник истины — конфигурация, а не база: назначить
 * супер-роль через панель по-прежнему нельзя, и любой носитель, которого нет в списке,
 * понижается при следующем старте.
 */
@Component
public class AdminBootstrap implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder encoder;
    private final Set<String> adminEmails;
    private final String adminPassword;

    public AdminBootstrap(AppUserRepository users, RoleRepository roles, PasswordEncoder encoder,
                          @Value("${app.admin.email:}") String adminEmail,
                          @Value("${app.admin.password:}") String adminPassword) {
        this.users = users;
        this.roles = roles;
        this.encoder = encoder;
        this.adminEmails = parseEmails(adminEmail);
        this.adminPassword = adminPassword == null ? "" : adminPassword;
    }

    /** Список адресов: запятая, точка с запятой или пробел — как удобнее в .env. */
    private static Set<String> parseEmails(String raw) {
        Set<String> out = new LinkedHashSet<>();
        if (raw == null) {
            return out;
        }
        Arrays.stream(raw.split("[,;\\s]+"))
                .map(s -> s.trim().toLowerCase())
                .filter(s -> !s.isEmpty())
                .forEach(out::add);
        return out;
    }

    @Override
    public void run(String... args) {
        if (adminEmails.isEmpty() || adminPassword.isEmpty()) {
            log.warn("app.admin.email/password not set — skipping super-admin bootstrap");
            return;
        }
        Role superRole = roles.findAll().stream().filter(Role::isSuperAdmin).findFirst().orElse(null);
        if (superRole == null) {
            log.error("Super-admin role missing — migration V21 not applied? skipping bootstrap");
            return;
        }
        // Обычная админ-роль — «прикрытие» для понижаемого чужого супер-админа.
        Role adminRole = roles.findAll().stream()
                .filter(r -> r.isAdmin() && !r.isSuperAdmin())
                .min(Comparator.comparingInt(Role::getSortOrder))
                .orElse(superRole);

        // Супер-роль — только у адресов из списка: остальных понижаем.
        users.findAll().stream()
                .filter(u -> u.getRole() != null && u.getRole().isSuperAdmin())
                .filter(u -> !adminEmails.contains(u.getEmail().toLowerCase()))
                .forEach(u -> {
                    u.setRole(adminRole);
                    users.save(u);
                    log.warn("Demoted stale super-admin {} (config points to {})", u.getEmail(), adminEmails);
                });

        adminEmails.forEach(email -> ensureSuperAdmin(email, superRole));
    }

    /**
     * Учётку из списка либо повышаем, либо заводим. Заводим с общим ADMIN_PASSWORD — это
     * стартовый пароль, и в логе о нём сказано прямо: у супер-админа права на всё, оставлять
     * его с известным паролем нельзя.
     */
    private void ensureSuperAdmin(String email, Role superRole) {
        var existing = users.findByEmailIgnoreCase(email);
        if (existing.isPresent()) {
            AppUser u = existing.get();
            if (u.getRole() == null || !u.getRole().isSuperAdmin()) {
                u.setRole(superRole);
                users.save(u);
                log.info("Upgraded {} to super-admin role", email);
            } else {
                log.info("Super-admin {} already present", email);
            }
            return;
        }
        AppUser admin = new AppUser();
        admin.setEmail(email);
        admin.setPasswordHash(encoder.encode(adminPassword));
        admin.setDisplayName("Администратор");
        admin.setRole(superRole);
        admin.setEnabled(true);
        users.save(admin);
        log.warn("Created super-admin {} with the configured ADMIN_PASSWORD — change it on first login", email);
    }
}
