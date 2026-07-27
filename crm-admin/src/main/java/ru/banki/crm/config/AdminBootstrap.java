package ru.banki.crm.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import ru.banki.crm.domain.AppUser;
import ru.banki.crm.domain.Role;
import ru.banki.crm.domain.SectionAccess;
import ru.banki.crm.repo.AppUserRepository;
import ru.banki.crm.service.Sections;

import java.util.HashSet;
import java.util.stream.Collectors;

/** Creates the first super-admin from env on startup (idempotent). */
@Component
public class AdminBootstrap implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final String adminEmail;
    private final String adminPassword;

    public AdminBootstrap(AppUserRepository users, PasswordEncoder encoder,
                          @Value("${app.admin.email:}") String adminEmail,
                          @Value("${app.admin.password:}") String adminPassword) {
        this.users = users;
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
        // Роль супер-админа принадлежит ТОЛЬКО учётке из конфигурации: если адрес сменили,
        // прежний супер-админ понижается до обычного администратора.
        users.findAll().stream()
                .filter(u -> u.getRole() == Role.SUPER_ADMIN)
                .filter(u -> !u.getEmail().equalsIgnoreCase(adminEmail))
                .forEach(u -> {
                    u.setRole(Role.ADMIN);
                    users.save(u);
                    log.warn("Demoted stale super-admin {} to ADMIN (config points to {})", u.getEmail(), adminEmail);
                });

        var existing = users.findByEmailIgnoreCase(adminEmail);
        if (existing.isPresent()) {
            // роль супер-админа выдаётся только этой учётке и восстанавливается при старте
            AppUser u = existing.get();
            if (u.getRole() != Role.SUPER_ADMIN) {
                u.setRole(Role.SUPER_ADMIN);
                users.save(u);
                log.info("Upgraded {} to SUPER_ADMIN", adminEmail);
            } else {
                log.info("Super-admin {} already present", adminEmail);
            }
            return;
        }
        AppUser admin = new AppUser();
        admin.setEmail(adminEmail);
        admin.setPasswordHash(encoder.encode(adminPassword));
        admin.setDisplayName("Администратор");
        admin.setRole(Role.SUPER_ADMIN);
        admin.setEnabled(true);
        // Полный CRUD по всем разделам — для показа в матрице; на enforcement не влияет,
        // супер-админ обходит матрицу на сервере.
        admin.setSectionAccess(Sections.ALL.stream()
                .map(s -> new SectionAccess(s, true, true, true, true))
                .collect(Collectors.toCollection(HashSet::new)));
        users.save(admin);
        log.info("Created super-admin {} with all sections", adminEmail);
    }
}
