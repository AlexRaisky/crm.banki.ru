package ru.banki.crm.service.schema;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ru.banki.crm.security.CurrentUser;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Применение модели Scheme Builder к базе: схемы, таблицы, колонки, внешние ключи.
 * <p>
 * Три правила, вокруг которых всё построено:
 * <ol>
 *   <li><b>Применение модели — только аддитивное.</b> Ни RENAME, ни смены типа: их тут нет
 *       физически, а не «запрещены флагом». Удаление вынесено в отдельные ручки
 *       (колонка, таблица, схема), каждая со своим подтверждением, — случайно потерять
 *       данные, нажимая «Применить», нельзя.</li>
 *   <li><b>Только своё.</b> Трогаем схему, если она либо ещё не существует, либо
 *       числится за билдером в app.schema_owned. Чужую схему <b>обходим стороной</b>:
 *       такое уже есть и создано не нами, значит применяться не будет — ни сама схема,
 *       ни ссылки в неё. Наличие объекта в базе само по себе права не даёт.</li>
 *   <li><b>Ничего мимо журнала.</b> Успех пишется в той же транзакции, что и DDL —
 *       иначе можно было бы применить и не записать. Отказ пишется ОТДЕЛЬНОЙ
 *       транзакцией после отката: та, что упала, унесла бы запись с собой, а
 *       неудачные попытки как раз самое интересное при разборе.</li>
 * </ol>
 */
@Service
public class SchemaDdlService {

    /** Нарушение охраны: не ошибка выполнения, а отказ до него. */
    static class GuardViolation extends RuntimeException {
        GuardViolation(String message) { super(message); }
    }

    /** Инструкция не выполнилась. Несёт понятный текст: что именно и на чём. */
    static class DdlFailure extends RuntimeException {
        DdlFailure(String message, Throwable cause) { super(message, cause); }
    }

    @PersistenceContext
    private EntityManager em;

    private final TransactionTemplate tx;
    private final ru.banki.crm.service.SchemaModelService models;

    @Value("${app.env.name:prod}")
    private String envName;

    public SchemaDdlService(TransactionTemplate tx, ru.banki.crm.service.SchemaModelService models) {
        this.tx = tx;
        this.models = models;
    }

    // ------------------------------------------------------------ ПРЕДПРОСМОТР

