package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.HealthService;
import ru.banki.crm.service.Sections;

import java.util.Map;

/**
 * Состояние системы: таблицы, переливы, очередь, подключения, версия.
 * <p>
 * Право то же, что у соседних служебных разделов: кому доступны подключения, синк или
 * выключатель процессов, тому и сводка по ним. Отдельной секции не заводим — страница
 * ничего нового не показывает, она сводит уже доступное в одно место.
 */
@RestController
@RequestMapping("/api/admin/health")
public class HealthController {

    private final HealthService health;
    private final AccessGuard access;

    public HealthController(HealthService health, AccessGuard access) {
        this.health = health;
        this.access = access;
    }

    @GetMapping
    public Map<String, Object> report() {
        access.requireAnySection(Sections.SET_DBCONN, Sections.SET_SYNC, Sections.SET_PROCS, Sections.SET_DIAG);
        return health.report();
    }
}
