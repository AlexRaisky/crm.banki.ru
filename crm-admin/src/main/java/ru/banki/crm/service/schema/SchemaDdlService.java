package ru.banki.crm.service.schema;

import com.fasterxml.jackson.databind.JsonNode;
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
 *   <li><b>Только аддитивное.</b> Ни DROP, ни RENAME, ни смены типа — их тут нет
 *       физически, а не «запрещены флагом». Потерять данные этой ручкой нельзя.</li>
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

    @Value("${app.env.name:prod}")
    private String envName;

    public SchemaDdlService(TransactionTemplate tx) {
        this.tx = tx;
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
        Set<String> off = names(skips);

        List<Map<String, Object>> stmts = new ArrayList<>();
        List<String> freshSql = new ArrayList<>();
        int already = 0;
        for (DdlPlanner.Stmt st : plan.statements()) {
            boolean skip = touchesSkipped(st, off);
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
                .map(s -> Map.of("schema", s.schema(), "reason", s.reason())).toList());
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
                Set<String> off = names(skips);
                for (Skip s : skips) {
                    audit("SKIP", s.schema(), null, null, "SKIPPED", s.reason(),
                            System.currentTimeMillis() - started);
                }
                /* Уже созданное не переприменяем. Инструкции идемпотентны, вреда бы не было,
                   но журнал заполнялся бы сотней записей «сделали то, что и так было», и
                   найти в нём настоящее изменение стало бы нельзя. */
                Set<String> have = existing();
                List<DdlPlanner.Stmt> run = plan.statements().stream()
                        .filter(st -> !touchesSkipped(st, off) && !alreadyThere(st, have)).toList();
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
                long blocked = plan.statements().stream().filter(st -> touchesSkipped(st, off)).count();
                m.put("skipped", blocked);
                m.put("already", plan.statements().size() - run.size() - blocked);
                m.put("skippedSchemas", new ArrayList<>(off));
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

    /** Схема, которую применение обойдёт, и почему. */
    public record Skip(String schema, String reason) {}

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
                out.add(new Skip(s, "недопустимое имя схемы"));
                continue;
            }
            String reserved = reservedReason(s);
            if (reserved != null) {
                out.add(new Skip(s, "защищена и билдеру недоступна"
                        + (reserved.isBlank() ? "" : " (" + reserved + ")")));
                continue;
            }
            if (existsInDb(s) && !isOwned(s)) {
                out.add(new Skip(s, "уже есть в базе и заведена не билдером"));
            }
        }
        return out;
    }

    private static Set<String> names(List<Skip> skips) {
        Set<String> out = new LinkedHashSet<>();
        if (skips != null) for (Skip s : skips) out.add(s.schema());
        return out;
    }

    /**
     * Инструкция задевает недоступную схему? Считаем по всем её схемам, а не только по
     * целевой: внешний ключ живёт в нашей таблице, но ссылается в чужую — и повесил бы
     * на неё constraint. Такое тоже мимо.
     */
    private static boolean touchesSkipped(DdlPlanner.Stmt st, Set<String> off) {
        if (off.isEmpty()) return false;
        for (String r : st.refs()) if (off.contains(r)) return true;
        return off.contains(st.schema());
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
        addAll(have, "SELECT 'S:' || schema_name FROM information_schema.schemata");
        addAll(have, "SELECT 'T:' || table_schema || '.' || table_name FROM information_schema.tables");
        addAll(have, "SELECT 'C:' || table_schema || '.' || table_name || '.' || column_name" +
                     "  FROM information_schema.columns");
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

    private boolean existsInDb(String schema) {
        Number n = (Number) em.createNativeQuery(
                        "SELECT count(*) FROM information_schema.schemata WHERE schema_name = :s")
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
