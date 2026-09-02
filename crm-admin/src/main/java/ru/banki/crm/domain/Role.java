package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Роль как данные. Раньше это было перечисление; теперь запись справочника app.role со
 * своими флагами и собственной матрицей прав по разделам (app.role_section). Права ЖИВЫЕ:
 * принадлежат роли, все её носители делят один набор — правка роли меняет всех.
 * <ul>
 *   <li>{@code admin} — админ-полномочия (управление доступом) и обход матрицы;</li>
 *   <li>{@code superAdmin} — может всё; выдаётся только учётке из ADMIN_EMAIL;</li>
 *   <li>{@code system} — встроенная роль: удалять/переименовывать нельзя.</li>
 * </ul>
 */
@Getter
@Setter
@Entity
@Table(name = "role", schema = "app")
public class Role {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;

    @Column(name = "is_admin", nullable = false)
    private boolean admin;

    @Column(name = "is_super_admin", nullable = false)
    private boolean superAdmin;

    @Column(name = "is_system", nullable = false)
    private boolean system;

    /** Роль активна. Неактивная остаётся в справочнике, но входить её носители не могут
     *  и новым учёткам она не назначается — это замена удалению, которое было доступно
     *  только для роли без единого носителя. */
    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 100;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "role_section", schema = "app",
            joinColumns = @JoinColumn(name = "role_id"))
    private Set<SectionAccess> sectionAccess = new HashSet<>();

    /** Полномочия администратора: и обычный админ, и супер-админ. */
    public boolean isAdminLevel() {
        return admin || superAdmin;
    }

    /** Разделы, которые роль видит (canRead) — для NAV и проверок видимости. */
    public Set<String> getSections() {
        return sectionAccess.stream()
                .filter(SectionAccess::isCanRead)
                .map(SectionAccess::getSectionId)
                .collect(Collectors.toUnmodifiableSet());
    }

    /** Есть ли у роли право cap в разделе sectionId. */
    public boolean hasCapability(String sectionId, Capability cap) {
        for (SectionAccess sa : sectionAccess) {
            if (sa.getSectionId().equals(sectionId)) {
                return sa.has(cap);
            }
        }
        return false;
    }
}
