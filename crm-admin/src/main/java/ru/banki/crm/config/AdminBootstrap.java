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

import java.util.Comparator;

/**
 * Держит супер-админа привязанным к учётке из конфигурации (ADMIN_EMAIL). Роль супер-админа —
 * запись справочника (флаг is_super_admin, засеяна миграцией). На старте: понижаем любого
 * чужого носителя супер-роли до обычной админ-роли и назначаем/создаём ADMIN_EMAIL супер-роль.
 */
@Component
public class AdminBootstrap implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder encoder;
    private final String adminEmail;
    private final String adminPassword;

    public AdminBootstrap(AppUserRepository users, RoleRepository roles, PasswordEncoder encoder,
                          @Value("${app.admin.email:}") String adminEmail,
                          @Value("${app.admin.password:}") String adminPassword) {
        this.users = users;
        this.roles = roles;
        this.encoder = encoder;
        this.adminEmail = adminEmail == null ? "" : adminEmail.trim().toLowerCase();
        this.adminPassword = adminPassword == null ? "" : adminPassword;
    }

    @Override
    public void run(String... args) {
        if (adminEmail.isEmpty() || adminPassword.isEmpty()) {
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

        // Супер-роль — только у ADMIN_EMAIL: чужих понижаем.
        users.findAll().stream()
                .filter(u -> u.getRole() != null && u.getRole().isSuperAdmin())
                .filter(u -> !u.getEmail().equalsIgnoreCase(adminEmail))
                .forEach(u -> {
                    u.setRole(adminRole);
                    users.save(u);
                    log.warn("Demoted stale super-admin {} (config points to {})", u.getEmail(), adminEmail);
                });

        var existing = users.findByEmailIgnoreCase(adminEmail);
        if (existing.isPresent()) {
            AppUser u = existing.get();
            if (u.getRole() == null || !u.getRole().isSuperAdmin()) {
                u.setRole(superRole);
                users.save(u);
                log.info("Upgraded {} to super-admin role", adminEmail);
            } else {
                log.info("Super-admin {} already present", adminEmail);
            }
            return;
        }
        AppUser admin = new AppUser();
        admin.setEmail(adminEmail);
        admin.setPasswordHash(encoder.encode(adminPassword));
        admin.setDisplayName("Администратор");
        admin.setRole(superRole);
        admin.setEnabled(true);
        users.save(admin);
        log.info("Created super-admin {}", adminEmail);
    }
}
