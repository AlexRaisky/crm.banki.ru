package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.IntegrationsService;
import ru.banki.crm.service.Sections;

import java.util.Map;

/**
 * Карта интеграций — только чтение. Право то же, что на «Подключения к БД»: карта
 * показывает те же соединения, просто сведёнными в одну картинку, и заводить под неё
 * отдельную секцию значило бы выдавать одно и то же дважды.
 */
@RestController
@RequestMapping("/api/admin/integrations")
public class IntegrationsController {

    private final IntegrationsService integrations;
    private final AccessGuard access;

    public IntegrationsController(IntegrationsService integrations, AccessGuard access) {
        this.integrations = integrations;
        this.access = access;
    }

    @GetMapping
    public Map<String, Object> map() {
        access.requireAnySection(Sections.SET_DBCONN, Sections.SET_SYNC, Sections.SET_PROCS);
        return integrations.map();
    }
}
