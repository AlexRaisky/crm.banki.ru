package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.CommAnalyticsService;
import ru.banki.crm.service.Sections;

import java.util.Map;

/**
 * Аналитика коммуникационной нагрузки: витрины {@code sandbox.t_comm_*} из Greenplum.
 * <p>
 * Только чтение. Право — то же, что на «Общую статистику» ({@code dashboard}): это тот же
 * дашборд, просто на настоящих данных, а не на демо-наборе.
 */
@RestController
@RequestMapping("/api/comm-analytics")
public class CommAnalyticsController {

    private final CommAnalyticsService service;
    private final AccessGuard access;

    public CommAnalyticsController(CommAnalyticsService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        access.requireAnySection(Sections.DASHBOARD);
        return service.config();
    }

    /** Выбрать подключение с витринами. Проверку «только админ» делает сервис. */
    @PutMapping("/config")
    public Map<String, Object> configSet(@RequestBody Map<String, Object> body) {
        access.requireAnySection(Sections.DASHBOARD);
        Object v = body == null ? null : body.get("connectionId");
        Long id = v == null || String.valueOf(v).isBlank() ? null : Long.valueOf(String.valueOf(v));
        service.configSet(id);
        return service.config();
    }

    @GetMapping("/overview")
    public Map<String, Object> overview() {
        access.requireAnySection(Sections.DASHBOARD);
        return service.overview();
    }
}
