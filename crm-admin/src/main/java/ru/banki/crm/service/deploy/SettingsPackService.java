package ru.banki.crm.service.deploy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Перенос настроек между контурами пакетом.
 * <p>
 * Код едет коммитами, а вот то, что люди завели руками в панели — роли и матрица прав,
 * модель схемы, справочники, привязка разделов к приложениям, — живёт в базе, и у каждого
 * контура она своя. Настроили на тесте, а на проде пусто: до сих пор это переносили
 * пересказом «повторите то же самое руками».
 * <p>
 * Переносим файлом, а не прямым соединением с базой соседа. Прямое соединение технически
 * возможно (панель умеет ходить в чужие базы), но означало бы дать проду доступ в тест —
 * связь, которой быть не должно. Файл же виден человеку целиком и переносится осознанно.
 * <p>
 * Что переносим — закрытый список. Учётки, пароли и токены в пакет не попадают никогда:
 * они у каждого контура свои по определению, и увозить их между средами нельзя. Боевые
 * данные (шаблоны, планы промо) — тоже: у них свой путь, очередь синка.
 */
@Service
public class SettingsPackService {

    /** Что умеем переносить. Порядок — тот, в котором это применяют. */
    public static final List<Map<String, String>> ITEMS = List.of(
            Map.of("key", "roles", "title", "Роли и матрица прав",
                    "about", "Список ролей и что каждой доступно. Учётки пользователей не переносятся."),
            Map.of("key", "schema-model", "title", "Модель Scheme Builder",
                    "about", "Сущности, поля и связи конструктора схемы. Таблицы в базе не создаются — это делает «Применить к базе»."),
            Map.of("key", "reference", "title", "Справочники значений",
                    "about", "Имена коммуникаций, точки касания, продукты, партнёры."),
            Map.of("key", "app-sections", "title", "Приложения и разделы",
                    "about", "Какие разделы панели видит каждое приложение из App Launcher."),
            Map.of("key", "jira-fields", "title", "Карта полей Jira",
                    "about", "Соответствие наших полей полям задачи. Адрес и токен не переносятся.")
    );

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    @Value("${app.env.name:prod}")
    private String envName;

