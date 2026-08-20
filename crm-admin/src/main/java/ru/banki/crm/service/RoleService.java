package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.Role;
import ru.banki.crm.domain.SectionAccess;
import ru.banki.crm.dto.RoleDtos.RoleView;
import ru.banki.crm.dto.RoleDtos.SaveRole;
import ru.banki.crm.dto.UserDtos.SectionAccessDto;
import ru.banki.crm.repo.AppUserRepository;
import ru.banki.crm.repo.RoleRepository;

import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Роли-справочник. Права ЖИВЫЕ: правка матрицы роли меняет всех её носителей. Создавать
 * и править обычные роли может любой админ (контроллер под /api/admin/**), а роли с
 * админ-флагом — только супер-админ. Встроенные роли (is_system) переименовывать/удалять
 * нельзя; супер-роль неприкосновенна.
 */
@Service
public class RoleService {

    private final RoleRepository roles;
    private final AppUserRepository users;

    public RoleService(RoleRepository roles, AppUserRepository users) {
        this.roles = roles;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public List<RoleView> list() {
        // Супер-роль не показываем в управлении ролями НИКОМУ (в т.ч. супер-админу):
        // она остаётся в БД и работает, просто скрыта из списка.
        return roles.findAllByOrderBySortOrderAscNameAsc().stream()
                .filter(r -> !r.isSuperAdmin())
                .map(this::toView)
                .toList();
    }

    @Transactional
    public RoleView create(SaveRole req) {
        String name = req.name().trim();
        if (name.isEmpty()) throw badRequest("Укажите название роли");
        if (roles.existsByNameIgnoreCase(name)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Роль с таким названием уже есть");
        if (req.isAdmin()) requireSuperAdmin();   // админ-роль создаёт только супер-админ
        Role r = new Role();
        r.setName(name);
        r.setAdmin(req.isAdmin());
        r.setSuperAdmin(false);
        r.setSystem(false);
        r.setSortOrder(nextSortOrder());
        r.setSectionAccess(buildAccess(req.access(), req.isAdmin()));
        return toView(roles.save(r));
    }

    @Transactional
    public RoleView update(Long id, SaveRole req) {
        Role r = get(id);
        if (r.isSuperAdmin()) throw forbidden();   // супер-роль не трогаем
        // Менять админ-флаг (в любую сторону) может только супер-админ.
        if (req.isAdmin() != r.isAdmin()) requireSuperAdmin();
        // Управлять админ-ролью может только супер-админ.
        if (r.isAdminLevel() && !currentIsSuperAdmin()) throw forbidden();

        String name = req.name().trim();
        if (name.isEmpty()) throw badRequest("Укажите название роли");
        if (!r.isSystem()) {   // встроенную роль не переименовываем
            roles.findByNameIgnoreCase(name)
                    .filter(other -> !other.getId().equals(r.getId()))
                    .ifPresent(o -> { throw new ResponseStatusException(HttpStatus.CONFLICT, "Роль с таким названием уже есть"); });
            r.setName(name);
        }
        r.setAdmin(req.isAdmin());
        r.setSectionAccess(buildAccess(req.access(), req.isAdmin()));
        return toView(roles.save(r));
    }

    /**
     * Включить или отключить роль — замена удалению.
     * <p>
     * Удалить роль можно было только пока ею никто не пользуется и она не встроенная, то
     * есть практически никогда. Деактивация решает ту же задачу и ничего не теряет: роль
     * остаётся в справочнике вместе со своей матрицей, но новым учёткам не назначается,
     * а её носители в панель не пускаются (проверка на входе, рядом с «учётка выключена»).
     * <p>
     * Встроенность деактивации НЕ мешает: «Маркетолог» может стать ненужным ровно так же,
     * как заведённая руками роль. А вот запереть себя снаружи нельзя: супер-роль не
     * отключается вовсе, и последнюю активную админ-роль тоже не отдадим — иначе управлять
     * доступом станет некому.
     */
    @Transactional
    public RoleView setActive(Long id, boolean active) {
        Role r = get(id);
        if (r.isSuperAdmin()) throw forbidden();
        if (r.isAdminLevel() && !currentIsSuperAdmin()) throw forbidden();
        if (!active && r.isAdminLevel()) {
            long liveAdmins = roles.findAll().stream()
                    .filter(x -> x.isAdminLevel() && x.isActive() && !x.getId().equals(r.getId()))
                    .count();
            if (liveAdmins == 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Это последняя активная админ-роль — отключив её, управлять доступом будет некому");
            }
        }
        r.setActive(active);
        return toView(roles.save(r));
    }

    @Transactional
    public void delete(Long id) {
        Role r = get(id);
        if (r.isSystem()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Встроенную роль удалить нельзя");
        if (r.isAdminLevel() && !currentIsSuperAdmin()) throw forbidden();
        long assigned = users.findAll().stream().filter(u -> u.getRole().getId().equals(r.getId())).count();
        if (assigned > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Роль назначена пользователям (" + assigned + ") — сначала переведите их на другую роль");
        }
        roles.delete(r);
    }

    // ------------------------------------------------------------------ helpers
    private Role get(Long id) {
        return roles.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Роль не найдена"));
    }

    private int nextSortOrder() {
        return roles.findAll().stream().mapToInt(Role::getSortOrder).max().orElse(100) + 10;
    }

    private boolean currentIsSuperAdmin() {
        return ru.banki.crm.security.CurrentUser.principal()
                .map(p -> p.user().getRole().isSuperAdmin())
                .orElse(false);
    }

    private void requireSuperAdmin() {
        if (!currentIsSuperAdmin()) throw forbidden();
    }

    private static ResponseStatusException forbidden() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Недостаточно прав для этой операции");
    }
    private static ResponseStatusException badRequest(String m) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, m);
    }

    /** Собрать матрицу роли. У витрин (не-writable) add/edit/delete гасим. Админ-роль
     *  обходит матрицу — ей проставляем всё для показа. Строку заводим при наличии read. */
    private Set<SectionAccess> buildAccess(List<SectionAccessDto> access, boolean adminRole) {
        Set<SectionAccess> out = new HashSet<>();
        for (String s : Sections.ALL) {
            if (adminRole) { out.add(new SectionAccess(s, true, true, true, true)); continue; }
            SectionAccessDto a = find(access, s);
            if (a == null) continue;
            boolean read = a.read() || a.add() || a.edit() || a.delete();
            if (!read) continue;
            boolean w = Sections.isWritable(s);
            out.add(new SectionAccess(s, true, w && a.add(), w && a.edit(), w && a.delete()));
        }
        /* Секции сущностей (ent:client) в Sections.ALL не лежат: их список задаёт схема,
           а не константа. Поэтому проходим ещё раз по присланному — иначе матрица
           показывала бы галки, а сохранение молча их выбрасывало. Права на запись у них
           нет: данные сущностей пока живут в браузере, и обещать их защиту нечестно. */
        if (!adminRole && access != null) {
            for (SectionAccessDto a : access) {
                if (!Sections.isEntity(a.section())) continue;
                if (!(a.read() || a.add() || a.edit() || a.delete())) continue;
                out.add(new SectionAccess(a.section(), true, false, false, false));
            }
        }
        return out;
    }

    private static SectionAccessDto find(List<SectionAccessDto> access, String section) {
        if (access == null) return null;
        for (SectionAccessDto a : access) if (section.equals(a.section())) return a;
        return null;
    }

    /** Роль-прикрытие, под которую маскируются супер-админы: «Админ», иначе первая
     *  обычная админ-роль по порядку (та же логика, что в UserService.coverRoleName). */
    private boolean isCoverRole(Role r) {
        Role cover = roles.findByNameIgnoreCase("Админ").orElseGet(() ->
                roles.findAll().stream()
                        .filter(x -> x.isAdmin() && !x.isSuperAdmin())
                        .min(Comparator.comparingInt(Role::getSortOrder))
                        .orElse(null));
        return cover != null && cover.getId().equals(r.getId());
    }

    private RoleView toView(Role r) {
        List<SectionAccessDto> access = r.getSectionAccess().stream()
                .map(sa -> new SectionAccessDto(sa.getSectionId(), sa.isCanRead(),
                        sa.isCanAdd(), sa.isCanEdit(), sa.isCanDelete()))
                .sorted(Comparator.comparing(SectionAccessDto::section))
                .toList();
        long userCount = users.findAll().stream().filter(u -> u.getRole().getId().equals(r.getId())).count();
        // Супер-роль скрыта, а её носители везде показаны как обычный «Админ» (роль-прикрытие).
        // Чтобы счётчик учёток совпадал с тем, что видно в списке пользователей, добавляем
        // супер-админов к роли-прикрытию.
        if (isCoverRole(r)) {
            userCount += users.findAll().stream().filter(u -> u.getRole().isSuperAdmin()).count();
        }
        // Править/удалять можно, если роль не встроенная-неприкосновенная и не выше прав текущего:
        // супер-роль — никогда; админ-роль — только супер-админ.
        boolean manageable = !r.isSuperAdmin() && (!r.isAdminLevel() || currentIsSuperAdmin());
        return new RoleView(r.getId(), r.getName(), r.isAdmin(), r.isSuperAdmin(),
                r.isSystem(), access, manageable, userCount, r.isActive());
    }
}
