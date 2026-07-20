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

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        // SUPER_ADMIN получает и ROLE_ADMIN — все существующие проверки hasRole('ADMIN') работают
        if (user.getRole() == ru.banki.crm.domain.Role.SUPER_ADMIN) {
            return List.of(new SimpleGrantedAuthority("ROLE_SUPER_ADMIN"),
                           new SimpleGrantedAuthority("ROLE_ADMIN"));
        }
        return List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()));
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

    @Override
    public boolean isEnabled() {
        return user.isEnabled();
    }
}
