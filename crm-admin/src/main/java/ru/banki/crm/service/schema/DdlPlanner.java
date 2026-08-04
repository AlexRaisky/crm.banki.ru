package ru.banki.crm.service.schema;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Модель Scheme Builder → SQL.
 * <p>
 * Правила взяты из генератора, который уже был в редакторе (exportSql в scheme-builder.js):
 * таблица на сущность, внешние ключи по связям, связующая таблица на many-to-many. Добавлено
 * главное, чего там не было — <b>квалификация по схемам</b>: сущность это схема, её таблицы
 * лежат внутри неё, и ссылаться между схемами можно свободно.
 * <p>
 * Модель читается терпимо к обоим уровням вложенности. Пока сущность одноуровневая
 * (сама себе таблица), схемой считается её id; когда у сущности появится явная
 * принадлежность схеме, берётся она. Так генератор работает и на сегодняшних данных,
 * и на двухуровневых, без переключателей.
 * <p>
 * Планировщик <b>ничего не выполняет</b> и в базу не смотрит — только строит инструкции.
 * Все они идемпотентны и аддитивны: повторный прогон ничего не ломает, а разрушительного
 * тут нет вовсе (ни DROP, ни RENAME, ни смены типа).
 */
public final class DdlPlanner {

    /** Допустимый идентификатор Postgres без кавычек: с буквы или подчёркивания, до 63 символов. */
    private static final Pattern IDENT = Pattern.compile("[a-z_][a-z0-9_]{0,62}");

    /** db_type = relation — это не колонка, а пометка о связи; в таблицу не идёт. */
    private static final String RELATION = "relation";

    /** Одна инструкция плана. */
    public record Stmt(String kind, String schema, String table, String sql) {}

    /** Результат планирования: инструкции и то, что не удалось разобрать. */
    public record Plan(List<Stmt> statements, List<String> problems, List<String> schemas) {}

    private DdlPlanner() {}

