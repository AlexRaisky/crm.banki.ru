package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role = Role.READER;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "created_at", insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    /**
     * Права на разделы: по строке на каждый доступный раздел с флагами read/add/edit/delete.
     * Заменяет прежний Set&lt;String&gt; (раздел виден / не виден). Набор всегда заменяют
     * целиком (см. {@link SectionAccess}) — не мутируют элементы на месте.
     */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_sections", schema = "app",
            joinColumns = @JoinColumn(name = "user_id"))
    private Set<SectionAccess> sectionAccess = new HashSet<>();

    /** Разделы, которые учётка видит (canRead) — для NAV и проверок видимости. */
    public Set<String> getSections() {
        return sectionAccess.stream()
                .filter(SectionAccess::isCanRead)
                .map(SectionAccess::getSectionId)
                .collect(Collectors.toUnmodifiableSet());
    }

    /** Есть ли у учётки право cap в разделе sectionId. */
    public boolean hasCapability(String sectionId, Capability cap) {
        for (SectionAccess sa : sectionAccess) {
            if (sa.getSectionId().equals(sectionId)) {
                return sa.has(cap);
            }
        }
        return false;
    }
}
