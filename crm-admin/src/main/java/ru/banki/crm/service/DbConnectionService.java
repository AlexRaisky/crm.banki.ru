package ru.banki.crm.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.prod.ProdDbService;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * Реестр подключений к БД для страницы «Диагностика» (/settings, ADMIN).
 *
 * Пользовательские подключения хранятся в app.db_connection (пароль — в нашей БД,
 * наружу через API не отдаётся). Плюс к списку сервис добавляет два ВСТРОЕННЫХ
 * подключения (read-only): наша БД (спринговый datasource) и внешняя прод-БД (env).
 *
 * «Статус» — результат проверки соединения (SELECT 1 с коротким таймаутом).
 */
@Service
public class DbConnectionService {

    private final JdbcTemplate jdbc;
    private final ProdDbService prod;

    @Value("${spring.datasource.url:}")
    private String ourUrl;
    @Value("${spring.datasource.username:}")
    private String ourUser;
    /** Таймаут разовой проверки соединения, сек (DB_CONN_TEST_TIMEOUT_S). Дефолт как у прод-пула:
     *  канал через бастион/VPN может жать руку дольше 5с. */
    @Value("${app.dbconn.test-timeout-s:20}")
    private int testTimeoutS;

    public DbConnectionService(JdbcTemplate jdbc, ProdDbService prod) {
        this.jdbc = jdbc;
        this.prod = prod;
    }

    // -------------------------------------------------------------------- LIST
    /** Все подключения: сперва встроенные (наша/прод), затем пользовательские. */
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();

        // встроенное: наша БД (проверяем сразу — это локально и мгновенно)
        Map<String, Object> ours = builtin("our-db", "Наша БД (панель)", ourUrl, ourUser,
                "Основная база панели: шаблоны, доступ, очередь синка.");
        Map<String, Object> ourTest = testOurDb();
        ours.putAll(ourTest);
        out.add(ours);

