package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.service.prod.NoticeEtlService;

import java.util.Map;

/**
 * ETL «прод → мы» (актуализация нашей копии шаблонов).
 * ADMIN гарантируется общим правилом /api/admin/** в SecurityConfig.
 */
@RestController
@RequestMapping("/api/admin/etl")
public class EtlController {

    private final NoticeEtlService etl;

    public EtlController(NoticeEtlService etl) {
        this.etl = etl;
    }

    /** Статус: включён ли, идёт ли прогон, водяные знаки по каналам, итоги последнего прогона. */
    @GetMapping("/status")
    public Map<String, Object> status() {
        return etl.status();
    }

    /** Ручной инкремент (то же, что делает планировщик раз в 5 минут). */
    @PostMapping("/run")
    public Map<String, Object> run() {
        return etl.run(false);
    }

    /** Ручной полный прогон (то же, что ночью в 22:00). */
    @PostMapping("/run-full")
    public Map<String, Object> runFull() {
        return etl.run(true);
    }
}
