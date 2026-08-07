package ru.banki.crm.service.schema;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Что на самом деле есть в базе: схемы и их таблицы.
 * <p>
 * Показываем ФАКТ из каталога Postgres, а не модель. Модель — это намерение, и расходиться
 * с базой она будет всегда: часть схем заведена миграциями, часть билдером, что-то могли
 * создать руками. Обозреватель отвечает на вопрос «что реально лежит», и он же служит
 * проверкой после применения DDL.
 * <p>
 * Описания собираются из двух источников: комментарий Postgres (COMMENT ON), а если его нет —
 * описание из модели Scheme Builder. Так у схем, заведённых билдером, подпись есть сразу,
 * без необходимости отдельно проставлять комментарии в базе.
 * <p>
 * Только чтение. Ничего не создаёт и не меняет.
 */
@Service
public class SchemaInspectService {

    @PersistenceContext
    private EntityManager em;

    private final ru.banki.crm.service.SchemaModelService models;

    @Value("${app.env.name:prod}")
    private String envName;

    public SchemaInspectService(ru.banki.crm.service.SchemaModelService models) {
        this.models = models;
    }

    /**
     * Схемы с вложенными таблицами. Системные (pg_*, information_schema) не показываем —
     * админу панели они не нужны, а список от них раздувается втрое.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> tree() {
        Map<String, Map<String, Object>> descr = modelDescriptions();

        @SuppressWarnings("unchecked")
        List<Object[]> schemaRows = em.createNativeQuery(
                        "SELECT n.nspname," +
                        "       obj_description(n.oid, 'pg_namespace')," +
                        "       (SELECT count(*) FROM app.schema_reserved r WHERE r.schema_name = n.nspname)," +
                        "       (SELECT count(*) FROM app.schema_owned o" +
                        "          WHERE o.schema_name = n.nspname AND o.env = :env)" +
                        "  FROM pg_namespace n" +
                        " WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'" +
                        " ORDER BY n.nspname")
                .setParameter("env", envName)
                .getResultList();

        // таблицы одним запросом на всё: по запросу на схему было бы N+1 на ровном месте
        @SuppressWarnings("unchecked")
        List<Object[]> tableRows = em.createNativeQuery(
                        "SELECT n.nspname, c.relname," +
                        "       obj_description(c.oid, 'pg_class')," +
                        "       (SELECT count(*) FROM pg_attribute a" +
                        "         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)" +
                        // Числа строк здесь нет намеренно: точный count(*) по каждой таблице
                        // превратил бы открытие раздела в полное сканирование базы, а оценка
                        // планировщика (reltuples) врёт тем сильнее, чем дольше не было
                        // ANALYZE. Раздел про структуру — приблизительное число только мешало.
                        "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace" +
                        " WHERE c.relkind IN ('r','p')" +
                        "   AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'" +
                        " ORDER BY n.nspname, c.relname")
                .getResultList();

        Map<String, List<Map<String, Object>>> bySchema = new LinkedHashMap<>();
        for (Object[] r : tableRows) {
            String schema = str(r[0]), table = str(r[1]);
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("name", table);
            t.put("comment", pick(str(r[2]), descrOf(descr, schema, table)));
            t.put("columns", num(r[3]));
            bySchema.computeIfAbsent(schema, k -> new ArrayList<>()).add(t);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (Object[] r : schemaRows) {
            String schema = str(r[0]);
            List<Map<String, Object>> tables = bySchema.getOrDefault(schema, List.of());
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("name", schema);
            s.put("comment", pick(str(r[1]), descrOf(descr, schema, null)));
            s.put("reserved", num(r[2]) > 0);   // защищена: билдеру недоступна
            s.put("owned", num(r[3]) > 0);      // заведена билдером на этом контуре
            s.put("tables", tables);
            s.put("tableCount", tables.size());
            out.add(s);
        }
        return out;
    }

    /**
     * Описания из модели Scheme Builder: схема → её описание и описания таблиц.
     * Модель недоступна или пуста — просто останемся без подписей, это не повод падать.
     */
    private Map<String, Map<String, Object>> modelDescriptions() {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        try {
            /* Именно stored-, а не current-: current засевает модель из файла, то есть
               делает INSERT, а мы внутри read-only транзакции — Postgres такое отклонит
               и уронит весь запрос. Подписи схем — приятное дополнение, не условие работы. */
            JsonNode model = models.storedAsNode();
            if (model == null) return out;
            /* Подписи самих схем — из списка schemas: там их задаёт человек, и это
               точнее, чем брать описание у одноимённой таблицы. */
            JsonNode schemas = model.get("schemas");
            if (schemas != null && schemas.isArray()) {
                for (JsonNode s : schemas) {
                    String id = text(s, "id");
                    if (id.isEmpty()) continue;
                    String d = text(s, "description");
                    if (d.isEmpty()) d = text(s, "label");
                    out.computeIfAbsent(id, k -> new LinkedHashMap<>()).put("", d);
                }
            }
            JsonNode entities = model.get("entities");
            if (entities == null || !entities.isArray()) return out;
            for (JsonNode e : entities) {
                String schema = DdlPlanner.schemaOf(e);
                String table = DdlPlanner.tableOf(e);
                if (schema.isEmpty()) continue;
                Map<String, Object> m = out.computeIfAbsent(schema, k -> new LinkedHashMap<>());
                String d = text(e, "description");
                String label = text(e, "label");
                String self = d.isEmpty() ? label : d;
                m.putIfAbsent("", self);                 // "" — описание самой схемы
                if (!table.isEmpty()) m.put(table, self);
            }
        } catch (RuntimeException ignore) {
            // подписи — приятное дополнение, а не условие работы обозревателя
        }
        return out;
    }

    private static String descrOf(Map<String, Map<String, Object>> d, String schema, String table) {
        Map<String, Object> m = d.get(schema);
        if (m == null) return "";
        Object v = m.get(table == null ? "" : table);
        return v == null ? "" : String.valueOf(v);
    }

    private static String pick(String first, String second) {
        return (first != null && !first.isBlank()) ? first : (second == null ? "" : second);
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private static long num(Object o) { return o instanceof Number n ? n.longValue() : 0L; }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText().trim();
    }
}
