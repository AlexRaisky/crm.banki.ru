package ru.banki.crm.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.security.CurrentUser;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Хранение модели Scheme Builder (app.schema_model) с историей версий и журналом действий.
 * <p>
 * До этого источником истины был файл settings/schema/crm-schema.json, а правки копились
 * черновиком в localStorage браузера: двое правящих затирали друг друга молча, а очистка
 * данных браузера уносила черновик. Теперь модель лежит у нас, а редактор ходит за ней
 * по REST (SchemaStore.mode = 'api').
 * <p>
 * DDL этот сервис не выполняет — он только про хранение модели. Создание схем и таблиц
 * будет отдельным слоем поверх, со своим реестром владения и предпросмотром.
 */
@Service
public class SchemaModelService {

    /** Косметика: перетаскивание блока и авто-раскладка меняют координаты, а не модель. */
    private static final Set<String> COSMETIC_OPS = Set.of("move", "layout");

    /** Откуда взять модель при первом обращении, пока в базе пусто. */
    private static final String SEED_RESOURCE = "static/settings/schema/crm-schema.json";

    @PersistenceContext
    private EntityManager em;

    private final ObjectMapper json;

    @Value("${app.env.name:prod}")
    private String envName;

    public SchemaModelService(ObjectMapper json) {
        this.json = json;
    }

    // ------------------------------------------------------------------ ЧТЕНИЕ

    /**
     * Текущая модель. Строки ещё нет — засеваем из файла в classpath: раздел не должен
     * встречать пользователя пустым холстом только потому, что переехал на сервер.
     */
    @Transactional
    public String current() {
        return normalize(currentRaw()).toString();
    }

    /** Модель как она лежит в базе, без приведения к двухуровневому виду. */
    private String currentRaw() {
        String stored = readModel();
        if (stored != null) return stored;
        String seed = readSeed();
        if (seed == null) return "{\"version\":\"2.0\",\"entities\":[],\"relations\":[]}";
        em.createNativeQuery(
                        "INSERT INTO app.schema_model (id, model, updated_by)" +
                        " VALUES (1, CAST(:m AS jsonb), :u) ON CONFLICT (id) DO NOTHING")
                .setParameter("m", seed)
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
        audit("seed", "schema", null, null, "OK", null);
        return seed;
    }

    /** Та же текущая модель, но разобранная — нужна планировщику DDL. */
    @Transactional
    public JsonNode currentAsNode() {
        return normalize(currentRaw());
    }

    /**
     * Приведение модели к двухуровневому виду: схемы отдельным списком, у каждой таблицы —
     * указание, в какой схеме она живёт.
     * <p>
     * Модель исторически была одноуровневой: сущность и есть таблица, схем не было вовсе.
     * Чтобы не ломать уже заведённое, старая модель разворачивается по правилу «сущность
     * становится своей схемой» — ровно то поведение, что было до появления уровня схем.
     * Дальше пользователь перегруппирует таблицы в редакторе как ему нужно.
     * <p>
     * Приведение делается ПРИ ЧТЕНИИ и в базу само по себе не пишется: сохранится оно
     * первым же сохранением из редактора. Так чтение остаётся безопасным, а «миграция»
     * модели не требует отдельного прогона.
     */
    private JsonNode normalize(String modelText) {
        ObjectNode m;
        try {
            JsonNode parsed = json.readTree(modelText);
            if (!(parsed instanceof ObjectNode on)) return json.createObjectNode();
            m = on;
        } catch (Exception e) {
            return json.createObjectNode();
        }
        JsonNode entities = m.get("entities");
        if (entities == null || !entities.isArray()) return m;

        // 1. У каждой таблицы должно быть поле schema. Нет — значит модель старая,
        //    и схемой считается сама сущность.
        java.util.LinkedHashMap<String, String> found = new java.util.LinkedHashMap<>();
        for (JsonNode e : entities) {
            if (!(e instanceof ObjectNode en)) continue;
            String id = txt(en, "id");
            String schema = txt(en, "schema");
            if (schema.isEmpty()) {
                schema = id;
                en.put("schema", schema);
            }
            if (!schema.isEmpty()) {
                // подпись схемы берём у той таблицы, чьё имя совпало с именем схемы:
                // при развороте старой модели это она и есть
                String label = txt(en, "label");
                found.merge(schema, schema.equals(id) ? label : "", (a, b) -> a.isEmpty() ? b : a);
            }
        }

        // 2. Список схем. Уже описанные не трогаем — у них может быть своя подпись
        //    и описание, заданные человеком.
        ArrayNode schemas = m.get("schemas") instanceof ArrayNode a ? a : m.putArray("schemas");
        java.util.Set<String> known = new java.util.HashSet<>();
        for (JsonNode s : schemas) known.add(txt(s, "id"));
        for (var en : found.entrySet()) {
            if (known.contains(en.getKey())) continue;
            ObjectNode s = schemas.addObject();
            s.put("id", en.getKey());
            s.put("label", en.getValue() == null || en.getValue().isEmpty() ? en.getKey() : en.getValue());
            s.put("description", "");
        }
        return m;
    }

    private static String txt(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText().trim();
    }

    private String readModel() {
        List<?> rows = em.createNativeQuery(
                        "SELECT model::text FROM app.schema_model WHERE id = 1")
                .getResultList();
        return rows.isEmpty() ? null : (String) rows.get(0);
    }

