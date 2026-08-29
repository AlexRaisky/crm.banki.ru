package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.cron.CronService;

import java.util.Map;

/**
 * Подключение к планировщику crm-cron.
 * <p>
 * Ручек три и все безобидные: прочитать настройки, сохранить их, проверить связь.
 * Действий над заданиями Quartz здесь пока нет намеренно — сначала убеждаемся, что
 * панель дотягивается до сервиса и чем аутентифицируется.
 */
@RestController
@RequestMapping("/api/cron")
public class CronController {

    private final CronService service;
    private final AccessGuard access;

    public CronController(CronService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    @GetMapping("/settings")
    public Map<String, Object> settings() {
        access.requireCapability(Capability.READ, Sections.SET_CRON);
        return service.settings();
    }

    @PutMapping("/settings")
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.SET_CRON);
        return service.save(body);
    }

    /**
     * Проверка связи. POST, а не GET: она ходит наружу и записывает результат в
     * app.cron_connection — то есть меняет состояние, и повторять её обновлением
     * страницы или предзагрузкой ссылки было бы неправильно.
     */
    @PostMapping("/check")
    public Map<String, Object> check() {
        access.requireCapability(Capability.EDIT, Sections.SET_CRON);
        return service.check();
    }
}
