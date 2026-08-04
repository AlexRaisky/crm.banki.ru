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
        List<Skip> found = tx.execute(s -> skips(plan.schemas()));
        List<Skip> skips = found == null ? List.of() : found;
        Set<String> off = names(skips);

        List<Map<String, Object>> stmts = new ArrayList<>();
        List<String> applicableSql = new ArrayList<>();
        for (DdlPlanner.Stmt st : plan.statements()) {
            boolean skip = touchesSkipped(st, off);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", st.kind());
            m.put("schema", st.schema() == null ? "" : st.schema());
            m.put("table", st.table() == null ? "" : st.table());
            m.put("sql", st.sql());
            m.put("skip", skip);
            stmts.add(m);
            if (!skip) applicableSql.add(st.sql());
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("statements", stmts);
        out.put("schemas", plan.schemas());
        out.put("problems", plan.problems());
        out.put("skipped", skips.stream()
                .map(s -> Map.of("schema", s.schema(), "reason", s.reason())).toList());
        out.put("applicable", applicableSql.size());
        out.put("canApply", !applicableSql.isEmpty());
        // в SQL показываем только то, что реально уедет: пропущенное сбивало бы с толку
        out.put("sql", String.join("\n\n", applicableSql));
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
                Set<String> off = names(skips);
                for (Skip s : skips) {
                    audit("SKIP", s.schema(), null, null, "SKIPPED", s.reason(),
                            System.currentTimeMillis() - started);
                }
                List<DdlPlanner.Stmt> run = plan.statements().stream()
                        .filter(st -> !touchesSkipped(st, off)).toList();
                if (run.isEmpty()) throw new GuardViolation(
                        "Все схемы модели уже есть в базе и заведены не билдером — применять нечего");

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
                m.put("skipped", plan.statements().size() - run.size());
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
