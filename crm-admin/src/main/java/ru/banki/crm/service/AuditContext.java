package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import ru.banki.crm.security.CurrentUser;

/**
 * Replicates v2's {@code set_config('app.current_user', <email>, true)} so the prod
 * audit trigger (arch.arch_log) records the real actor. Must be called inside the same
 * transaction as the mutation so the GUC is set on the same connection.
 */
@Component
public class AuditContext {

    @PersistenceContext
    private EntityManager em;

    @Value("${app.audit.enabled:true}")
    private boolean enabled;

    public void mark() {
        if (!enabled) {
            return;
        }
        em.createNativeQuery("select set_config('app.current_user', :email, true)")
                .setParameter("email", CurrentUser.email())
                .getSingleResult();
    }
}
