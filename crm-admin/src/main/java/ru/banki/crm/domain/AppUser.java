package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.Set;

@Getter
@Setter
@Entity
@Table(name = "users", schema = "app")
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "display_name")
    private String displayName;

    /**
     * Роль учётки. Права ЖИВЫЕ — принадлежат роли (её матрице role_section), а не
     * пользователю: смена/правка роли меняет доступ. Персональной матрицы у пользователя
     * больше нет (таблица user_sections осиротела — резерв под будущие исключения).
     */
    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "role_id", nullable = false)
    private Role role;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "created_at", insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Разделы, которые учётка видит — берутся из её роли. */
    public Set<String> getSections() {
        return role != null ? role.getSections() : Set.of();
    }

    /** Есть ли право cap в разделе sectionId — по матрице роли. */
    public boolean hasCapability(String sectionId, Capability cap) {
        return role != null && role.hasCapability(sectionId, cap);
    }
}