    /**
     * Что будет выполнено — без выполнения. Возвращает инструкции, замечания планировщика
     * и список схем, которые будут обойдены, чтобы это было видно ДО нажатия «Применить».
     * У каждой инструкции есть признак {@code skip}: применится она или её пропустят.
     */
    public Map<String, Object> preview(JsonNode model) {
        DdlPlanner.Plan plan = DdlPlanner.plan(model);
        Snapshot snap = tx.execute(s -> new Snapshot(skips(plan.schemas()), existing()));
        List<Skip> skips = snap == null ? List.of() : snap.skips();
        Set<String> have = snap == null ? Set.of() : snap.have();
        Map<String, Skip> off = guard(skips);

        List<Map<String, Object>> stmts = new ArrayList<>();
        List<String> freshSql = new ArrayList<>();
        int already = 0;
        for (DdlPlanner.Stmt st : plan.statements()) {
            boolean skip = blocked(st, off, have);
            boolean exists = !skip && alreadyThere(st, have);
            if (exists) already++;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", st.kind());
            m.put("schema", st.schema() == null ? "" : st.schema());
            m.put("table", st.table() == null ? "" : st.table());
            m.put("name", st.name() == null ? "" : st.name());
            m.put("sql", st.sql());
            m.put("skip", skip);
            m.put("exists", exists);
            stmts.add(m);
            if (!skip && !exists) freshSql.add(st.sql());
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("statements", stmts);
        out.put("schemas", plan.schemas());
        out.put("problems", plan.problems());
        out.put("skipped", skips.stream()
                .map(s -> Map.of("schema", s.schema(), "reason", s.reason(),
                                 "newTablesOk", s.newTablesOk())).toList());
        out.put("applicable", freshSql.size());
        out.put("already", already);
        out.put("canApply", !freshSql.isEmpty());
        // в SQL показываем только то, что реально уедет: пропущенное и уже созданное
        // сбивало бы с толку — по этому тексту сверяют, что именно поменяется
        out.put("sql", String.join("\n\n", freshSql));
        return out;
    }

    /** Слепок базы на один заход: что трогать нельзя и что уже создано. */
    private record Snapshot(List<Skip> skips, Set<String> have) {}

    /**
     * Насколько база отстала от модели — коротко и по сущностям.
     * <p>
     * Тот же расчёт, что и у предпросмотра, но свёрнутый до чисел: сколько объектов
     * нарисовано и не создано, в каких схемах. Нужен в двух местах сразу — в конструкторе,
     * чтобы расхождение было видно рядом с сущностью, и в «Выкатках», где структуру
     * везут с контура на контур. Раньше ответ на этот вопрос добывался запросом в psql:
     * модель показывала поле, база о нём не знала, и заметить это можно было только
     * случайно.
     * <p>
     * Пропущенное охраной (защищённые схемы) в расхождения не считаем: это не отставание,
     * а запрет — «применить» его всё равно не сможет.
     */
    public Map<String, Object> drift(JsonNode model) {
        Map<String, Object> pv = preview(model);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> stmts = (List<Map<String, Object>>) pv.get("statements");

        List<Map<String, Object>> missing = new ArrayList<>();
        Map<String, Integer> bySchema = new LinkedHashMap<>();
        for (Map<String, Object> st : stmts) {
            if (Boolean.TRUE.equals(st.get("skip")) || Boolean.TRUE.equals(st.get("exists"))) {
                continue;
            }
            missing.add(st);
            String schema = String.valueOf(st.getOrDefault("schema", ""));
            bySchema.merge(schema, 1, Integer::sum);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("missing", missing.size());
        out.put("items", missing.size() > 200 ? missing.subList(0, 200) : missing);
        out.put("bySchema", bySchema);
        out.put("already", pv.get("already"));
        out.put("skipped", pv.get("skipped"));
        out.put("problems", pv.get("problems"));
        out.put("sql", pv.get("sql"));
        return out;
    }

    // ------------------------------------------------------------- ПРИМЕНЕНИЕ

    /** Выполнить план. Одна транзакция на всё: упало на середине — откатилось целиком. */
    public Map<String, Object> apply(JsonNode model) {
        DdlPlanner.Plan plan = DdlPlanner.plan(model);
        long started = System.currentTimeMillis();
        /* Причину запоминаем на месте падения. Дальше её может не стать: неудачный DDL
           иногда ломает соединение, и тогда откат бросает своё исключение поверх нашего —
           наружу уезжает бессмысленное «Unable to rollback against JDBC Connection»
           вместо того, что на самом деле сказал Postgres. */
        java.util.concurrent.atomic.AtomicReference<String> cause = new java.util.concurrent.atomic.AtomicReference<>();
        try {
            Map<String, Object> res = tx.execute(status -> {
                if (plan.statements().isEmpty()) throw new GuardViolation("Нечего применять");

                /* Недоступные схемы не отменяют применение целиком — их просто обходят.
                   Одна чужая схема в модели не повод не создавать пять своих, а отказ
                   от всего сразу выглядел бы как поломка. Пропуск идёт в журнал: молча
                   не сделать то, что человек видел в предпросмотре, нельзя. */
                List<Skip> skips = skips(plan.schemas());
                Map<String, Skip> off = guard(skips);
                for (Skip s : skips) {
                    audit("SKIP", s.schema(), null, null, "SKIPPED", s.reason(),
                            System.currentTimeMillis() - started);
                }
                /* Уже созданное не переприменяем. Инструкции идемпотентны, вреда бы не было,
                   но журнал заполнялся бы сотней записей «сделали то, что и так было», и
                   найти в нём настоящее изменение стало бы нельзя. */
                Set<String> have = existing();
                List<DdlPlanner.Stmt> run = plan.statements().stream()
                        .filter(st -> !blocked(st, off, have) && !alreadyThere(st, have)).toList();
                if (run.isEmpty()) throw new GuardViolation(
                        "Нечего применять: всё, что можно создать, в базе уже есть");

                int done = 0;
                Set<String> touchedSchemas = new LinkedHashSet<>();
                for (DdlPlanner.Stmt st : run) {
                    try {
                        em.createNativeQuery(st.sql()).executeUpdate();
                    } catch (RuntimeException e) {
                        String where = st.table() == null ? st.schema() : st.schema() + "." + st.table();
                        cause.set(st.kind() + " " + where + ": " + message(e));
                        throw new DdlFailure(cause.get(), e);
                    }
                    audit(st.kind(), st.schema(), st.table(), st.sql(), "OK", null,
                            System.currentTimeMillis() - started);
                    if (st.schema() != null) touchedSchemas.add(st.schema());
                    if (st.table() != null) own(st.schema(), st.table());
                    else own(st.schema(), null);
                    done++;
                }
                /* Итоговая запись — здесь же, внутри транзакции. Снаружи её делать нельзя
                   дважды: EntityManager без транзакции на executeUpdate отвечает
                   «Executing an update/delete query», и успешное применение превращалось
                   в ошибку уже после того, как всё в базе состоялось. */
                audit("APPLY", null, null, null, "OK", null, System.currentTimeMillis() - started);

                Map<String, Object> m = new LinkedHashMap<>();
                m.put("applied", done);
                m.put("schemas", new ArrayList<>(touchedSchemas));
                long guarded = plan.statements().stream().filter(st -> blocked(st, off, have)).count();
                m.put("skipped", guarded);
                m.put("already", plan.statements().size() - run.size() - guarded);
                m.put("skippedSchemas", new ArrayList<>(off.keySet()));
                return m;
            });
            return res;
        } catch (GuardViolation g) {
            auditSeparately("APPLY", "REJECTED", g.getMessage(), System.currentTimeMillis() - started);
            throw g;
        } catch (RuntimeException e) {
            String why = cause.get() != null ? cause.get() : message(e);
            auditSeparately("APPLY", "ERROR", why, System.currentTimeMillis() - started);
            throw new DdlFailure(why, e);
        }
    }

    // ----------------------------------------------------------------- ОХРАНА

    /**
     * Схема под охраной: что именно ей запрещено и почему.
     * <p>
     * {@code newTablesOk} различает два случая, которые раньше были свалены в один.
     * Схема из стоп-листа (app.schema_reserved) — наша, просто её существующие
     * таблицы трогать нельзя: это боевые справочники, и колонка, доехавшая туда
     * по недосмотру, ломает синхронизацию с продом. Заводить в ней НОВЫЕ таблицы
     * при этом можно и нужно. Чужая же схема — та, что существует и за билдером
     * не числится, — закрыта целиком: в ней и создавать нечего, мы её не ведём.
     */
    public record Skip(String schema, String reason, boolean newTablesOk) {}

    /**
     * Какие из этих схем трогать нельзя. Пусто — путь свободен весь.
     * <p>
     * Схема запретна → мимо. Схема существует, но за билдером не числится → мимо:
     * это чужое, и «доводить до модели» его нельзя. Схемы нет вовсе → создаём, это наше.
     */
    private List<Skip> skips(List<String> schemas) {
        List<Skip> out = new ArrayList<>();
        for (String s : schemas) {
            if (!DdlPlanner.valid(s)) {
                out.add(new Skip(s, "недопустимое имя схемы", false));
                continue;
            }
            String reserved = reservedReason(s);
            if (reserved != null) {
                out.add(new Skip(s, "существующие таблицы защищены, новые создавать можно"
                        + (reserved.isBlank() ? "" : " (" + reserved + ")"), true));
                continue;
            }
            if (existsInDb(s) && !isOwned(s)) {
                out.add(new Skip(s, "уже есть в базе и заведена не билдером", false));
            }
        }
        return out;
    }

    private static Map<String, Skip> guard(List<Skip> skips) {
        Map<String, Skip> out = new LinkedHashMap<>();
        if (skips != null) for (Skip s : skips) out.put(s.schema(), s);
        return out;
    }

    /**
     * Инструкцию выполнять нельзя?
     * <p>
     * Чужая схема закрыта целиком, и считаем по всем схемам инструкции, а не только по
     * целевой: внешний ключ живёт в нашей таблице, но вешает constraint на ту, куда
     * ссылается — такое тоже мимо.
     * <p>
     * Схема из стоп-листа устроена мягче: закрыты её СУЩЕСТВУЮЩИЕ таблицы, а не она сама.
     * Новую таблицу в ней завести можно, вместе с её колонками и ключами — ничего чужого
     * это не трогает. А вот колонка в уже существующую не пройдёт: там боевые справочники,
     * и лишнее поле ломает синхронизацию с продом. Ссылаться на такую таблицу извне
     * разрешаем: внешний ключ создаётся на СВОЕЙ таблице и структуру защищённой не меняет.
     * Саму схему не создаём — она и так есть.
     */
    private static boolean blocked(DdlPlanner.Stmt st, Map<String, Skip> guard, Set<String> have) {
        if (guard.isEmpty()) return false;
        for (String r : st.refs()) {
            Skip s = guard.get(r);
            if (s != null && !s.newTablesOk()) return true;
        }
        Skip own = guard.get(st.schema());
        if (own == null) return false;
        if (!own.newTablesOk()) return true;
        if ("CREATE_SCHEMA".equals(st.kind())) return true;
        return st.table() != null && have.contains("T:" + st.schema() + "." + st.table());
    }

    // -------------------------------------------------------- ЧТО УЖЕ ЕСТЬ В БАЗЕ

    /**
     * Снимок того, что в базе уже создано: схемы, таблицы, колонки, внешние ключи.
     * <p>
     * Планировщик в базу не смотрит и всегда выдаёт полный список инструкций — они
     * идемпотентны (IF NOT EXISTS), и повторный прогон безвреден. Но человеку от этого
     * не легче: после успешного применения предпросмотр показывал те же 118 операций,
     * и понять, осталось ли что-то новое, было нельзя. Сверяемся с фактом и помечаем
     * каждую инструкцию: она создаст объект или он уже есть.
     */
    private Set<String> existing() {
        Set<String> have = new java.util.HashSet<>();
        /* Спрашиваем pg_catalog, а не information_schema, и по трём разным причинам —
           каждая из них однажды заставила бы предпросмотр соврать.

           information_schema.schemata показывает ТОЛЬКО схемы, принадлежащие текущей
           роли: чужая выглядела бы несуществующей, охрана считала бы её нашей и пустила
           бы билдер внутрь. information_schema.tables и .columns, наоборот, показывают
           лишнее — представления и сторонние таблицы наравне с обычными: представление
           с именем таблицы помечало бы её как «уже есть», хотя таблицы нет и создана
           она не будет. relkind IN ('r','p') — ровно то же условие, по которому строит
           список обозреватель схем; иначе два экрана в одной админке отвечают на один
           вопрос по-разному. */
        addAll(have, "SELECT 'S:' || nspname FROM pg_namespace");
        addAll(have, "SELECT 'T:' || n.nspname || '.' || c.relname" +
                     "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace" +
                     " WHERE c.relkind IN ('r','p')");
        addAll(have, "SELECT 'C:' || n.nspname || '.' || c.relname || '.' || a.attname" +
                     "  FROM pg_attribute a" +
                     "  JOIN pg_class c ON c.oid = a.attrelid" +
                     "  JOIN pg_namespace n ON n.oid = c.relnamespace" +
                     " WHERE c.relkind IN ('r','p')" +
                     "   AND a.attnum > 0 AND NOT a.attisdropped");
        addAll(have, "SELECT 'F:' || n.nspname || '.' || t.relname || '.' || c.conname" +
                     "  FROM pg_constraint c" +
                     "  JOIN pg_class t ON t.oid = c.conrelid" +
                     "  JOIN pg_namespace n ON n.oid = t.relnamespace");
        return have;
    }

    private void addAll(Set<String> into, String sql) {
        @SuppressWarnings("unchecked")
        List<Object> rows = em.createNativeQuery(sql).getResultList();
        for (Object o : rows) if (o != null) into.add(String.valueOf(o));
    }

    /** Объект этой инструкции уже создан? Инструкцию без опознавательного ключа считаем новой. */
    private static boolean alreadyThere(DdlPlanner.Stmt st, Set<String> have) {
        return switch (st.kind()) {
            case "CREATE_SCHEMA" -> have.contains("S:" + st.schema());
            case "CREATE_TABLE" -> have.contains("T:" + st.schema() + "." + st.table());
            case "ADD_COLUMN" -> st.name() != null
                    && have.contains("C:" + st.schema() + "." + st.table() + "." + st.name());
            case "ADD_FK" -> st.name() != null
                    && have.contains("F:" + st.schema() + "." + st.table() + "." + st.name());
            default -> false;
        };
    }

    /** Причина из стоп-листа, либо null, если схема в нём не значится. */
    private String reservedReason(String schema) {
        @SuppressWarnings("unchecked")
        List<Object> rows = em.createNativeQuery(
                        "SELECT coalesce(reason, '') FROM app.schema_reserved WHERE schema_name = :s")
                .setParameter("s", schema).getResultList();
        return rows.isEmpty() ? null : String.valueOf(rows.get(0));
    }

    /**
     * Схема есть в базе? По pg_namespace, а не по information_schema.schemata: последняя
     * показывает только схемы, принадлежащие текущей роли, и чужая выглядела бы
     * несуществующей. А «схемы нет» здесь означает «она наша, можно создавать» — то есть
     * ровно на чужой схеме охрана и открывалась бы.
     */
    private boolean existsInDb(String schema) {
        Number n = (Number) em.createNativeQuery(
                        "SELECT count(*) FROM pg_namespace WHERE nspname = :s")
                .setParameter("s", schema).getSingleResult();
        return n.intValue() > 0;
    }

    private boolean isOwned(String schema) {
        Number n = (Number) em.createNativeQuery(
                        "SELECT count(*) FROM app.schema_owned WHERE schema_name = :s AND env = :e")
                .setParameter("s", schema).setParameter("e", envName).getSingleResult();
        return n.intValue() > 0;
    }

    private void own(String schema, String table) {
        if (schema == null) return;
        em.createNativeQuery(
                        "INSERT INTO app.schema_owned (schema_name, table_name, env, created_by)" +
                        " VALUES (:s, :t, :e, :u) ON CONFLICT DO NOTHING")
                .setParameter("s", schema)
                .setParameter("t", table)
                .setParameter("e", envName)
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
    }

    // ------------------------------------------------------- УДАЛЕНИЕ КОЛОНОК

    /**
     * Что мешает удалить колонку: внешний ключ на ней самой или чужой, ссылающийся в неё.
     * {@code inbound} — ссылка ИЗ другой таблицы: её удаление рвёт связь у соседа,
     * и спрашивать про неё надо отдельно от собственных ограничений таблицы.
     */
    public record DropDep(String kind, String constraint, String schema, String table,
                          String column, boolean inbound) {}

    /**
     * Колонки, которых в модели больше нет, но в базе они ещё есть.
     * <p>
     * Ищем только по таблицам, <b>заведённым билдером</b> (app.schema_owned): колонку в
     * чужой таблице мы не создавали и удалять не станем, даже если её нет в модели —
     * скорее всего её там никогда и не было. Схемы, которые применение обходит, тоже мимо.
     * <p>
     * Считаем заполненность и собираем зависимости, чтобы человек решал не вслепую:
     * «удалить вместе с данными» и «удалить со связью» — разные решения, и принимать
     * их надо, видя, сколько строк заполнено и кто на колонку ссылается.
     */
    public Map<String, Object> dropCandidates(JsonNode model) {
        Model want = modelTables(model);
        return tx.execute(s -> {
            /* Мимо только схемы, закрытые целиком. Схему из стоп-листа не исключаем:
               кандидатами и так становятся лишь таблицы из app.schema_owned, то есть
               заведённые самим билдером, — а их он вправе и править. Боевые справочники
               в реестр не попадали никогда и сюда не придут. */
            Set<String> off = new LinkedHashSet<>();
            for (Skip g : skips(want.schemas())) if (!g.newTablesOk()) off.add(g.schema());
            List<Map<String, Object>> out = new ArrayList<>();
            for (String key : ownedTables()) {
                Set<String> cols = want.tables().get(key);
                if (cols == null) continue;                      // таблицы нет в модели — таблицы не удаляем
                String schema = key.substring(0, key.indexOf('.'));
                String table = key.substring(key.indexOf('.') + 1);
                if (off.contains(schema)) continue;
                for (Object[] c : dbColumns(schema, table)) {
                    String name = String.valueOf(c[0]);
                    if (cols.contains(name)) continue;
                    out.add(candidate(schema, table, name, String.valueOf(c[1]), cols));
                }
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("candidates", out);
            return m;
        });
    }

    /** Одна колонка-сирота вместе со всем, что нужно для решения о ней. */
    private Map<String, Object> candidate(String schema, String table, String column,
                                          String type, Set<String> modelCols) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("schema", schema);
        m.put("table", table);
        m.put("column", column);
        m.put("type", type);
        Object[] counts = counts(schema, table, column);
        m.put("rows", counts[0]);
        m.put("filled", counts[1]);
        List<Map<String, String>> siblings = new ArrayList<>();
        for (Object[] c : dbColumns(schema, table)) {
            String n = String.valueOf(c[0]);
            if (n.equals(column) || !modelCols.contains(n)) continue;
            siblings.add(Map.of("name", n, "type", String.valueOf(c[1])));
        }
        m.put("siblings", siblings);
        m.put("deps", deps(schema, table, column).stream()
                .map(d -> {
                    Map<String, Object> x = new LinkedHashMap<>();
                    x.put("kind", d.kind());
                    x.put("constraint", d.constraint());
                    x.put("schema", d.schema());
                    x.put("table", d.table());
                    x.put("column", d.column());
                    x.put("inbound", d.inbound());
                    return x;
                }).toList());
        return m;
    }

    /**
     * Выполнить удаление. Решения приходят с фронта, но кандидатов пересчитываем здесь
     * заново: тело запроса — это не разрешение. Удалить можно только ту колонку, которая
     * и по нашему счёту лишняя, в нашей таблице и в доступной схеме.
     * <p>
     * Порядок внутри одной транзакции: сначала снять мешающие связи, потом перенести
     * данные, и только затем DROP COLUMN. Иначе перенос читал бы уже удалённое.
     */
    public Map<String, Object> dropColumns(JsonNode model, JsonNode drops) {
        long started = System.currentTimeMillis();
        Map<String, Object> plan = dropCandidates(model);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cands = (List<Map<String, Object>>) plan.get("candidates");
        Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
        for (Map<String, Object> c : cands) {
            byKey.put(c.get("schema") + "." + c.get("table") + "." + c.get("column"), c);
        }
        java.util.concurrent.atomic.AtomicReference<String> cause = new java.util.concurrent.atomic.AtomicReference<>();
        try {
            return tx.execute(status -> {
                if (drops == null || !drops.isArray() || drops.isEmpty())
                    throw new GuardViolation("Не выбрано ни одной колонки");
                int dropped = 0, links = 0;
                List<String> notes = new ArrayList<>();
                for (JsonNode d : drops) {
                    String schema = txt(d, "schema"), table = txt(d, "table"), column = txt(d, "column");
                    String key = schema + "." + table + "." + column;
                    Map<String, Object> c = byKey.get(key);
                    if (c == null) throw new GuardViolation(
                            "Колонку " + key + " удалять нельзя: она либо есть в модели,"
                            + " либо таблица заведена не билдером");
                    if (!DdlPlanner.valid(schema) || !DdlPlanner.valid(table) || !DdlPlanner.valid(column))
                        throw new GuardViolation("Недопустимое имя: " + key);

                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> deps = (List<Map<String, Object>>) c.get("deps");
                    if (!deps.isEmpty() && !"drop".equals(txt(d, "deps")))
                        throw new GuardViolation("У колонки " + key + " есть связи —"
                                + " решение по ним не принято");

                    try {
                        for (Map<String, Object> dep : deps) {
                            String sql = "ALTER TABLE " + dep.get("schema") + "." + dep.get("table")
                                    + " DROP CONSTRAINT IF EXISTS " + dep.get("constraint") + ";";
                            em.createNativeQuery(sql).executeUpdate();
                            audit("DROP_CONSTRAINT", String.valueOf(dep.get("schema")),
                                    String.valueOf(dep.get("table")), sql, "OK", null,
                                    System.currentTimeMillis() - started);
                            links++;
                        }
                        if ("move".equals(txt(d, "data"))) {
                            String target = txt(d, "target");
                            if (!DdlPlanner.valid(target)) throw new GuardViolation(
                                    "Не выбрана колонка, куда переносить данные из " + key);
                            boolean ok = ((List<?>) c.get("siblings")).stream()
                                    .anyMatch(x -> target.equals(((Map<?, ?>) x).get("name")));
                            if (!ok) throw new GuardViolation(
                                    "Колонка " + target + " не годится как приёмник для " + key);
                            /* Переносим только туда, где пусто: перезаписывать заполненное
                               нельзя — это уничтожило бы данные, о которых никто не спрашивал. */
                            String sql = "UPDATE " + schema + "." + table
                                    + " SET " + target + " = " + column + "::" + typeOf(schema, table, target)
                                    + " WHERE " + column + " IS NOT NULL AND " + target + " IS NULL";
                            int moved = em.createNativeQuery(sql).executeUpdate();
                            audit("MOVE_DATA", schema, table, sql, "OK", null,
                                    System.currentTimeMillis() - started);
                            notes.add(key + " → " + target + ": перенесено строк " + moved);
                        }
                        String sql = "ALTER TABLE " + schema + "." + table
                                + " DROP COLUMN IF EXISTS " + column + ";";
                        em.createNativeQuery(sql).executeUpdate();
                        audit("DROP_COLUMN", schema, table, sql, "OK", null,
                                System.currentTimeMillis() - started);
                        dropped++;
                    } catch (GuardViolation g) {
                        throw g;
                    } catch (RuntimeException e) {
                        cause.set("DROP_COLUMN " + key + ": " + message(e));
                        throw new DdlFailure(cause.get(), e);
                    }
                }
                audit("DROP", null, null, null, "OK", null, System.currentTimeMillis() - started);
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("dropped", dropped);
                m.put("links", links);
                m.put("notes", notes);
                return m;
            });
        } catch (GuardViolation g) {
            auditSeparately("DROP", "REJECTED", g.getMessage(), System.currentTimeMillis() - started);
            throw g;
        } catch (RuntimeException e) {
            String why = cause.get() != null ? cause.get() : message(e);
            auditSeparately("DROP", "ERROR", why, System.currentTimeMillis() - started);
            throw new DdlFailure(why, e);
        }
    }

    // ------------------------------------------------- ВЗЯТЬ ПОД УПРАВЛЕНИЕ

    /**
     * Взять существующие таблицы схемы под управление билдера.
     * <p>
     * Реестр app.schema_owned — это ответ на вопрос «чьё», и раздаётся он не молча: до
     * сих пор запись появлялась только когда билдер создавал объект сам. Но в схеме, где
     * он работает, часть таблиц приходит миграциями, и делать вид, что их нет, — значит
     * показывать человеку неполную картину. Поэтому берём под управление явным действием:
     * админ видит список, выбирает таблицы, и это уходит в журнал.
     * <p>
     * Защита та же: схемы из стоп-листа не трогаем ни при каких условиях.
     */
    public Map<String, Object> adopt(String schema, List<String> tables) {
        long started = System.currentTimeMillis();
        try {
            return tx.execute(status -> {
                if (!DdlPlanner.valid(schema)) {
                    throw new GuardViolation("Недопустимое имя схемы: «" + schema + "»");
                }
                String reserved = reservedReason(schema);
                if (reserved != null) throw new GuardViolation("Схема " + schema + " защищена: " + reserved);
                if (tables == null || tables.isEmpty()) throw new GuardViolation("Не выбрано ни одной таблицы");

                List<String> taken = new ArrayList<>();
                for (String t : tables) {
                    if (!DdlPlanner.valid(t)) throw new GuardViolation("Недопустимое имя таблицы: «" + t + "»");
                    Object reg = em.createNativeQuery("SELECT to_regclass(:t)")
                            .setParameter("t", schema + "." + t).getSingleResult();
                    if (reg == null) throw new GuardViolation("Таблицы " + schema + "." + t + " нет в базе");
                    own(schema, null);       // схема тоже наша: иначе правки в ней обойдёт охрана
                    own(schema, t);
                    taken.add(t);
                }
                audit("ADOPT", schema, String.join(", ", taken), null, "OK", null,
                        System.currentTimeMillis() - started);

                Map<String, Object> m = new LinkedHashMap<>();
                m.put("schema", schema);
                m.put("adopted", taken);
                return m;
            });
        } catch (GuardViolation g) {
            auditSeparately("ADOPT", "REJECTED", g.getMessage(), System.currentTimeMillis() - started);
            throw g;
        } catch (RuntimeException e) {
            String why = message(e);
            auditSeparately("ADOPT", "ERROR", why, System.currentTimeMillis() - started);
            throw e instanceof DdlFailure ? e : new DdlFailure(why, e);
        }
    }

    // ------------------------------------------------- УДАЛЕНИЕ ТАБЛИЦ И СХЕМ

    /** Кто ссылается на таблицу извне: чужой внешний ключ, который снимется вместе с ней. */
    public record TableRef(String constraint, String schema, String table, String columns) {}

    /**
     * Что нужно знать до удаления: сколько в таблице строк и кто на неё ссылается.
     * <p>
     * Отдельной ручкой, а не «удалим и посмотрим»: число строк — единственное, что
     * отличает пустую заготовку от таблицы с данными, и увидеть его человек должен
     * ДО нажатия, а не в отчёте об удалении.
     */
    public Map<String, Object> tableInfo(String schema, String table) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("schema", schema);
        m.put("table", table);
        String why = undroppable(schema, table);
        m.put("droppable", why == null);
        m.put("reason", why);
        m.put("rows", why == null ? rowCount(schema, table) : null);
        m.put("refs", why == null ? inboundRefs(schema, table) : List.of());
        return m;
    }

    /**
     * Удалить таблицу вместе с её сущностью в модели.
     * <p>
     * Охрана та же, что у остальных разрушительных действий, плюс одно правило сверх неё:
     * непустую таблицу удаляем, только если в запросе принесли ровно то число строк, которое
     * человек видел в диалоге. Разошлось — значит за это время в таблицу писали, и удаляют
     * уже не тот объект, про который спрашивали.
     * <p>
     * Сущность вычищаем из модели в той же транзакции. Иначе следующее «Применить» создало
     * бы таблицу заново, и удаление выглядело бы как поломка билдера.
     */
    public Map<String, Object> dropTable(String schema, String table, boolean cascade, Long confirmRows) {
        long started = System.currentTimeMillis();
        try {
            return tx.execute(status -> {
                String why = undroppable(schema, table);
                if (why != null) throw new GuardViolation(why);

                long rows = rowCount(schema, table);
                if (rows > 0 && confirmRows == null) {
                    throw new GuardViolation("В таблице " + schema + "." + table + " строк: " + rows
                            + ". Удаление их уничтожит — подтвердите его отдельно.");
                }
                if (rows > 0 && confirmRows != rows) {
                    throw new GuardViolation("В таблице " + schema + "." + table + " сейчас строк: " + rows
                            + ", а подтверждали " + confirmRows + ". Данные изменились — откройте диалог заново.");
                }

                List<TableRef> refs = inboundRefs(schema, table);
                if (!refs.isEmpty() && !cascade) {
                    List<String> names = new ArrayList<>();
                    for (TableRef r : refs) names.add(r.schema() + "." + r.table() + " (" + r.columns() + ")");
                    throw new GuardViolation("На таблицу ссылаются: " + String.join(", ", names)
                            + ". Удаление снимет эти связи — подтвердите отдельно.");
                }

                String sql = "DROP TABLE " + schema + "." + table + (cascade ? " CASCADE" : "") + ";";
                try {
                    em.createNativeQuery(sql).executeUpdate();
                } catch (RuntimeException e) {
                    throw new DdlFailure("DROP TABLE " + schema + "." + table + ": " + message(e), e);
                }
                em.createNativeQuery("DELETE FROM app.schema_owned WHERE schema_name = :s"
                                + " AND table_name = :t AND env = :e")
                        .setParameter("s", schema).setParameter("t", table).setParameter("e", envName)
                        .executeUpdate();
                int entities = removeFromModel(schema, table);
                audit("DROP_TABLE", schema, table, sql, "OK", null, System.currentTimeMillis() - started);

                Map<String, Object> m = new LinkedHashMap<>();
                m.put("dropped", schema + "." + table);
                m.put("rows", rows);
                m.put("links", refs.size());
                m.put("entities", entities);
                return m;
            });
        } catch (GuardViolation g) {
            auditSeparately("DROP_TABLE", "REJECTED", g.getMessage(), System.currentTimeMillis() - started);
            throw g;
        } catch (RuntimeException e) {
            String why = message(e);
            auditSeparately("DROP_TABLE", "ERROR", why, System.currentTimeMillis() - started);
            throw e instanceof DdlFailure ? e : new DdlFailure(why, e);
        }
    }

    /**
     * Удалить схему. Только пустую и только свою: RESTRICT здесь не перестраховка, а
     * единственная разумная семантика — CASCADE снёс бы вместе со схемой всё, что в ней
     * успели завести, включая то, чего билдер не создавал.
     */
    public Map<String, Object> dropSchema(String schema) {
        long started = System.currentTimeMillis();
        try {
            return tx.execute(status -> {
                if (!DdlPlanner.valid(schema)) {
                    throw new GuardViolation("Недопустимое имя схемы: «" + schema + "»");
                }
                String reserved = reservedReason(schema);
                if (reserved != null) throw new GuardViolation("Схема " + schema + " защищена: " + reserved);
                if (!isOwned(schema)) {
                    throw new GuardViolation("Схема " + schema + " заведена не билдером — удалять её отсюда нельзя");
                }
                long objects = ((Number) em.createNativeQuery(
                                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
                                + " WHERE n.nspname = :s AND c.relkind IN ('r','p','v','m','S','f')")
                        .setParameter("s", schema).getSingleResult()).longValue();
                if (objects > 0) {
                    throw new GuardViolation("В схеме " + schema + " ещё есть объекты (" + objects
                            + ") — сначала удалите таблицы.");
                }

                String sql = "DROP SCHEMA " + schema + " RESTRICT;";
                try {
                    em.createNativeQuery(sql).executeUpdate();
                } catch (RuntimeException e) {
                    throw new DdlFailure("DROP SCHEMA " + schema + ": " + message(e), e);
                }
                em.createNativeQuery("DELETE FROM app.schema_owned WHERE schema_name = :s AND env = :e")
                        .setParameter("s", schema).setParameter("e", envName)
                        .executeUpdate();
                audit("DROP_SCHEMA", schema, null, sql, "OK", null, System.currentTimeMillis() - started);

                Map<String, Object> m = new LinkedHashMap<>();
                m.put("dropped", schema);
                return m;
            });
        } catch (GuardViolation g) {
            auditSeparately("DROP_SCHEMA", "REJECTED", g.getMessage(), System.currentTimeMillis() - started);
            throw g;
        } catch (RuntimeException e) {
            String why = message(e);
            auditSeparately("DROP_SCHEMA", "ERROR", why, System.currentTimeMillis() - started);
            throw e instanceof DdlFailure ? e : new DdlFailure(why, e);
        }
    }

    /** Причина, по которой таблицу трогать нельзя, либо null, если можно. */
    private String undroppable(String schema, String table) {
        if (!DdlPlanner.valid(schema) || !DdlPlanner.valid(table)) {
            return "Недопустимое имя: " + schema + "." + table;
        }
        String reserved = reservedReason(schema);
        if (reserved != null) return "Схема " + schema + " защищена: " + reserved;
        if (!isOwnedTable(schema, table)) {
            return "Таблица " + schema + "." + table + " заведена не билдером — удалять её отсюда нельзя";
        }
        Object reg = em.createNativeQuery("SELECT to_regclass(:t)")
                .setParameter("t", schema + "." + table).getSingleResult();
        if (reg == null) return "Таблицы " + schema + "." + table + " нет в базе";
        return null;
    }

    private boolean isOwnedTable(String schema, String table) {
        Number n = (Number) em.createNativeQuery(
                        "SELECT count(*) FROM app.schema_owned"
                        + " WHERE schema_name = :s AND table_name = :t AND env = :e")
                .setParameter("s", schema).setParameter("t", table).setParameter("e", envName)
                .getSingleResult();
        return n.intValue() > 0;
    }

    /** Точный count(*): решение принимают по нему, оценка планировщика тут не годится. */
    private long rowCount(String schema, String table) {
        Number n = (Number) em.createNativeQuery("SELECT count(*) FROM " + schema + "." + table)
                .getSingleResult();
        return n.longValue();
    }

    /** Внешние ключи ИЗ других таблиц в эту: их снимет только CASCADE. */
    @SuppressWarnings("unchecked")
    private List<TableRef> inboundRefs(String schema, String table) {
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT c.conname, n.nspname, t.relname,"
                        + "       (SELECT string_agg(a.attname, ', ') FROM unnest(c.conkey) k"
                        + "          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)"
                        + "  FROM pg_constraint c"
                        + "  JOIN pg_class t ON t.oid = c.conrelid"
                        + "  JOIN pg_namespace n ON n.oid = t.relnamespace"
                        + "  JOIN pg_class rt ON rt.oid = c.confrelid"
                        + "  JOIN pg_namespace rn ON rn.oid = rt.relnamespace"
                        + " WHERE c.contype = 'f' AND rn.nspname = :s AND rt.relname = :t"
                        + "   AND t.oid <> rt.oid")
                .setParameter("s", schema).setParameter("t", table).getResultList();
        List<TableRef> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(new TableRef(String.valueOf(r[0]), String.valueOf(r[1]),
                    String.valueOf(r[2]), r[3] == null ? "" : String.valueOf(r[3])));
        }
        return out;
    }

    /**
     * Убрать сущность этой таблицы из модели вместе со связями, в которых она участвует.
     * Возвращает число убранных сущностей: обычно одна, но модель этого не гарантирует.
     */
    private int removeFromModel(String schema, String table) {
        JsonNode stored = models.storedAsNode();
        JsonNode entities = stored == null ? null : stored.get("entities");
        if (entities == null || !entities.isArray()) return 0;

        ObjectNode root = (ObjectNode) stored.deepCopy();
        ArrayNode keep = JsonNodeFactory.instance.arrayNode();
        Set<String> gone = new LinkedHashSet<>();
        for (JsonNode e : entities) {
            if (schema.equals(DdlPlanner.schemaOf(e)) && table.equals(DdlPlanner.tableOf(e))) {
                gone.add(e.path("id").asText(""));
                continue;
            }
            keep.add(e);
        }
        if (gone.isEmpty()) return 0;
        root.set("entities", keep);

        JsonNode relations = root.get("relations");
        if (relations != null && relations.isArray()) {
            ArrayNode keepRels = JsonNodeFactory.instance.arrayNode();
            for (JsonNode r : relations) {
                if (gone.contains(r.path("from_entity").asText(""))
                        || gone.contains(r.path("to_entity").asText(""))) continue;
                keepRels.add(r);
            }
            root.set("relations", keepRels);
        }

        ArrayNode changes = JsonNodeFactory.instance.arrayNode();
        for (String id : gone) {
            ObjectNode c = JsonNodeFactory.instance.objectNode();
            c.put("op", "delete");
            c.put("target", "entity");
            c.put("id", id);
            changes.add(c);
        }
        models.save(root, changes);
        return gone.size();
    }

    /** Модель в виде «схема.таблица → колонки». Схемы нужны отдельно: по ним считается охрана. */
    private record Model(Map<String, Set<String>> tables, List<String> schemas) {}

    /**
     * Разбор модели под удаление. Читаем ровно то же, что планировщик кладёт в CREATE TABLE,
     * иначе колонка, которая в модели есть, попала бы в кандидаты на снос.
     * <p>
     * Связующие таблицы many-to-many в разбор НЕ идут: их колонки модель не перечисляет,
     * и без этого правила билдер предложил бы удалить у них вообще всё.
     */
    private static Model modelTables(JsonNode model) {
        Map<String, Set<String>> tables = new LinkedHashMap<>();
        LinkedHashSet<String> schemas = new LinkedHashSet<>();
        JsonNode entities = model == null ? null : model.get("entities");
        if (entities == null || !entities.isArray()) return new Model(tables, List.of());
        for (JsonNode e : entities) {
            String schema = DdlPlanner.schemaOf(e), table = DdlPlanner.tableOf(e);
            if (!DdlPlanner.valid(schema) || !DdlPlanner.valid(table)) continue;
            schemas.add(schema);
            Set<String> cols = new LinkedHashSet<>();
            JsonNode fields = e.get("fields");
            if (fields != null && fields.isArray()) {
                for (JsonNode f : fields) {
                    JsonNode t = f.get("db_type");
                    if (t != null && "relation".equals(t.asText())) continue;
                    JsonNode n = f.get("name");
                    if (n != null && !n.asText().isBlank()) cols.add(n.asText().trim());
                }
            }
            tables.put(schema + "." + table, cols);
        }
        /* Связующие таблицы вычёркиваем: они наши, но их состав задан кодом, а не полями. */
        JsonNode relations = model.get("relations");
        if (relations != null && relations.isArray()) {
            Map<String, JsonNode> byId = new LinkedHashMap<>();
            for (JsonNode e : entities) byId.put(e.path("id").asText(""), e);
            for (JsonNode r : relations) {
                if (!"many_to_many".equals(r.path("relation_type").asText(""))) continue;
                JsonNode fe = byId.get(r.path("from_entity").asText(""));
                JsonNode te = byId.get(r.path("to_entity").asText(""));
                if (fe == null || te == null) continue;
                String through = r.path("through").asText("");
                String link = through.isBlank()
                        ? DdlPlanner.tableOf(fe) + "_" + DdlPlanner.tableOf(te) + "_link" : through;
                tables.remove(DdlPlanner.schemaOf(fe) + "." + link);
            }
        }
        return new Model(tables, new ArrayList<>(schemas));
    }

    /** Таблицы, которые числятся за билдером в этой среде. */
    private List<String> ownedTables() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT schema_name, table_name FROM app.schema_owned" +
                        " WHERE env = :e AND table_name IS NOT NULL")
                .setParameter("e", envName).getResultList();
        List<String> out = new ArrayList<>();
        for (Object[] r : rows) out.add(r[0] + "." + r[1]);
        return out;
    }

    @SuppressWarnings("unchecked")
    private List<Object[]> dbColumns(String schema, String table) {
        return em.createNativeQuery(
                        "SELECT a.attname, format_type(a.atttypid, a.atttypmod)" +
                        "  FROM pg_attribute a" +
                        "  JOIN pg_class t ON t.oid = a.attrelid" +
                        "  JOIN pg_namespace n ON n.oid = t.relnamespace" +
                        " WHERE n.nspname = :s AND t.relname = :t" +
                        "   AND a.attnum > 0 AND NOT a.attisdropped" +
                        " ORDER BY a.attnum")
                .setParameter("s", schema).setParameter("t", table).getResultList();
    }

    private String typeOf(String schema, String table, String column) {
        for (Object[] c : dbColumns(schema, table)) {
            if (column.equals(String.valueOf(c[0]))) return String.valueOf(c[1]);
        }
        return "text";
    }

    /** Сколько всего строк и в скольких колонка заполнена. Пустую можно сносить не думая. */
    private Object[] counts(String schema, String table, String column) {
        try {
            Object[] r = (Object[]) em.createNativeQuery(
                            "SELECT count(*), count(" + column + ") FROM " + schema + "." + table)
                    .getSingleResult();
            return new Object[]{ ((Number) r[0]).longValue(), ((Number) r[1]).longValue() };
        } catch (RuntimeException e) {
            return new Object[]{ -1L, -1L };   // не посчиталось — покажем «неизвестно», а не соврём нулём
        }
    }

    /** Внешние ключи, которые придётся снять, чтобы колонка ушла. */
    @SuppressWarnings("unchecked")
    private List<DropDep> deps(String schema, String table, String column) {
        List<DropDep> out = new ArrayList<>();
        List<Object[]> own = em.createNativeQuery(
                        "SELECT c.conname FROM pg_constraint c" +
                        "  JOIN pg_class t ON t.oid = c.conrelid" +
                        "  JOIN pg_namespace n ON n.oid = t.relnamespace" +
                        " WHERE n.nspname = :s AND t.relname = :t AND c.contype = 'f'" +
                        "   AND EXISTS (SELECT 1 FROM unnest(c.conkey) k" +
                        "               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k" +
                        "               WHERE a.attname = :c)")
                .setParameter("s", schema).setParameter("t", table).setParameter("c", column)
                .getResultList();
        for (Object o : own) {
            out.add(new DropDep("fk", String.valueOf(o), schema, table, column, false));
        }
        List<Object[]> in = em.createNativeQuery(
                        "SELECT c.conname, n.nspname, t.relname," +
                        "       (SELECT string_agg(a.attname, ', ') FROM unnest(c.conkey) k" +
                        "          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)" +
                        "  FROM pg_constraint c" +
                        "  JOIN pg_class t ON t.oid = c.conrelid" +
                        "  JOIN pg_namespace n ON n.oid = t.relnamespace" +
                        "  JOIN pg_class rt ON rt.oid = c.confrelid" +
                        "  JOIN pg_namespace rn ON rn.oid = rt.relnamespace" +
                        " WHERE c.contype = 'f' AND rn.nspname = :s AND rt.relname = :t" +
                        "   AND EXISTS (SELECT 1 FROM unnest(c.confkey) k" +
                        "               JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k" +
                        "               WHERE a.attname = :c)")
                .setParameter("s", schema).setParameter("t", table).setParameter("c", column)
                .getResultList();
        for (Object[] r : in) {
            out.add(new DropDep("fk", String.valueOf(r[0]), String.valueOf(r[1]),
                    String.valueOf(r[2]), String.valueOf(r[3]), true));
        }
        return out;
    }

    private static String txt(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText().trim();
    }

    // ---------------------------------------------------------------- ЖУРНАЛ

    private void audit(String action, String schema, String table, String sql,
                       String status, String error, long tookMs) {
        em.createNativeQuery(
                        "INSERT INTO app.schema_audit" +
                        " (actor, action, target, target_schema, target_table, sql_text," +
                        "  status, error, env, took_ms)" +
                        " VALUES (:actor, :action, 'ddl', :sch, :tbl, :sql, :st, :err, :env, :ms)")
                .setParameter("actor", CurrentUser.email())
                .setParameter("action", action)
                .setParameter("sch", schema)
                .setParameter("tbl", table)
                .setParameter("sql", sql)
                .setParameter("st", status)
                .setParameter("err", error)
                .setParameter("env", envName)
                .setParameter("ms", tookMs)
                .executeUpdate();
    }

    /**
     * Запись в журнал СВОЕЙ транзакцией. Нужна там, где основная уже откатилась: иначе
     * отказавшая операция не оставила бы следа — ровно та, ради которой журнал и заводили.
     */
    private void auditSeparately(String action, String status, String error, long tookMs) {
        try {
            tx.executeWithoutResult(s -> audit(action, null, null, null, status, error, tookMs));
        } catch (RuntimeException ignore) {
            // журнал не должен подменять собой исходную ошибку — её мы пробрасываем выше
        }
    }

    private static String message(Throwable e) {
        String m = e.getMessage();
        Throwable cause = e.getCause();
        while ((m == null || m.isBlank()) && cause != null) {
            m = cause.getMessage();
            cause = cause.getCause();
        }
        if (m == null) m = e.getClass().getSimpleName();
        return m.length() > 2000 ? m.substring(0, 2000) : m;
    }
}
