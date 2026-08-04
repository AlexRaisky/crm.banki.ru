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
 *       числится за билдером в app.schema_owned. Чужая схема — отказ. Наличие объекта
 *       в базе само по себе права не даёт.</li>
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
     * и результат проверки прав на схемы, чтобы отказ был виден ДО нажатия «Применить».
     */
    public Map<String, Object> preview(JsonNode model) {
        DdlPlanner.Plan plan = DdlPlanner.plan(model);
        List<String> blocked = tx.execute(s -> guardProblems(plan.schemas()));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("statements", plan.statements().stream().map(st -> Map.of(
                "kind", st.kind(),
                "schema", st.schema() == null ? "" : st.schema(),
                "table", st.table() == null ? "" : st.table(),
                "sql", st.sql())).toList());
        out.put("schemas", plan.schemas());
        out.put("problems", plan.problems());
        out.put("blocked", blocked == null ? List.of() : blocked);
        out.put("canApply", (blocked == null || blocked.isEmpty()) && !plan.statements().isEmpty());
        out.put("sql", String.join("\n\n", plan.statements().stream().map(DdlPlanner.Stmt::sql).toList()));
        return out;
    }

    // ------------------------------------------------------------- ПРИМЕНЕНИЕ

    /** Выполнить план. Одна транзакция на всё: упало на середине — откатилось целиком. */
    public Map<String, Object> apply(JsonNode model) {
        DdlPlanner.Plan plan = DdlPlanner.plan(model);
        long started = System.currentTimeMillis();
        try {
            Map<String, Object> res = tx.execute(status -> {
                List<String> blocked = guardProblems(plan.schemas());
                if (!blocked.isEmpty()) throw new GuardViolation(String.join("; ", blocked));
                if (plan.statements().isEmpty()) throw new GuardViolation("Нечего применять");

                int done = 0;
                Set<String> touchedSchemas = new LinkedHashSet<>();
                for (DdlPlanner.Stmt st : plan.statements()) {
                    em.createNativeQuery(st.sql()).executeUpdate();
                    audit(st.kind(), st.schema(), st.table(), st.sql(), "OK", null,
                            System.currentTimeMillis() - started);
                    if (st.schema() != null) touchedSchemas.add(st.schema());
                    if (st.table() != null) own(st.schema(), st.table());
                    else own(st.schema(), null);
                    done++;
                }
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("applied", done);
                m.put("schemas", new ArrayList<>(touchedSchemas));
                return m;
            });
            audit("APPLY", null, null, null, "OK", null, System.currentTimeMillis() - started);
            return res;
        } catch (GuardViolation g) {
            auditSeparately("APPLY", "REJECTED", g.getMessage(), System.currentTimeMillis() - started);
            throw g;
        } catch (RuntimeException e) {
            auditSeparately("APPLY", "ERROR", message(e), System.currentTimeMillis() - started);
            throw e;
        }
    }

    // ----------------------------------------------------------------- ОХРАНА

    /**
     * Можно ли трогать эти схемы. Возвращает список причин отказа; пусто — путь свободен.
     * <p>
     * Схема запретна → отказ. Схема существует, но за билдером не числится → отказ:
     * это чужое, и «доводить до модели» его нельзя. Схемы нет вовсе → создаём, это наше.
     */
    private List<String> guardProblems(List<String> schemas) {
        List<String> problems = new ArrayList<>();
        for (String s : schemas) {
            if (!DdlPlanner.valid(s)) {
                problems.add("Недопустимое имя схемы: «" + s + "»");
                continue;
            }
            if (isReserved(s)) {
                problems.add("Схема «" + s + "» защищена и билдеру недоступна");
                continue;
            }
            if (existsInDb(s) && !isOwned(s)) {
                problems.add("Схема «" + s + "» уже есть в базе, но заведена не билдером — трогать её нельзя");
            }
        }
        return problems;
    }

    private boolean isReserved(String schema) {
        Number n = (Number) em.createNativeQuery(
                        "SELECT count(*) FROM app.schema_reserved WHERE schema_name = :s")
                .setParameter("s", schema).getSingleResult();
        return n.intValue() > 0;
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