    private String readSeed() {
        try {
            return new String(new ClassPathResource(SEED_RESOURCE).getInputStream().readAllBytes(),
                    StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;   // файла нет — не повод падать, отдадим пустую модель
        }
    }

    // ------------------------------------------------------------------ ЗАПИСЬ

    /**
     * Сохранить модель целиком и записать в журнал дельты, которые прислал редактор.
     * <p>
     * Снимок в историю кладём НЕ на каждое сохранение: перетаскивание блока по холсту
     * тоже проходит через сохранение, и без этого фильтра история за день распухла бы
     * до сотен одинаковых по смыслу версий. Снимок пишем, только если среди операций
     * есть хоть одна не косметическая.
     */
    @Transactional
    public Map<String, Object> save(JsonNode model, JsonNode changes) {
        String modelText = model.toString();
        em.createNativeQuery(
                        "INSERT INTO app.schema_model (id, model, updated_by, timestamp_upd)" +
                        " VALUES (1, CAST(:m AS jsonb), :u, now())" +
                        " ON CONFLICT (id) DO UPDATE SET model = CAST(:m AS jsonb)," +
                        " updated_by = :u, timestamp_upd = now()")
                .setParameter("m", modelText)
                .setParameter("u", CurrentUser.email())
                .executeUpdate();

        int logged = logChanges(changes);
        boolean substantive = hasSubstantive(changes);
        if (substantive || logged == 0) {
            em.createNativeQuery(
                            "INSERT INTO app.schema_version (model, author, comment)" +
                            " VALUES (CAST(:m AS jsonb), :a, :c)")
                    .setParameter("m", modelText)
                    .setParameter("a", CurrentUser.email())
                    .setParameter("c", summarize(changes))
                    .executeUpdate();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("saved", true);
        out.put("logged", logged);
        out.put("versioned", substantive || logged == 0);
        return out;
    }

    /** Только журнал, без сохранения модели — под POST /api/schema/changes. */
    @Transactional
    public Map<String, Object> logOnly(JsonNode changes) {
        int n = logChanges(changes);
        return Map.of("logged", n);
    }

    private int logChanges(JsonNode changes) {
        if (changes == null || !changes.isArray()) return 0;
        int n = 0;
        for (JsonNode c : changes) {
            String payload = c.hasNonNull("payload") ? c.get("payload").toString() : null;
            audit(text(c, "op"), text(c, "target"), text(c, "id"), payload, "OK", null);
            n++;
        }
        return n;
    }

    private boolean hasSubstantive(JsonNode changes) {
        if (changes == null || !changes.isArray()) return false;
        for (JsonNode c : changes) {
            if (!COSMETIC_OPS.contains(text(c, "op"))) return true;
        }
        return false;
    }

    /** Короткая подпись версии: «create entity, update field ×3» — чтобы история читалась. */
    private String summarize(JsonNode changes) {
        if (changes == null || !changes.isArray() || changes.isEmpty()) return "сохранение модели";
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (JsonNode c : changes) {
            String k = text(c, "op") + " " + text(c, "target");
            counts.merge(k.trim(), 1, Integer::sum);
        }
        List<String> parts = new ArrayList<>();
        counts.forEach((k, v) -> parts.add(v > 1 ? k + " ×" + v : k));
        String s = String.join(", ", parts);
        return s.length() > 500 ? s.substring(0, 500) : s;
    }

    // ------------------------------------------------------------------ ЖУРНАЛ

    /**
     * Строка журнала. Пишется на каждое действие — требование заказчика: видно, кто, что
     * и когда сделал. Колонки под будущий DDL (target_schema/sql_text/rows_affected)
     * заполняются позже, когда билдер начнёт создавать таблицы.
     */
    public void audit(String action, String target, String targetId, String payloadJson,
                      String status, String error) {
        em.createNativeQuery(
                        "INSERT INTO app.schema_audit" +
                        " (actor, action, target, target_id, payload, status, error, env)" +
                        " VALUES (:actor, :action, :target, :tid, CAST(:p AS jsonb), :st, :err, :env)")
                .setParameter("actor", CurrentUser.email())
                .setParameter("action", action == null ? "unknown" : action)
                .setParameter("target", target)
                .setParameter("tid", targetId)
                .setParameter("p", payloadJson)
                .setParameter("st", status == null ? "OK" : status)
                .setParameter("err", error)
                .setParameter("env", envName)
                .executeUpdate();
    }

    /** История версий без самих моделей: они тяжёлые, а списку нужны только заголовки. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> versions(int limit) {
        List<?> rows = em.createNativeQuery(
                        "SELECT id, author, comment, timestamp_cr FROM app.schema_version" +
                        " ORDER BY id DESC LIMIT :n")
                .setParameter("n", limit)
                .getResultList();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : rows) {
            Object[] r = (Object[]) o;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r[0]);
            m.put("author", r[1]);
            m.put("comment", r[2]);
            m.put("ts", String.valueOf(r[3]));
            out.add(m);
        }
        return out;
    }

    /** Журнал действий для вкладки «Журнал» в билдере. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> auditLog(int limit) {
        List<?> rows = em.createNativeQuery(
                        "SELECT id, timestamp_cr, actor, action, target, target_id, status, error, env" +
                        " FROM app.schema_audit ORDER BY id DESC LIMIT :n")
                .setParameter("n", limit)
                .getResultList();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : rows) {
            Object[] r = (Object[]) o;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r[0]);
            m.put("ts", String.valueOf(r[1]));
            m.put("actor", r[2]);
            m.put("action", r[3]);
            m.put("target", r[4]);
            m.put("targetId", r[5]);
            m.put("status", r[6]);
            m.put("error", r[7]);
            m.put("env", r[8]);
            out.add(m);
        }
        return out;
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText();
    }
}
