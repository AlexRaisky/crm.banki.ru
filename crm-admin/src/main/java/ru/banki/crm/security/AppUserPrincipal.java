package ru.banki.crm.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import ru.banki.crm.domain.AppUser;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/** Spring Security principal wrapping our {@link AppUser} (carries role + section ACL). */
public class AppUserPrincipal implements UserDetails {

    private final AppUser user;

    public AppUserPrincipal(AppUser user) {
        this.user = user;
    }

    public AppUser user() {
        return user;
    }

    public String email() {
        return user.getEmail();
    }

    public Set<String> sections() {
        return user.getSections();
    }

    public boolean hasCapability(String sectionId, ru.banki.crm.domain.Capability cap) {
        return user.hasCapability(sectionId, cap);
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        // Полномочия выводим из флагов роли, а не из её имени: super-admin → и ROLE_ADMIN
        // (все проверки hasRole('ADMIN') продолжают работать), admin → ROLE_ADMIN, прочие —
        // просто аутентифицированы (ROLE_USER, никаких админ-прав).
        ru.banki.crm.domain.Role r = user.getRole();
        if (r != null && r.isSuperAdmin()) {
            return List.of(new SimpleGrantedAuthority("ROLE_SUPER_ADMIN"),
                           new SimpleGrantedAuthority("ROLE_ADMIN"));
        }
        if (r != null && r.isAdmin()) {
            return List.of(new SimpleGrantedAuthority("ROLE_ADMIN"));
        }
        return List.of(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Override
    public String getPassword() {
        return user.getPasswordHash();
    }

    @Override
    public String getUsername() {
        return user.getEmail();
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    /**
     * Учётка рабочая, если включена сама И активна её роль.
     * <p>
     * Деактивация роли — замена удалению, и она обязана что-то значить для тех, у кого
     * эта роль уже есть. Гасить права по одному разделу было бы полумерой: человек вошёл
     * бы в панель, увидел пустое меню и пошёл выяснять, что сломалось. Отказ на входе
     * честнее — и стоит там же, где отказ выключенной учётке.
     * <p>
     * Уже открытые сессии этим не рвутся: проверка отрабатывает при входе.
     */
    @Override
    public boolean isEnabled() {
        return user.isEnabled() && (user.getRole() == null || user.getRole().isActive());
    }
}
