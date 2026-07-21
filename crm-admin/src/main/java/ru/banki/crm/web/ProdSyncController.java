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

    /** Только счётчики очереди (быстро, без коннекта к проду) — для авто-показа в /settings. */
    @GetMapping("/queue-stats")
    public Map<String, Object> queueStats() {
        return sync.stats();
    }

    /** Последние записи очереди (по умолчанию — проблемные и ожидающие). */
    @GetMapping("/queue")
    public List<Map<String, Object>> queue(@RequestParam(defaultValue = "50") int limit,
                                           @RequestParam(required = false) String status) {
        boolean all = status != null && status.equalsIgnoreCase("all");
        boolean filter = status != null && !status.isBlank() && !all;
        String where = filter ? "status = ?" : (all ? "1=1" : "status IN ('PENDING','ERROR')");
        // source = source_type из payload (jsonb-строка канальной таблицы 1:1)
        String sql = "SELECT id, channel, operation, local_code, prod_code, status, attempts," +
                " payload->>'source_type' AS source," +
                " left(coalesce(last_error,''), 300) AS last_error, timestamp_cr, timestamp_upd" +
                " FROM app.prod_sync WHERE " + where + " ORDER BY id DESC LIMIT " + Math.min(Math.max(limit, 1), 500);
        return filter ? jdbc.queryForList(sql, status) : jdbc.queryForList(sql);
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

    /** Отменить операцию: убрать из очереди (только PENDING/ERROR — доставленные не трогаем). */
    @PostMapping("/cancel/{id}")
    public void cancel(@PathVariable long id) {
        jdbc.update("DELETE FROM app.prod_sync WHERE id = ? AND status IN ('PENDING','ERROR')", id);
    }
}
