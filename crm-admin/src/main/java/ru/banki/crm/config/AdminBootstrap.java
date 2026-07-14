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
import ru.banki.crm.service.Sections;

import java.util.HashSet;

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
        if (users.existsByEmailIgnoreCase(adminEmail)) {
            log.info("Super-admin {} already present", adminEmail);
            return;
        }
        AppUser admin = new AppUser();
        admin.setEmail(adminEmail);
        admin.setPasswordHash(encoder.encode(adminPassword));
        admin.setDisplayName("Администратор");
        admin.setRole(Role.ADMIN);
        admin.setEnabled(true);
        admin.setSections(new HashSet<>(Sections.ALL));
        users.save(admin);
        log.info("Created super-admin {} with all sections", adminEmail);
    }
}
