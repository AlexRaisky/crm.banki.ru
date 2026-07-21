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

    /** Таймаут установления соединения, мс (PROD_DB_CONNECT_TIMEOUT_MS). */
    @Value("${app.proddb.connect-timeout-ms:20000}")
    private long connectTimeoutMs;

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
                    // канал до прода может идти через бастион/VPN — даём запас на рукопожатие
                    cfg.setConnectionTimeout(connectTimeoutMs);
                    cfg.addDataSourceProperty("connectTimeout", String.valueOf(connectTimeoutMs / 1000));
                    cfg.addDataSourceProperty("loginTimeout", String.valueOf(connectTimeoutMs / 1000));
                    cfg.addDataSourceProperty("socketTimeout", "60");
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
            for (String ch : List.of("sms", "push", "email", "cc", "fa", "vk", "la")) {
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
            // у Hikari верхнее сообщение — «request timed out»; настоящая причина в cause
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) root = root.getCause();
            out.put("error", String.valueOf(e.getMessage()));
            if (root != e && root.getMessage() != null) out.put("cause", root.getMessage());
            out.put("url", url);
            out.put("user", user);
        }
        return out;
    }

    // ---------------------------------------------------------------- deliver
    /**
     * Применить одну операцию очереди к прод-БД. Возвращает код строки в проде
     * (для INSERT — присвоенный продом; для UPDATE/DELETE — переданный localCode).
     */
    public long apply(String channel, String operation, long localCode, String payloadJson, String actor) throws Exception {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) throw new IllegalArgumentException("Неизвестный канал: " + channel);
        try (Connection c = ds().getConnection()) {
            c.setAutoCommit(false);
            try {
                markActor(c, actor);   // прод-триггеры аудита читают app.current_user
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

    /**
     * Прокидывает актёра в сессионную переменную app.current_user на прод-соединении,
     * чтобы BEFORE-триггеры аудита записали в log.t_admin_log реального пользователя
     * (аналог set_config('app.current_user', ...) из старой Appsmith-админки).
     * is_local=true — значение живёт только до конца ЭТОЙ транзакции: пул переиспользует
     * соединение, но в следующую операцию чужой актёр не утечёт.
     * В лог кладём логин без домена: split_part(email, '@', 1).
     */
    private static void markActor(Connection c, String actor) throws Exception {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT set_config('app.current_user', split_part(COALESCE(?, ''), '@', 1), true)")) {
            ps.setString(1, actor);
            ps.executeQuery();
        }
    }

    /**
     * INSERT: id и код выдаёт прод (max+1). Правила нумерации:
     *  sms / email — в диапазоне до 10000 (ct.codeLimit), push — сквозной счётчик,
     *  cc — id по счётчику, а segment приходит из формы как есть.
     */
    private long insert(Connection c, ChannelTable ct, long localCode, String payloadJson) throws Exception {
        long code;
        long newId;
        if ("id".equals(ct.codeCol())) {
            newId = maxPlusOne(c, ct.table(), "id", ct.codeLimit());  // email: код = id
            code = newId;
        } else {
            newId = maxPlusOne(c, ct.table(), "id", null);            // суррогатный id — без ограничения
            code = ct.prodAssignsCode()
                    ? maxPlusOne(c, ct.table(), ct.codeCol(), ct.codeLimit())
                    : localCode;                                     // cc: segment как есть
        }
        if (ct.codeLimit() != null && code >= ct.codeLimit()) {
            throw new IllegalStateException("Свободные коды в диапазоне до " + ct.codeLimit()
                    + " закончились для " + ct.table());
        }
        // Явно перечисляем ТОЛЬКО заполненные колонки: остальные получат дефолты прод-таблицы
        // (передача явного NULL перебила бы DEFAULT и упала на NOT NULL).
        JsonNode parsed = om.readTree(payloadJson);
        // подстраховка для записей, уже стоявших в очереди: обязательные поля прода
        if (parsed instanceof com.fasterxml.jackson.databind.node.ObjectNode on) {
            UnifiedTemplateService.prodDefaults(channelOf(ct)).forEach((k, v) -> {
                if (!on.hasNonNull(k)) on.put(k, v);
            });
            payloadJson = on.toString();
        }
        JsonNode payload = parsed;
        java.util.Set<String> prodCols = tableColumns(c, ct.table());
        List<String> cols = new ArrayList<>();
        for (Iterator<String> it = payload.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if ("id".equals(k) || ct.codeCol().equals(k)) continue;
            if (!k.matches("[a-z_][a-z0-9_]*") || !prodCols.contains(k)) continue;
            if (payload.get(k) == null || payload.get(k).isNull()) continue;
            cols.add(k);
        }
        // у email бизнес-код и есть id — колонку нельзя перечислять дважды
        boolean codeIsId = "id".equals(ct.codeCol());
        StringBuilder colList = new StringBuilder("id");
        StringBuilder valList = new StringBuilder("?::bigint");
        if (!codeIsId) {
            colList.append(", ").append(ct.codeCol());
            valList.append(", ?::bigint");
        }
        for (String k : cols) {
            colList.append(", ").append(k);
            valList.append(", p.").append(k);
        }
        // типы конвертирует сам Postgres: jsonb_populate_record по структуре прод-таблицы
        String sql = "INSERT INTO " + ct.table() + " (" + colList + ") SELECT " + valList +
                " FROM jsonb_populate_record(NULL::" + ct.table() + ", ?::jsonb) p";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            int i = 1;
            ps.setLong(i++, newId);
            if (!codeIsId) ps.setLong(i++, code);
            ps.setString(i, payloadJson);
            ps.executeUpdate();
        }
        return code;
    }

    /** UPDATE по бизнес-коду: SET-список из ключей payload (кроме id и кода). */
    private int update(Connection c, ChannelTable ct, long localCode, String payloadJson) throws Exception {
        JsonNode payload = om.readTree(payloadJson);
        // payload собирается из d_template, поэтому берём только колонки, которые реально есть в прод-таблице
        java.util.Set<String> prodCols = tableColumns(c, ct.table());
        List<String> cols = new ArrayList<>();
        for (Iterator<String> it = payload.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if ("id".equals(k) || ct.codeCol().equals(k)) continue;
            if (!k.matches("[a-z_][a-z0-9_]*")) {
                throw new IllegalArgumentException("Недопустимая колонка payload: " + k);
            }
            if (!prodCols.contains(k)) continue;
            // null не переносим: в проде такие колонки NOT NULL с дефолтом — оставляем текущее значение
            if (payload.get(k) == null || payload.get(k).isNull()) continue;
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

    /** Канал по описанию таблицы (для channel-specific дефолтов). */
    private static String channelOf(ChannelTable ct) {
        for (String ch : List.of("sms", "push", "email", "cc", "fa", "vk", "la")) {
            ChannelTable t = UnifiedTemplateService.channelTable(ch);
            if (t != null && t.table().equals(ct.table())) return ch;
        }
        return "";
    }

    /** Колонки прод-таблицы (payload из d_template может содержать лишние ключи). */
    private static java.util.Set<String> tableColumns(Connection c, String table) throws Exception {
        String[] st = table.split("\\.");
        java.util.Set<String> cols = new java.util.HashSet<>();
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?")) {
            ps.setString(1, st[0]);
            ps.setString(2, st[1]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) cols.add(rs.getString(1));
            }
        }
        return cols;
    }

    /** max+1 по колонке; при заданном limit нумерация идёт только в диапазоне ниже него. */
    private static long maxPlusOne(Connection c, String table, String col, Long limit) throws Exception {
        String sql = "SELECT COALESCE(MAX(" + col + "), 0) + 1 FROM " + table
                + (limit == null ? "" : " WHERE " + col + " < ?");
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            if (limit != null) ps.setLong(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }
}
