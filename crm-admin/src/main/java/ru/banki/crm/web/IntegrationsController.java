package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.IntegrationsService;
import ru.banki.crm.service.PostmasterService;
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
    private final PostmasterService postmasterService;
    private final AccessGuard access;

    public IntegrationsController(IntegrationsService integrations,
                                  PostmasterService postmasterService,
                                  AccessGuard access) {
        this.integrations = integrations;
        this.postmasterService = postmasterService;
        this.access = access;
    }

    @GetMapping
    public Map<String, Object> map() {
        access.requireAnySection(Sections.SET_DBCONN, Sections.SET_SYNC, Sections.SET_PROCS);
        return integrations.map();
    }

    /* ---------------------------------------------------------- постмастеры

       Доступы к Google и Mail.ru Postmaster — такие же реквизиты подключения, как
       адрес и токен Jira, поэтому живут здесь, а не в разделе «Каналы»: тому, кому
       выдали просмотр цен, токены видеть незачем. Наружу они и не уходят — только
       признак «заполнено» и статус последней проверки. */

    @GetMapping("/postmaster")
    public Map<String, Object> postmaster() {
        access.requireAnySection(Sections.SET_DBCONN);
        return postmasterService.settings();
    }

    @PutMapping("/postmaster")
    public Map<String, Object> savePostmaster(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.SET_DBCONN);
        return postmasterService.saveSettings(body);
    }

    /** Проверка связи: тянем короткий отрезок и показываем, что ответили обе системы. */
    @PostMapping("/postmaster/check")
    public Map<String, Object> checkPostmaster() {
        access.requireCapability(Capability.EDIT, Sections.SET_DBCONN);
        return postmasterService.refresh(3);
    }
}
