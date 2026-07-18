package ru.banki.crm.service.prod;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ru.banki.crm.service.UnifiedTemplateService;
import ru.banki.crm.service.UnifiedTemplateService.ChannelTable;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Подключение к ВНЕШНЕЙ прод-БД (схемы notice/callcenter, таблицы 1:1 с нашими)
 * и доставка операций очереди app.prod_sync.
 *
 * Собственный маленький Hikari-пул (НЕ спринговый бин DataSource — чтобы не мешать
 * автоконфигурации основной БД). Прод не настроен (PROD_DB_URL пуст) — сервис пассивен.
 *
 * Коды при INSERT назначает прод (max+1 в его транзакции, как делала старая админка);
 * исключение — КЦ: segment бизнес-ключ и едет как есть.
 */
@Service
public class ProdDbService {

    @Value("${app.proddb.url:}")
    private String url;
    @Value("${app.proddb.user:}")
    private String user;
    @Value("${app.proddb.password:}")
    private String password;

    private final ObjectMapper om;
    private volatile HikariDataSource ds;

    public ProdDbService(ObjectMapper om) {
        this.om = om;
    }

    public boolean configured() {
        return url != null && !url.isBlank();
    }

    private HikariDataSource ds() {
        HikariDataSource local = ds;
        if (local == null) {
            synchronized (this) {
                if (ds == null) {
                    HikariConfig cfg = new HikariConfig();
                    cfg.setJdbcUrl(url);
                    cfg.setUsername(user);
                    cfg.setPassword(password);
                    cfg.setMaximumPoolSize(2);
                    cfg.setMinimumIdle(0);
                    cfg.setConnectionTimeout(5000);
                    cfg.setInitializationFailTimeout(-1); // пул создаётся даже при недоступном проде
                    cfg.setPoolName("prod-db");
                    ds = new HikariDataSource(cfg);
                }
                local = ds;
            }
        }
        return local;
    }

    // ---------------------------------------------------------------- health
    /** Проверка соединения: коннект, latency, наличие 4 канальных таблиц. */
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("configured", configured());
        if (!configured()) {
            out.put("hint", "Задай PROD_DB_URL / PROD_DB_USER / PROD_DB_PASSWORD в .env");
            return out;
        }
        long t0 = System.currentTimeMillis();
        try (Connection c = ds().getConnection()) {
            try (PreparedStatement ps = c.prepareStatement("SELECT 1"); ResultSet rs = ps.executeQuery()) {
                rs.next();
            }
            out.put("reachable", true);
            out.put("latencyMs", System.currentTimeMillis() - t0);
            Map<String, Boolean> tables = new LinkedHashMap<>();
            for (String ch : List.of("sms", "push", "email", "cc")) {
                ChannelTable ct = UnifiedTemplateService.channelTable(ch);
                String[] st = ct.table().split("\\.");
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT count(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = ?")) {
                    ps.setString(1, st[0]);
                    ps.setString(2, st[1]);
                    try (ResultSet rs = ps.executeQuery()) {
                        rs.next();
                        tables.put(ct.table(), rs.getInt(1) > 0);
                    }
                }
            }
            out.put("tables", tables);
        } catch (Exception e) {
            out.put("reachable", false);
            out.put("error", String.valueOf(e.getMessage()));
        }
        return out;
    }

    // ---------------------------------------------------------------- deliver
    /**
     * Применить одну операцию очереди к прод-БД. Возвращает код строки в проде
     * (для INSERT — присвоенный продом; для UPDATE/DELETE — переданный localCode).
     */
    public long apply(String channel, String operation, long localCode, String payloadJson) throws Exception {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) throw new IllegalArgumentException("Неизвестный канал: " + channel);
        try (Connection c = ds().getConnection()) {
            c.setAutoCommit(false);
            try {
                long result = switch (operation) {
                    case "INSERT" -> insert(c, ct, localCode, payloadJson);
                    case "UPDATE" -> {
                        int n = update(c, ct, localCode, payloadJson);
                        // строки в проде нет (исторически не доехала) — превращаем в INSERT
                        yield n > 0 ? localCode : insert(c, ct, localCode, payloadJson);
                    }
                    case "DELETE" -> {
                        try (PreparedStatement ps = c.prepareStatement(
                                "DELETE FROM " + ct.table() + " WHERE " + ct.codeCol() + " = ?")) {
                            ps.setLong(1, localCode);
                            ps.executeUpdate();
                        }
                        yield localCode;
                    }
                    default -> throw new IllegalArgumentException("Неизвестная операция: " + operation);
                };
                c.commit();
                return result;
            } catch (Exception e) {
                c.rollback();
                throw e;
            }
        }
    }

    /** INSERT: id и код — max+1 прод-таблицы (кроме cc: segment из payload). */
    private long insert(Connection c, ChannelTable ct, long localCode, String payloadJson) throws Exception {
        long newId = maxPlusOne(c, ct.table(), "id");
        long code;
        if ("id".equals(ct.codeCol())) {
            code = newId;                                   // email: код = id
        } else if (ct.prodAssignsCode()) {
            code = maxPlusOne(c, ct.table(), ct.codeCol()); // sms/push: code = max(code)+1
        } else {
            code = localCode;                               // cc: segment как есть
        }
        // типы конвертирует сам Postgres: jsonb_populate_record по структуре прод-таблицы
        String sql = "INSERT INTO " + ct.table() +
                " SELECT * FROM jsonb_populate_record(NULL::" + ct.table() + "," +
                " (?::jsonb || jsonb_build_object('id', ?::bigint, '" + ct.codeCol() + "', ?::bigint)))";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, payloadJson);
            ps.setLong(2, newId);
            ps.setLong(3, code);
            ps.executeUpdate();
        }
        return code;
    }

    /** UPDATE по бизнес-коду: SET-список из ключей payload (кроме id и кода). */
    private int update(Connection c, ChannelTable ct, long localCode, String payloadJson) throws Exception {
        JsonNode payload = om.readTree(payloadJson);
        List<String> cols = new ArrayList<>();
        for (Iterator<String> it = payload.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if ("id".equals(k) || ct.codeCol().equals(k)) continue;
            if (!k.matches("[a-z_][a-z0-9_]*")) {
                throw new IllegalArgumentException("Недопустимая колонка payload: " + k);
            }
            cols.add(k);
        }
        if (cols.isEmpty()) return 0;
        StringBuilder set = new StringBuilder();
        for (String k : cols) {
            if (set.length() > 0) set.append(", ");
            set.append(k).append(" = p.").append(k);
        }
        String sql = "UPDATE " + ct.table() + " t SET " + set +
                " FROM (SELECT * FROM jsonb_populate_record(NULL::" + ct.table() + ", ?::jsonb)) p" +
                " WHERE t." + ct.codeCol() + " = ?";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, payloadJson);
            ps.setLong(2, localCode);
            return ps.executeUpdate();
        }
    }

    private static long maxPlusOne(Connection c, String table, String col) throws Exception {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT COALESCE(MAX(" + col + "), 0) + 1 FROM " + table);
             ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }
}
