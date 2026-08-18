package ru.banki.crm.service.prod;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.util.List;
import java.util.Map;

/**
 * Подключение к базе событий — crmdb (схемы tracker, scheduler, template, commapi).
 * <p>
 * Почему отдельно от {@link ProdDbService}: у шаблонов приёмник ДРУГОЙ — база со схемами
 * notice/callcenter. Обе строки живут в одном реестре app.db_connection и различаются
 * флагами: is_prod_sync у шаблонов, is_event_db у событий. Переиспользовать один флаг
 * нельзя — пометив им crmdb, мы увели бы туда синк шаблонов.
 * <p>
 * Пул пересоздаётся, когда меняется строка подключения: конфигурацию правят в /settings,
 * и держать соединение по старым кредам значит молча работать не с той базой.
 */
@Service
public class EventDbService {

    private static final Logger log = LoggerFactory.getLogger(EventDbService.class);

    private final JdbcTemplate jdbc;
    private volatile HikariDataSource ds;
    private volatile String signature;   // url|user|pass, по которой видно смену настроек

    public EventDbService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record Cfg(String url, String user, String password) {}

    private Cfg config() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT jdbc_url, username, password FROM app.db_connection" +
                " WHERE is_event_db AND is_active LIMIT 1");
        if (rows.isEmpty()) {
            return null;
        }
        Map<String, Object> r = rows.get(0);
        String url = str(r.get("jdbc_url"));
        return url == null ? null : new Cfg(url, str(r.get("username")), str(r.get("password")));
    }

    /** Настроен ли приёмник событий. */
    public boolean configured() {
        return config() != null;
    }

    /** Человекочитаемое состояние для страницы настроек. */
    public Map<String, Object> health() {
        Cfg cfg = config();
        if (cfg == null) {
            return Map.of("configured", false,
                    "message", "Подключение к базе событий не выбрано: /settings → Подключения к БД, галка «база событий».");
        }
        long t0 = System.currentTimeMillis();
        try (Connection c = connection();
             var ps = c.prepareStatement("SELECT 1");
             var rs = ps.executeQuery()) {
            rs.next();
            return Map.of("configured", true, "ok", true,
                    "url", cfg.url(), "latencyMs", System.currentTimeMillis() - t0);
        } catch (Exception e) {
            return Map.of("configured", true, "ok", false,
                    "url", cfg.url(), "error", String.valueOf(e.getMessage()));
        }
    }

    /** Соединение с crmdb. */
    public Connection connection() throws Exception {
        Cfg cfg = config();
        if (cfg == null) {
            throw new IllegalStateException(
                    "База событий (crmdb) не выбрана: /settings → Подключения к БД, галка «база событий»");
        }
        return pool(cfg).getConnection();
    }

    private synchronized HikariDataSource pool(Cfg cfg) {
        String sig = cfg.url() + "|" + cfg.user() + "|" + cfg.password();
        if (ds != null && sig.equals(signature)) {
            return ds;
        }
        if (ds != null) {
            log.info("подключение к базе событий изменилось — пересоздаём пул");
            try { ds.close(); } catch (Exception ignored) { }
        }
        HikariConfig hc = new HikariConfig();
        hc.setJdbcUrl(cfg.url());
        hc.setUsername(cfg.user());
        hc.setPassword(cfg.password());
        hc.setMaximumPoolSize(3);          // импорт и перелив идут поштучно, пул не нужен большой
        hc.setConnectionTimeout(20000);
        hc.setPoolName("crmdb-events");
        ds = new HikariDataSource(hc);
        signature = sig;
        return ds;
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }
}