        /* Пользовательские. Приёмников тут ДВА и они разные: is_prod_sync — база
           шаблонов (схемы notice/callcenter), is_event_db — база событий crmdb
           (tracker/scheduler/template/commapi). Один флаг на оба не годится. */
        out.addAll(jdbc.query(
                "SELECT id, name, jdbc_url, username, (password IS NOT NULL AND password <> '') AS has_pw, " +
                "       purpose, is_active, is_prod_sync, is_event_db, last_status, last_error, last_latency_ms, last_checked_at " +
                "FROM app.db_connection ORDER BY is_prod_sync DESC, is_event_db DESC, name",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("builtin", false);
                    m.put("readOnly", false);
                    m.put("name", rs.getString("name"));
                    m.put("jdbcUrl", rs.getString("jdbc_url"));
                    m.put("username", rs.getString("username"));
                    m.put("hasPassword", rs.getBoolean("has_pw"));
                    m.put("purpose", rs.getString("purpose"));
                    m.put("active", rs.getBoolean("is_active"));
                    m.put("prodSync", rs.getBoolean("is_prod_sync"));
                    m.put("eventDb", rs.getBoolean("is_event_db"));
                    m.put("status", rs.getString("last_status"));
                    m.put("error", rs.getString("last_error"));
                    Object lat = rs.getObject("last_latency_ms");
                    m.put("latencyMs", lat);
                    Object ch = rs.getObject("last_checked_at");
                    m.put("checkedAt", ch == null ? null : String.valueOf(ch));
                    return m;
                }));
        return out;
    }

    private Map<String, Object> builtin(String id, String name, String url, String user, String purpose) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("builtin", true);
        m.put("readOnly", true);
        m.put("name", name);
        m.put("jdbcUrl", url);
        m.put("username", user);
        m.put("hasPassword", true);
        m.put("purpose", purpose);
        m.put("active", true);
        return m;
    }

    // --------------------------------------------------------------------- CRUD
    public Map<String, Object> add(Map<String, Object> body) {
        String name = str(body.get("name"));
        String url = str(body.get("jdbcUrl"));
        if (name.isEmpty() || url.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нужны имя и JDBC URL.");
        }
        if (!url.startsWith("jdbc:")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "JDBC URL должен начинаться с jdbc:");
        }
        Integer exists = jdbc.queryForObject(
                "SELECT count(*) FROM app.db_connection WHERE name = ?", Integer.class, name);
        if (exists != null && exists > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Подключение с таким именем уже есть: " + name);
        }
        boolean prodSync = truthy(body.get("prodSync"));
        boolean eventDb = truthy(body.get("eventDb"));
        if (prodSync) jdbc.update("UPDATE app.db_connection SET is_prod_sync = false WHERE is_prod_sync");
        if (eventDb) jdbc.update("UPDATE app.db_connection SET is_event_db = false WHERE is_event_db");
        jdbc.update(
                "INSERT INTO app.db_connection (name, jdbc_url, username, password, purpose, is_active, is_prod_sync, is_event_db, created_by) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                name, url, nullIfEmpty(str(body.get("username"))),
                nullIfEmpty(str(body.get("password"))), nullIfEmpty(str(body.get("purpose"))),
                body.get("active") == null || Boolean.parseBoolean(String.valueOf(body.get("active"))),
                prodSync, eventDb, CurrentUser.email());
        Long id = jdbc.queryForObject("SELECT id FROM app.db_connection WHERE name = ?", Long.class, name);
        return Map.of("id", id);
    }

    public void update(long id, Map<String, Object> body) {
        // пароль обновляем только если явно прислан (иначе оставляем старый)
        boolean setPw = body.containsKey("password") && !str(body.get("password")).isEmpty();
        boolean prodSync = truthy(body.get("prodSync"));
        boolean eventDb = truthy(body.get("eventDb"));
        // приёмник каждого вида только один — снимаем флаг с остальных перед установкой
        if (prodSync) jdbc.update("UPDATE app.db_connection SET is_prod_sync = false WHERE is_prod_sync AND id <> ?", id);
        if (eventDb) jdbc.update("UPDATE app.db_connection SET is_event_db = false WHERE is_event_db AND id <> ?", id);
        boolean active = body.get("active") == null || Boolean.parseBoolean(String.valueOf(body.get("active")));
        List<Object> args = new ArrayList<>();   // ArrayList допускает null (List.of — нет)
        args.add(nullIfEmpty(str(body.get("name"))));      // COALESCE(?, name): null → оставить старое
        args.add(nullIfEmpty(str(body.get("jdbcUrl"))));   // COALESCE(?, jdbc_url)
        args.add(nullIfEmpty(str(body.get("username"))));
        args.add(nullIfEmpty(str(body.get("purpose"))));
        args.add(active);
        args.add(prodSync);
        args.add(eventDb);
        String sql = "UPDATE app.db_connection SET name = COALESCE(?, name), jdbc_url = COALESCE(?, jdbc_url), " +
                "  username = ?, purpose = ?, is_active = ?, is_prod_sync = ?, is_event_db = ?" + (setPw ? ", password = ?" : "") + " WHERE id = ?";
        if (setPw) args.add(str(body.get("password")));
        args.add(id);
        jdbc.update(sql, args.toArray());
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM app.db_connection WHERE id = ?", id);
    }

    // --------------------------------------------------------------------- TEST
    /** Проверка одного подключения по его id (число — из реестра, "our-db" — встроенное). */
    public Map<String, Object> test(String id) {
        if ("our-db".equals(id)) return testOurDb();
        long lid;
        try { lid = Long.parseLong(id); }
        catch (NumberFormatException e) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Нет подключения: " + id); }

        Map<String, Object> row;
        try {
            row = jdbc.queryForMap(
                    "SELECT jdbc_url, username, password, is_prod_sync FROM app.db_connection WHERE id = ?", lid);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Нет подключения: " + id);
        }
        // прод-приёмник проверяем через его собственный пул (бастион-таймауты), остальное — разовым коннектом
        Map<String, Object> res = Boolean.TRUE.equals(row.get("is_prod_sync"))
                ? testProdDb()
                : testJdbc(str(row.get("jdbc_url")), str(row.get("username")), str(row.get("password")));
        Object lat = res.get("latencyMs");
        Integer latInt = (lat instanceof Number) ? ((Number) lat).intValue() : null;
        jdbc.update(
                "UPDATE app.db_connection SET last_status = ?, last_error = ?, last_latency_ms = ?, last_checked_at = now() WHERE id = ?",
                res.get("status"), res.get("error"), latInt, lid);
        return res;
    }

    /** Проверить все и вернуть свежий список. Пользовательские тестируем параллельно. */
    public List<Map<String, Object>> testAll() {
        List<Long> ids = jdbc.queryForList("SELECT id FROM app.db_connection", Long.class);
        ids.parallelStream().forEach(id -> {
            try { test(String.valueOf(id)); } catch (Exception ignore) {}
        });
        return list();
    }

    // ---- встроенные проверки
    private Map<String, Object> testOurDb() {
        Map<String, Object> r = new LinkedHashMap<>();
        long t0 = System.currentTimeMillis();
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
            r.put("status", "OK");
            r.put("latencyMs", System.currentTimeMillis() - t0);
        } catch (Exception e) {
            r.put("status", "ERROR");
            r.put("error", e.getMessage());
        }
        return r;
    }

    private Map<String, Object> testProdDb() {
        Map<String, Object> r = new LinkedHashMap<>();
        if (!prod.configured()) {
            r.put("status", "OFF");
            r.put("error", "Приёмник синка не активен.");
            return r;
        }
        Map<String, Object> h = prod.health();
        boolean reachable = Boolean.TRUE.equals(h.get("reachable"));
        r.put("status", reachable ? "OK" : "ERROR");
        if (h.get("latencyMs") != null) r.put("latencyMs", h.get("latencyMs"));
        if (!reachable) r.put("error", String.valueOf(h.getOrDefault("cause", h.get("error"))));
        return r;
    }

    /** Одноразовый коннект с коротким таймаутом (без пула): SELECT 1, замер latency. */
    private Map<String, Object> testJdbc(String url, String user, String pass) {
        Map<String, Object> r = new LinkedHashMap<>();
        long t0 = System.currentTimeMillis();
        Properties props = new Properties();
        if (!str(user).isEmpty()) props.setProperty("user", user);
        if (!str(pass).isEmpty()) props.setProperty("password", pass);
        // PostgreSQL-драйвер понимает эти свойства (секунды); прочие драйверы их игнорируют.
        int t = testTimeoutS > 0 ? testTimeoutS : 20;
        props.setProperty("connectTimeout", String.valueOf(t));
        props.setProperty("socketTimeout", String.valueOf(t + 5));
        props.setProperty("loginTimeout", String.valueOf(t));
        int prev = DriverManager.getLoginTimeout();
        try {
            DriverManager.setLoginTimeout(t + 1);
            try (Connection c = DriverManager.getConnection(url, props);
                 PreparedStatement ps = c.prepareStatement("SELECT 1");
                 ResultSet rs = ps.executeQuery()) {
                rs.next();
                r.put("status", "OK");
                r.put("latencyMs", (int) (System.currentTimeMillis() - t0));
            }
        } catch (Exception e) {
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) root = root.getCause();
            String msg = root.getMessage() != null ? root.getMessage() : e.getMessage();
            r.put("status", "ERROR");
            r.put("error", msg);
            r.put("latencyMs", (int) (System.currentTimeMillis() - t0));
        } finally {
            DriverManager.setLoginTimeout(prev);
        }
        return r;
    }

    // ---- helpers
    private static String str(Object o) { return o == null ? "" : String.valueOf(o).trim(); }
    private static String nullIfEmpty(String s) { return (s == null || s.isEmpty()) ? null : s; }
    private static boolean truthy(Object o) { return o != null && Boolean.parseBoolean(String.valueOf(o)); }
}
