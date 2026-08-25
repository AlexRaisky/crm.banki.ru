package ru.banki.crm.service.deploy;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Что менялось в этом контуре — и что из этого можно увезти дальше.
 * <p>
 * Панель и так пишет два журнала: {@code app.schema_audit} — правки конструктора схемы и
 * DDL, {@code arch.t_admin_log} — построчные изменения таблиц. По отдельности их читают
 * при разборе поломок; здесь они складываются в один список «что произошло с настройками»
 * и раскладываются по объектам, которые умеет переносить пакет настроек.
 * <p>
 * Важная честность: перенос всё равно идёт объектом целиком. Отметив «изменилась роль
 * Аналитик», вы увозите все роли — иначе матрица прав приедет полурассыпанной, где новая
 * роль ссылается на разделы, которых на приёмнике ещё нет. Поэтому отметки здесь — это
 * способ понять, ЧТО трогали, и не забыть увезти нужный объект, а не покомпонентный
 * перенос: обещать второе, делая первое, было бы обманом.
 */
@Service
public class EnvChangesService {

    /** Таблица настроек -> объект пакета. Всё, чего здесь нет, — данные, а не настройки. */
    private static final Map<String, String> TABLE_TO_ITEM = Map.of(
            "app.role", "roles",
            "app.role_section", "roles",
            "app.app_section", "app-sections",
            "app.apps", "app-sections",
            "app.jira_connection", "jira-fields",
            "app.schema_model", "schema-model"
    );

    /** Схемы, чьи таблицы считаем справочниками. */
    private static final Set<String> REFERENCE_SCHEMAS = Set.of("reference", "dictionary");

    private final JdbcTemplate jdbc;

    @Value("${app.env.name:prod}")
    private String envName;

    @Value("${app.tables.admin-log:arch.t_admin_log}")
    private String adminLogTable;

