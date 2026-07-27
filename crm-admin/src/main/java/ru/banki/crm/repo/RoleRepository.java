package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.banki.crm.domain.Role;

import java.util.List;
import java.util.Optional;

public interface RoleRepository extends JpaRepository<Role, Long> {
    Optional<Role> findByNameIgnoreCase(String name);
    boolean existsByNameIgnoreCase(String name);
    List<Role> findAllByOrderBySortOrderAscNameAsc();
    long countByAdminTrueOrSuperAdminTrue();
}
