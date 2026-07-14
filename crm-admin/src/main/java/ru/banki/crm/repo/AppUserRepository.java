package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.banki.crm.domain.AppUser;

import java.util.Optional;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
}