    public static Plan plan(JsonNode model) {
        List<Stmt> out = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        LinkedHashSet<String> schemas = new LinkedHashSet<>();
        Map<String, JsonNode> byId = new LinkedHashMap<>();

        JsonNode entities = model == null ? null : model.get("entities");
        if (entities == null || !entities.isArray() || entities.isEmpty()) {
            problems.add("В модели нет сущностей — создавать нечего");
            return new Plan(out, problems, List.of());
        }
        for (JsonNode e : entities) {
            String id = text(e, "id");
            if (!id.isEmpty()) byId.put(id, e);
        }

        // 1. Схемы. Отдельной инструкцией на каждую: так в предпросмотре видно, что появится
        //    новое пространство имён, а не только таблицы.
        for (JsonNode e : entities) {
            String schema = schemaOf(e);
            if (!valid(schema)) {
                problems.add("Недопустимое имя схемы: «" + schema + "» (сущность " + text(e, "id") + ")");
                continue;
            }
            if (schemas.add(schema)) {
                out.add(new Stmt("CREATE_SCHEMA", schema, null,
                        "CREATE SCHEMA IF NOT EXISTS " + schema + ";"));
            }
        }

        // 2. Таблицы.
        for (JsonNode e : entities) {
            String schema = schemaOf(e), table = tableOf(e);
            if (!valid(schema) || !valid(table)) {
                if (valid(schema)) problems.add("Недопустимое имя таблицы: «" + table + "»");
                continue;
            }
            List<String> cols = new ArrayList<>();
            List<Stmt> adds = new ArrayList<>();
            JsonNode fields = e.get("fields");
            if (fields != null && fields.isArray()) {
                for (JsonNode f : fields) {
                    String name = text(f, "name");
                    String dbType = text(f, "db_type");
                    if (RELATION.equals(dbType)) continue;      // связь, а не колонка
                    if (!valid(name)) {
                        problems.add("Недопустимое имя поля: «" + name + "» в " + schema + "." + table);
                        continue;
                    }
                    if (dbType.isEmpty()) dbType = "text";
                    cols.add("    " + name + " " + dbType + pk(name, dbType) + notNull(f, name) + def(f));
                    /* Отдельным ALTER — для таблиц, которые уже существуют: CREATE TABLE их
                       пропустит, и новое поле иначе не доехало бы. Здесь НЕТ ни NOT NULL,
                       ни PRIMARY KEY: на заполненной таблице такое падает, а мы обещали
                       только безопасные операции. */
                    adds.add(new Stmt("ADD_COLUMN", schema, table,
                            "ALTER TABLE " + schema + "." + table
                            + " ADD COLUMN IF NOT EXISTS " + name + " " + dbType + def(f) + ";"));
                }
            }
            if (cols.isEmpty()) {
                problems.add("У сущности " + schema + "." + table + " нет ни одной колонки");
                continue;
            }
            out.add(new Stmt("CREATE_TABLE", schema, table,
                    "CREATE TABLE IF NOT EXISTS " + schema + "." + table + " (\n"
                    + String.join(",\n", cols) + "\n);"));
            out.addAll(adds);
        }

        // 3. Внешние ключи по обычным связям.
        JsonNode relations = model.get("relations");
        if (relations != null && relations.isArray()) {
            for (JsonNode r : relations) {
                String type = text(r, "relation_type");
                if ("many_to_many".equals(type)) continue;
                JsonNode fe = byId.get(text(r, "from_entity"));
                JsonNode te = byId.get(text(r, "to_entity"));
                String fromField = text(r, "from_field");
                String toField = text(r, "to_field");
                if (fe == null || te == null || fromField.isEmpty()) continue;
                if (!valid(fromField) || !valid(toField.isEmpty() ? "id" : toField)) {
                    problems.add("Связь " + text(r, "id") + ": недопустимое имя поля");
                    continue;
                }
                String fs = schemaOf(fe), ft = tableOf(fe), ts = schemaOf(te), tt = tableOf(te);
                if (!valid(fs) || !valid(ft) || !valid(ts) || !valid(tt)) continue;
                String name = ("fk_" + fs + "_" + ft + "_" + fromField);
                if (name.length() > 63) name = name.substring(0, 63);
                String onDelete = onDelete(text(r, "on_delete"));
                /* Constraint нельзя завести через IF NOT EXISTS — оборачиваем проверкой
                   по каталогу, иначе повторное применение падало бы на дубликате. */
                out.add(new Stmt("ADD_FK", fs, ft,
                        "DO $$ BEGIN\n"
                        + "  IF NOT EXISTS (SELECT 1 FROM pg_constraint c\n"
                        + "                 JOIN pg_class t ON t.oid = c.conrelid\n"
                        + "                 JOIN pg_namespace n ON n.oid = t.relnamespace\n"
                        + "                 WHERE c.conname = '" + name + "'"
                        + " AND n.nspname = '" + fs + "' AND t.relname = '" + ft + "') THEN\n"
                        + "    ALTER TABLE " + fs + "." + ft + " ADD CONSTRAINT " + name + "\n"
                        + "      FOREIGN KEY (" + fromField + ") REFERENCES " + ts + "." + tt
                        + " (" + (toField.isEmpty() ? "id" : toField) + ") ON DELETE " + onDelete + ";\n"
                        + "  END IF;\nEND $$;"));
            }

            // 4. Связующие таблицы many-to-many.
            for (JsonNode r : relations) {
                if (!"many_to_many".equals(text(r, "relation_type"))) continue;
                JsonNode fe = byId.get(text(r, "from_entity"));
                JsonNode te = byId.get(text(r, "to_entity"));
                if (fe == null || te == null) continue;
                String fs = schemaOf(fe), ft = tableOf(fe), ts = schemaOf(te), tt = tableOf(te);
                if (!valid(fs) || !valid(ft) || !valid(ts) || !valid(tt)) continue;
                String through = text(r, "through");
                String link = through.isEmpty() ? (ft + "_" + tt + "_link") : through;
                if (!valid(link)) {
                    problems.add("Связь " + text(r, "id") + ": недопустимое имя связующей таблицы «" + link + "»");
                    continue;
                }
                /* Связующая таблица кладётся в схему ЛЕВОЙ сущности: она должна жить
                   ровно в одном месте, а «посередине» в Postgres не бывает. */
                String fromCol = text(r, "from_entity") + "_id";
                String toCol = text(r, "to_entity") + "_id";
                if (!valid(fromCol) || !valid(toCol) || fromCol.equals(toCol)) {
                    problems.add("Связь " + text(r, "id") + ": не удалось построить колонки связующей таблицы");
                    continue;
                }
                out.add(new Stmt("CREATE_TABLE", fs, link,
                        "CREATE TABLE IF NOT EXISTS " + fs + "." + link + " (\n"
                        + "    " + fromCol + " bigint NOT NULL REFERENCES " + fs + "." + ft + "(id) ON DELETE CASCADE,\n"
                        + "    " + toCol + " bigint NOT NULL REFERENCES " + ts + "." + tt + "(id) ON DELETE CASCADE,\n"
                        + "    PRIMARY KEY (" + fromCol + ", " + toCol + ")\n);"));
            }
        }
        return new Plan(out, problems, new ArrayList<>(schemas));
    }

    // --------------------------------------------------------------- раскладка

    /** Схема сущности: явная принадлежность, если задана, иначе сама сущность и есть схема. */
    public static String schemaOf(JsonNode e) {
        String s = text(e, "schema");
        return s.isEmpty() ? text(e, "id") : s;
    }

    /** Таблица сущности: поле table, иначе имя сущности. */
    public static String tableOf(JsonNode e) {
        String t = text(e, "table");
        return t.isEmpty() ? text(e, "id") : t;
    }

    public static boolean valid(String ident) {
        return ident != null && IDENT.matcher(ident).matches();
    }

    // --------------------------------------------------------------- мелочи

    private static String pk(String name, String dbType) {
        return ("id".equals(name) && dbType.toLowerCase().contains("serial")) ? " PRIMARY KEY" : "";
    }

    private static String notNull(JsonNode f, String name) {
        return (f.path("required").asBoolean(false) && !"id".equals(name)) ? " NOT NULL" : "";
    }

    private static String def(JsonNode f) {
        String d = text(f, "default_value");
        return d.isEmpty() ? "" : " DEFAULT " + d;
    }

    private static String onDelete(String v) {
        return switch (v == null ? "" : v.toUpperCase()) {
            case "CASCADE" -> "CASCADE";
            case "SET NULL" -> "SET NULL";
            case "NO ACTION" -> "NO ACTION";
            default -> "RESTRICT";
        };
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText().trim();
    }
}
