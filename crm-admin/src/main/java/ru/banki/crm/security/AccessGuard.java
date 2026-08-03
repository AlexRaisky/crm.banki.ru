package ru.banki.crm.security;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.Capability;

/**
 * Проверки прав на разделы. Раньше право задавала одна роль на всю учётку; теперь у
 * каждой пары «пользователь × раздел» свои флаги (read/add/edit/delete), и глагол проверяем
 * отдельно. Админ обходит матрицу — {@link ru.banki.crm.domain.Role#isAdminLevel()}.
 */
@Component
public class AccessGuard {

    /** Видимость раздела (read): 403, если ни у одного из разделов нет права READ. */
    public void requireAnySection(String... sectionIds) {
        requireCapability(Capability.READ, sectionIds);
    }

    /**
     * Право cap хотя бы в одном из разделов. Несколько разделов — потому что одни и те же
     * данные бывают за двумя разделами (шаблоны: admin — мастер, templates — список), и
     * право на операцию достаточно иметь в любом из них. 403 при отсутствии.
     */
    /**
     * То же право, но ответом, а не исключением: нужно там, где по правам не запрещают
     * запрос целиком, а фильтруют его результат. Пример — список подключений отчётов:
     * каждый отчёт стал своей секцией, и отдавать в браузер конфиги тех, которых
     * пользователю не видно, нельзя (прямая ссылка осталась бы рабочей).
     */
    public boolean can(Capability cap, String sectionId) {
        return CurrentUser.principal()
                .map(p -> p.user().getRole().isAdminLevel() || p.hasCapability(sectionId, cap))
                .orElse(false);
    }

    public void requireCapability(Capability cap, String... sectionIds) {
        AppUserPrincipal p = CurrentUser.principal()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Не авторизован"));
        // isAdminLevel(), а не == ADMIN: супер-админ полномочнее админа. Админ обходит матрицу
        // целиком — иначе разделы, добавленные ПОСЛЕ создания учётки, ему были бы недоступны.
        if (p.user().getRole().isAdminLevel()) {
            return;
        }
        for (String s : sectionIds) {
            if (p.hasCapability(s, cap)) {
                return;
            }
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Нет доступа к разделу");
    }
}