    public SettingsPackService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Из чего можно собрать пакет и сколько в каждом объекте записей на этом контуре. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> catalog() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, String> it : ITEMS) {
            Map<String, Object> m = new LinkedHashMap<>(it);
            m.put("count", count(it.get("key")));
            out.add(m);
        }
        return out;
    }

    /** Собрать пакет из выбранных объектов. */
    @Transactional(readOnly = true)
    public Map<String, Object> export(List<String> keys) {
        List<String> want = keys == null || keys.isEmpty() ? allKeys() : keys;
        ObjectNode items = json.createObjectNode();
        for (String k : want) {
            requireKnown(k);
            items.set(k, read(k));
        }
        Map<String, Object> pack = new LinkedHashMap<>();
        pack.put("format", "crm-admin-settings/1");
        pack.put("sourceEnv", envName);
        pack.put("exportedBy", CurrentUser.email());
        pack.put("exportedAt", java.time.Instant.now().toString());
        pack.put("items", items);
        return pack;
    }

    /**
     * Что произойдёт при применении: по каждому объекту — сколько появится, сколько
     * изменится и что останется нетронутым. Считаем до применения и на тех же данных,
     * иначе предпросмотр обещал бы одно, а делалось бы другое.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> preview(JsonNode pack) {
        JsonNode items = requireItems(pack);
        List<Map<String, Object>> rows = new ArrayList<>();
        items.fieldNames().forEachRemaining(key -> {
            if (!known(key)) return;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", key);
            m.put("title", title(key));
            m.putAll(diff(key, items.get(key)));
            rows.add(m);
        });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sourceEnv", pack.path("sourceEnv").asText(""));
        out.put("exportedAt", pack.path("exportedAt").asText(""));
        out.put("exportedBy", pack.path("exportedBy").asText(""));
        out.put("targetEnv", envName);
        out.put("items", rows);
        out.put("sameEnv", envName.equals(pack.path("sourceEnv").asText("")));
        return out;
    }

    /**
     * Применить выбранные объекты. Перед каждым — слепок «как было» в app.settings_snapshot:
     * пакет перезаписывает настройки целиком, и без слепка откат означал бы «вспоминайте,
     * как оно выглядело».
     */
    @Transactional
    public Map<String, Object> apply(JsonNode pack, List<String> keys) {
        JsonNode items = requireItems(pack);
        String source = pack.path("sourceEnv").asText("");
        List<String> want = keys == null || keys.isEmpty() ? new ArrayList<>() : new ArrayList<>(keys);
        if (want.isEmpty()) {
            items.fieldNames().forEachRemaining(want::add);
        }
        List<Map<String, Object>> applied = new ArrayList<>();
        for (String key : want) {
            requireKnown(key);
            JsonNode payload = items.get(key);
            if (payload == null || payload.isNull()) {
                throw bad("В пакете нет объекта «" + title(key) + "»");
            }
            snapshot(key, source);
            Map<String, Object> res = write(key, payload);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", key);
            m.put("title", title(key));
            m.putAll(res);
            applied.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("applied", applied);
        out.put("sourceEnv", source);
        return out;
    }

    /** Слепки: что можно вернуть, если перенос оказался неудачным. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> snapshots(int limit) {
        return jdbc.query(
                "SELECT id, item_key, source_env, actor, timestamp_cr,"
                + "       pg_column_size(payload) AS size"
                + "  FROM app.settings_snapshot ORDER BY id DESC LIMIT ?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("key", rs.getString("item_key"));
                    m.put("title", title(rs.getString("item_key")));
                    m.put("sourceEnv", rs.getString("source_env"));
                    m.put("actor", rs.getString("actor"));
                    m.put("at", String.valueOf(rs.getTimestamp("timestamp_cr")));
                    m.put("size", rs.getLong("size"));
                    return m;
                }, Math.max(1, Math.min(limit, 100)));
    }

    /** Вернуть объект из слепка — тем же путём, каким применяли пакет. */
    @Transactional
    public Map<String, Object> restore(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT item_key, payload::text FROM app.settings_snapshot WHERE id = ?", id);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Слепок не найден: " + id);
        }
        String key = String.valueOf(rows.get(0).get("item_key"));
        JsonNode payload = parse(String.valueOf(rows.get(0).get("payload")));
        snapshot(key, "restore");
        Map<String, Object> res = write(key, payload);
        Map<String, Object> out = new LinkedHashMap<>(res);
        out.put("key", key);
        out.put("title", title(key));
        return out;
    }

    // ------------------------------------------------------------------ чтение объектов

    private JsonNode read(String key) {
        return switch (key) {
            case "roles" -> readRoles();
            case "schema-model" -> readOne("SELECT model::text FROM app.schema_model WHERE id = 1");
            case "reference" -> readReference();
            case "app-sections" -> readOne("SELECT value::text FROM app.panel_settings WHERE key = 'appSections'");
            case "jira-fields" -> readJiraFields();
            default -> json.createObjectNode();
        };
    }

    private JsonNode readRoles() {
        ArrayNode arr = json.createArrayNode();
        List<Map<String, Object>> roles = jdbc.queryForList(
                "SELECT id, name, is_admin, is_super_admin, is_system, sort_order FROM app.role ORDER BY sort_order, name");
        for (Map<String, Object> r : roles) {
            ObjectNode o = json.createObjectNode();
            o.put("name", String.valueOf(r.get("name")));
            o.put("isAdmin", Boolean.TRUE.equals(r.get("is_admin")));
            o.put("isSuperAdmin", Boolean.TRUE.equals(r.get("is_super_admin")));
            o.put("isSystem", Boolean.TRUE.equals(r.get("is_system")));
            o.put("sortOrder", ((Number) r.get("sort_order")).intValue());
            ArrayNode secs = json.createArrayNode();
            jdbc.queryForList("SELECT section_id, can_read, can_add, can_edit, can_delete"
                            + " FROM app.role_section WHERE role_id = ? ORDER BY section_id", r.get("id"))
                    .forEach(s -> {
                        ObjectNode sn = json.createObjectNode();
                        sn.put("section", String.valueOf(s.get("section_id")));
                        sn.put("read", Boolean.TRUE.equals(s.get("can_read")));
                        sn.put("add", Boolean.TRUE.equals(s.get("can_add")));
                        sn.put("edit", Boolean.TRUE.equals(s.get("can_edit")));
                        sn.put("delete", Boolean.TRUE.equals(s.get("can_delete")));
                        secs.add(sn);
                    });
            o.set("sections", secs);
            arr.add(o);
        }
        return arr;
    }

    /** Справочники: и переехавшие в reference, и оставшиеся в dictionary. */
    private JsonNode readReference() {
        ObjectNode out = json.createObjectNode();
        for (String table : REFERENCE_TABLES) {
            if (!tableExists(table)) continue;
            ArrayNode arr = json.createArrayNode();
            /* У партнёров колонка называется name и нет ни описания, ни порядка — приводим
               к общей форме прямо в запросе, чтобы дальше все справочники выглядели одинаково. */
            String cols = table.endsWith("d_partner")
                    ? "name, '' AS description, 100 AS sort_order, true AS is_active"
                    : "value AS name, coalesce(description, '') AS description, sort_order, is_active";
            jdbc.queryForList("SELECT " + cols + " FROM " + table + " ORDER BY 1").forEach(r -> {
                ObjectNode o = json.createObjectNode();
                o.put("value", String.valueOf(r.get("name")));
                o.put("description", String.valueOf(r.getOrDefault("description", "")));
                o.put("sortOrder", ((Number) r.getOrDefault("sort_order", 100)).intValue());
                o.put("active", Boolean.TRUE.equals(r.getOrDefault("is_active", true)));
                arr.add(o);
            });
            out.set(table, arr);
        }
        return out;
    }

    /** Только карта полей и значений. Адрес и токен — настройки контура, не переносятся. */
    private JsonNode readJiraFields() {
        ObjectNode out = json.createObjectNode();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT field_map::text AS fm, value_map::text AS vm FROM app.jira_connection WHERE id = 1");
        if (rows.isEmpty()) return out;
        out.set("fieldMap", parse(String.valueOf(rows.get(0).get("fm"))));
        out.set("valueMap", parse(String.valueOf(rows.get(0).get("vm"))));
        return out;
    }

    private JsonNode readOne(String sql) {
        List<String> rows = jdbc.queryForList(sql, String.class);
        return rows.isEmpty() ? json.createObjectNode() : parse(rows.get(0));
    }

    // ------------------------------------------------------------------ применение

    private Map<String, Object> write(String key, JsonNode payload) {
        return switch (key) {
            case "roles" -> writeRoles(payload);
            case "schema-model" -> {
                jdbc.update("INSERT INTO app.schema_model (id, model, updated_by, timestamp_upd)"
                                + " VALUES (1, CAST(? AS jsonb), ?, now())"
                                + " ON CONFLICT (id) DO UPDATE SET model = CAST(? AS jsonb),"
                                + " updated_by = ?, timestamp_upd = now()",
                        payload.toString(), CurrentUser.email(), payload.toString(), CurrentUser.email());
                yield Map.of("updated", 1);
            }
            case "reference" -> writeReference(payload);
            case "app-sections" -> {
                jdbc.update("INSERT INTO app.panel_settings (key, value) VALUES ('appSections', CAST(? AS jsonb))"
                                + " ON CONFLICT (key) DO UPDATE SET value = CAST(? AS jsonb), timestamp_upd = now()",
                        payload.toString(), payload.toString());
                yield Map.of("updated", 1);
            }
            case "jira-fields" -> {
                jdbc.update("UPDATE app.jira_connection SET field_map = CAST(? AS jsonb),"
                                + " value_map = CAST(? AS jsonb), timestamp_upd = now(), updated_by = ?"
                                + " WHERE id = 1",
                        payload.path("fieldMap").toString(), payload.path("valueMap").toString(),
                        CurrentUser.email());
                yield Map.of("updated", 1);
            }
            default -> Map.of();
        };
    }

    /**
     * Роли переносим по имени: id у контуров свои. Супер-роль не трогаем вовсе — она
     * привязана к ADMIN_EMAIL этого контура, и приезжать со стороны ей нечего.
     * Роли, которых нет в пакете, остаются: пакет добавляет и обновляет, но не подчищает
     * чужое — иначе перенос справочника снёс бы роль, заведённую на проде под конкретного
     * человека.
     */
    private Map<String, Object> writeRoles(JsonNode arr) {
        int added = 0, updated = 0;
        for (JsonNode r : arr) {
            String name = r.path("name").asText("").trim();
            if (name.isEmpty() || r.path("isSuperAdmin").asBoolean(false)) continue;
            List<Map<String, Object>> found = jdbc.queryForList(
                    "SELECT id FROM app.role WHERE lower(name) = lower(?)", name);
            Long id;
            if (found.isEmpty()) {
                id = jdbc.queryForObject(
                        "INSERT INTO app.role (name, is_admin, is_super_admin, is_system, sort_order)"
                        + " VALUES (?, ?, false, false, ?) RETURNING id",
                        Long.class, name, r.path("isAdmin").asBoolean(false), r.path("sortOrder").asInt(100));
                added++;
            } else {
                id = ((Number) found.get(0).get("id")).longValue();
                jdbc.update("UPDATE app.role SET is_admin = ?, sort_order = ? WHERE id = ? AND NOT is_super_admin",
                        r.path("isAdmin").asBoolean(false), r.path("sortOrder").asInt(100), id);
                updated++;
            }
            jdbc.update("DELETE FROM app.role_section WHERE role_id = ?", id);
            for (JsonNode s : r.path("sections")) {
                jdbc.update("INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)"
                                + " VALUES (?, ?, ?, ?, ?, ?)"
                                + " ON CONFLICT (role_id, section_id) DO UPDATE SET can_read = EXCLUDED.can_read,"
                                + " can_add = EXCLUDED.can_add, can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete",
                        id, s.path("section").asText(""), s.path("read").asBoolean(true),
                        s.path("add").asBoolean(false), s.path("edit").asBoolean(false),
                        s.path("delete").asBoolean(false));
            }
        }
        return Map.of("added", added, "updated", updated);
    }

    /** Справочники дополняем, а не заменяем: значение, заведённое на проде, чужой пакет стирать не должен. */
    private Map<String, Object> writeReference(JsonNode obj) {
        int added = 0;
        for (String table : REFERENCE_TABLES) {
            JsonNode arr = obj.get(table);
            if (arr == null || !arr.isArray() || !tableExists(table)) continue;
            boolean partner = table.endsWith("d_partner");
            for (JsonNode v : arr) {
                String value = v.path("value").asText("").trim();
                if (value.isEmpty()) continue;
                int n = partner
                        ? jdbc.update("INSERT INTO " + table + " (name) VALUES (?) ON CONFLICT (name) DO NOTHING", value)
                        : jdbc.update("INSERT INTO " + table + " (value, description, sort_order, is_active)"
                                        + " VALUES (?, ?, ?, ?) ON CONFLICT (value) DO NOTHING",
                                value, v.path("description").asText(""), v.path("sortOrder").asInt(100),
                                v.path("active").asBoolean(true));
                added += n;
            }
        }
        return Map.of("added", added);
    }

    // ------------------------------------------------------------------ предпросмотр

    private Map<String, Object> diff(String key, JsonNode incoming) {
        Map<String, Object> m = new LinkedHashMap<>();
        switch (key) {
            case "roles" -> {
                int add = 0, upd = 0, skip = 0;
                for (JsonNode r : incoming) {
                    if (r.path("isSuperAdmin").asBoolean(false)) { skip++; continue; }
                    Long n = jdbc.queryForObject("SELECT count(*) FROM app.role WHERE lower(name) = lower(?)",
                            Long.class, r.path("name").asText(""));
                    if (n != null && n > 0) upd++; else add++;
                }
                m.put("add", add);
                m.put("update", upd);
                m.put("skip", skip);
                m.put("note", skip > 0 ? "супер-роль не переносится" : "");
            }
            case "reference" -> {
                int add = 0, same = 0;
                for (String table : REFERENCE_TABLES) {
                    JsonNode arr = incoming.get(table);
                    if (arr == null || !arr.isArray() || !tableExists(table)) continue;
                    boolean partner = table.endsWith("d_partner");
                    String col = partner ? "name" : "value";
                    for (JsonNode v : arr) {
                        Long n = jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE " + col + " = ?",
                                Long.class, v.path("value").asText(""));
                        if (n != null && n > 0) same++; else add++;
                    }
                }
                m.put("add", add);
                m.put("update", 0);
                m.put("skip", same);
                m.put("note", "существующие значения не трогаем");
            }
            default -> {
                m.put("add", 0);
                m.put("update", 1);
                m.put("skip", 0);
                m.put("note", "объект заменяется целиком");
            }
        }
        m.put("size", incoming == null ? 0 : incoming.toString().length());
        return m;
    }

    private long count(String key) {
        try {
            return switch (key) {
                case "roles" -> one("SELECT count(*) FROM app.role");
                case "schema-model" -> one("SELECT count(*) FROM app.schema_model WHERE id = 1");
                case "reference" -> {
                    long n = 0;
                    for (String t : REFERENCE_TABLES) if (tableExists(t)) n += one("SELECT count(*) FROM " + t);
                    yield n;
                }
                case "app-sections" -> one("SELECT count(*) FROM app.panel_settings WHERE key = 'appSections'");
                case "jira-fields" -> one("SELECT count(*) FROM app.jira_connection WHERE id = 1");
                default -> 0;
            };
        } catch (RuntimeException e) {
            return 0;
        }
    }

    // ------------------------------------------------------------------ мелочи

    private static final List<String> REFERENCE_TABLES = List.of(
            "reference.d_communication_name", "reference.d_touch_point",
            "dictionary.d_product_type", "dictionary.d_partner");

    private void snapshot(String key, String source) {
        jdbc.update("INSERT INTO app.settings_snapshot (item_key, payload, source_env, actor)"
                        + " VALUES (?, CAST(? AS jsonb), ?, ?)",
                key, read(key).toString(), source == null ? "" : source, CurrentUser.email());
    }

    private boolean tableExists(String table) {
        Object reg = jdbc.queryForObject("SELECT to_regclass(?)", Object.class, table);
        return reg != null;
    }

    private long one(String sql) {
        Long n = jdbc.queryForObject(sql, Long.class);
        return n == null ? 0 : n;
    }

    private JsonNode parse(String text) {
        try {
            return json.readTree(text == null || text.isBlank() ? "{}" : text);
        } catch (Exception e) {
            return json.createObjectNode();
        }
    }

    private static List<String> allKeys() {
        List<String> out = new ArrayList<>();
        ITEMS.forEach(i -> out.add(i.get("key")));
        return out;
    }

    private static boolean known(String key) {
        return allKeys().contains(key);
    }

    private static void requireKnown(String key) {
        if (!known(key)) {
            throw bad("Неизвестный объект переноса: " + key);
        }
    }

    private static String title(String key) {
        for (Map<String, String> i : ITEMS) {
            if (i.get("key").equals(key)) return i.get("title");
        }
        return key;
    }

    private static JsonNode requireItems(JsonNode pack) {
        JsonNode items = pack == null ? null : pack.get("items");
        if (items == null || !items.isObject() || items.isEmpty()) {
            throw bad("Это не пакет настроек: в файле нет объектов");
        }
        String format = pack.path("format").asText("");
        if (!format.startsWith("crm-admin-settings/")) {
            throw bad("Неизвестный формат файла: " + (format.isEmpty() ? "не указан" : format));
        }
        return items;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