    public EnvChangesService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Изменения за последние {@code days} дней, свежие сверху.
     *
     * @param days глубина в днях; по умолчанию две недели — столько обычно живёт правка
     *             между «сделали на тесте» и «повезли на препрод»
     */
    @Transactional(readOnly = true)
    public Map<String, Object> changes(Integer days) {
        int depth = days == null || days <= 0 ? 14 : Math.min(days, 180);
        Timestamp since = Timestamp.from(Instant.now().minus(depth, ChronoUnit.DAYS));

        List<Map<String, Object>> items = new ArrayList<>();
        items.addAll(fromSchemaAudit(since));
        items.addAll(fromAdminLog(since));
        items.sort((a, b) -> String.valueOf(b.get("at")).compareTo(String.valueOf(a.get("at"))));

        /* Сводка по объектам: именно она отвечает на вопрос «что везти», список ниже —
           на вопрос «почему». */
        Map<String, Map<String, Object>> byItem = new LinkedHashMap<>();
        for (Map<String, Object> c : items) {
            String key = String.valueOf(c.get("item"));
            if (key.isEmpty() || "null".equals(key)) {
                continue;
            }
            Map<String, Object> g = byItem.computeIfAbsent(key, k -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("key", k);
                m.put("title", titleOf(k));
                m.put("count", 0);
                m.put("lastAt", "");
                m.put("actors", new LinkedHashSet<String>());
                return m;
            });
            g.put("count", (Integer) g.get("count") + 1);
            if (String.valueOf(c.get("at")).compareTo(String.valueOf(g.get("lastAt"))) > 0) {
                g.put("lastAt", c.get("at"));
            }
            @SuppressWarnings("unchecked")
            Set<String> actors = (Set<String>) g.get("actors");
            String who = String.valueOf(c.getOrDefault("actor", ""));
            if (!who.isBlank() && !"null".equals(who)) {
                actors.add(who);
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("env", envName);
        out.put("days", depth);
        out.put("since", since.toInstant().toString());
        out.put("groups", new ArrayList<>(byItem.values()));
        out.put("items", items.size() > 300 ? items.subList(0, 300) : items);
        out.put("truncated", items.size() > 300);
        out.put("total", items.size());
        return out;
    }

    // ------------------------------------------------------------------ источники

    /** Конструктор схемы: сущности, поля, связи и настоящий DDL. */
    private List<Map<String, Object>> fromSchemaAudit(Timestamp since) {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            jdbc.query(
                    "SELECT timestamp_cr, actor, action, target, target_id, target_schema, target_table, status"
                    + " FROM app.schema_audit"
                    + " WHERE timestamp_cr >= ? AND coalesce(env, ?) = ? AND status <> 'REJECTED'"
                    + " ORDER BY id DESC LIMIT 500",
                    (RowCallbackHandler) rs -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        String target = str(rs.getString("target"));
                        String schema = str(rs.getString("target_schema"));
                        m.put("at", ts(rs.getTimestamp("timestamp_cr")));
                        m.put("actor", str(rs.getString("actor")));
                        m.put("source", "Конструктор схемы");
                        m.put("action", str(rs.getString("action")));
                        m.put("what", what(target, str(rs.getString("target_id")), schema,
                                str(rs.getString("target_table"))));
                        m.put("item", REFERENCE_SCHEMAS.contains(schema) ? "reference" : "schema-model");
                        m.put("failed", "ERROR".equals(str(rs.getString("status"))));
                        out.add(m);
                    },
                    since, envName, envName);
        } catch (RuntimeException e) {
            // журнала может не быть на старой схеме — тогда просто нет этой половины списка
        }
        return out;
    }

    /** Построчные правки: сюда попадают роли, разделы, справочники и настройки Jira. */
    private List<Map<String, Object>> fromAdminLog(Timestamp since) {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            jdbc.query(
                    "SELECT timestamp_cr, action_user, table_name, operation FROM " + safeTable()
                    + " WHERE timestamp_cr >= ? ORDER BY id DESC LIMIT 500",
                    (RowCallbackHandler) rs -> {
                        String table = str(rs.getString("table_name"));
                        String item = itemOf(table);
                        if (item == null) {
                            return;   // правка данных, а не настроек: переносить нечего
                        }
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("at", ts(rs.getTimestamp("timestamp_cr")));
                        m.put("actor", str(rs.getString("action_user")));
                        m.put("source", "Журнал действий");
                        m.put("action", str(rs.getString("operation")).toLowerCase());
                        m.put("what", table);
                        m.put("item", item);
                        m.put("failed", false);
                        out.add(m);
                    },
                    since);
        } catch (RuntimeException e) {
            // то же самое: нет журнала — нет этой половины
        }
        return out;
    }

    // ------------------------------------------------------------------ мелочи

    /** Имя таблицы журнала приходит из настроек — в SQL его подставляем, поэтому проверяем. */
    private String safeTable() {
        String t = adminLogTable == null || adminLogTable.isBlank() ? "arch.t_admin_log" : adminLogTable.trim();
        return t.matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?") ? t : "arch.t_admin_log";
    }

    private static String itemOf(String table) {
        String t = table == null ? "" : table.trim().toLowerCase();
        String direct = TABLE_TO_ITEM.get(t);
        if (direct != null) {
            return direct;
        }
        int dot = t.indexOf('.');
        String schema = dot > 0 ? t.substring(0, dot) : "";
        return REFERENCE_SCHEMAS.contains(schema) ? "reference" : null;
    }

    /** Человеческое «что именно тронули»: «таблица reference.domain_group», «поле lead.email». */
    private static String what(String target, String targetId, String schema, String table) {
        if (!schema.isEmpty() && !table.isEmpty()) {
            return schema + "." + table;
        }
        if (!targetId.isEmpty()) {
            return target.isEmpty() ? targetId : target + " " + targetId;
        }
        return target.isEmpty() ? "—" : target;
    }

    private static String titleOf(String key) {
        for (Map<String, String> it : SettingsPackService.ITEMS) {
            if (key.equals(it.get("key"))) {
                return it.get("title");
            }
        }
        return key;
    }

    private static String ts(Timestamp t) {
        return t == null ? "" : t.toInstant().toString();
    }

    private static String str(String s) {
        return s == null ? "" : s;
    }
}
