package ru.banki.crm.web;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.service.prod.ProdDbService;
import ru.banki.crm.service.prod.ProdSyncService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Прод-БД: проверка соединения и очередь синка (страница /settings, только ADMIN —
 * гарантируется общим правилом /api/admin/** в SecurityConfig).
 */
@RestController
@RequestMapping("/api/admin/prod-db")
public class ProdSyncController {

    private final ProdDbService prod;
    private final ProdSyncService sync;
    private final JdbcTemplate jdbc;

    public ProdSyncController(ProdDbService prod, ProdSyncService sync, JdbcTemplate jdbc) {
        this.prod = prod;
        this.sync = sync;
        this.jdbc = jdbc;
    }

    /** Соединение + наличие таблиц + счётчики очереди. */
    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>(prod.health());
        out.put("queue", sync.stats());
        return out;
    }

    /** Последние записи очереди (по умолчанию — проблемные и ожидающие). */
    @GetMapping("/queue")
    public List<Map<String, Object>> queue(@RequestParam(defaultValue = "50") int limit,
                                           @RequestParam(required = false) String status) {
        String where = (status == null || status.isBlank())
                ? "status IN ('PENDING','ERROR')" : "status = ?";
        String sql = "SELECT id, channel, operation, local_code, prod_code, status, attempts," +
                " left(coalesce(last_error,''), 300) AS last_error, timestamp_cr, timestamp_upd" +
                " FROM app.prod_sync WHERE " + where + " ORDER BY id DESC LIMIT " + Math.min(Math.max(limit, 1), 500);
        return (status == null || status.isBlank())
                ? jdbc.queryForList(sql)
                : jdbc.queryForList(sql, status);
    }

    /** Запустить доставку очереди прямо сейчас (не ждать шедулер). */
    @PostMapping("/process")
    public Map<String, Object> process() {
        int delivered = sync.process(200);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("delivered", delivered);
        out.put("queue", sync.stats());
        return out;
    }

    /** Повторить проблемную запись (сброс попыток). */
    @PostMapping("/retry/{id}")
    public void retry(@PathVariable long id) {
        jdbc.update("UPDATE app.prod_sync SET status = 'PENDING', attempts = 0, last_error = NULL," +
                " timestamp_upd = now() WHERE id = ?", id);
    }
}
