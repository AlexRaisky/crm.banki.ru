package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Журнал А/Б тестов — общая таблица app.ab_test.
 *
 * Устроен как планирование промо ({@link PromoPlanService}): раздел правит по одной
 * ячейке, поэтому конкурентность решается оптимистической блокировкой — клиент
 * присылает timestamp_upd, который он видел, и если в базе он уже другой, приходит 409.
 * Без этого двое молча затирали бы правки друг друга.
 */
@Service
public class AbTestService {

    /** Поля строки, которые раздел имеет право менять (ключ на клиенте -> колонка). */
    private static final Map<String, String> COLUMNS = Map.of(
            "d1", "date_start",
            "d2", "date_end",
            "subject", "subject",
            "templates", "templates",
            "owner", "owner_name",
            "tester", "tester",
            "result", "result");

    /**
     * Порядок колонок для {@link #toDto} — ОДИН на все выборки строк: toDto читает
     * Object[] по индексам, и разошедшиеся списки колонок дают «Index N out of bounds».
     */
    private static final String ROW_COLUMNS =
            "id, date_start, date_end, subject, templates, owner_name, tester, result, timestamp_upd";

    @PersistenceContext
    private EntityManager em;

    private final AdminLogService adminLog;

    public AbTestService(AdminLogService adminLog) {
        this.adminLog = adminLog;
    }

    // ------------------------------------------------------------------ чтение
    /**
     * Все тесты. Строк тут единицы-десятки в год, поэтому отдаём целиком:
     * фильтры и поиск считаются на клиенте по всему набору.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + ROW_COLUMNS + " FROM app.ab_test ORDER BY date_start DESC, id DESC")
                .getResultList();
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(toDto(r));
        }
        return out;
    }

    private static Map<String, Object> toDto(Object[] r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", ((Number) r[0]).longValue());
        m.put("d1", String.valueOf(r[1]));                  // ISO yyyy-MM-dd
        m.put("d2", r[2] == null ? "" : String.valueOf(r[2]));
        m.put("subject", str(r[3]));
        m.put("templates", str(r[4]));
        m.put("owner", str(r[5]));
        m.put("tester", str(r[6]));
        m.put("result", str(r[7]));
        m.put("ver", instant(r[8]));
        return m;
    }

    // ------------------------------------------------------------------ запись
    /**
     * Заведение теста. «Кто тестировал» по умолчанию — почта текущей учётки:
     * поле заполняется само, но остаётся обычным текстом и правится руками.
     */
    @Transactional
    public Map<String, Object> create(Map<String, Object> body) {
        // id берём из последовательности заранее: Hibernate считает нативный INSERT
        // изменяющим запросом и результат RETURNING отдать не даст
        long id = ((Number) em.createNativeQuery("SELECT nextval('app.ab_test_id_seq')")
                .getSingleResult()).longValue();
        String tester = text(body.get("tester"));
        em.createNativeQuery(
                        "INSERT INTO app.ab_test (id, date_start, date_end, subject, templates," +
                        " owner_name, tester, result, created_by, updated_by)" +
                        " VALUES (:id, :d1, CAST(:d2 AS date), :subject, :templates," +
                        " :owner, :tester, :result, :u, :u)")
                .setParameter("id", id)
                .setParameter("d1", requireDate(body.get("d1")))
                .setParameter("d2", optionalDateParam(body.get("d2")))
                .setParameter("subject", text(body.get("subject")))
                .setParameter("templates", text(body.get("templates")))
                .setParameter("owner", text(body.get("owner")))
                .setParameter("tester", tester.isEmpty() ? CurrentUser.email() : tester)
                .setParameter("result", text(body.get("result")))
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
        writeLog(snapshot(id), "INSERT");
        return byId(id);
    }

    /**
     * Правка одного поля. body: {field, value, ver}; ver — timestamp_upd, который видел клиент.
     *
     * @return строка после правки
     */
    @Transactional
    public Map<String, Object> updateField(long id, Map<String, Object> body) {
        String field = text(body.get("field"));
        String column = COLUMNS.get(field);
        if (column == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Поле нельзя менять: " + field);
        }
        Object value = body.get("value");
        // снимок ДО правки — как в остальном журнале админки; пишем только если правка
        // прошла, иначе конфликт версий оставлял бы в журнале ложные записи
        String before = snapshot(id);

        String set = switch (column) {
            case "date_start" -> "date_start = CAST(:v AS date)";
            case "date_end" -> "date_end = CAST(:v AS date)";
            default -> column + " = :v";
        };
        Object param = switch (column) {
            case "date_start" -> String.valueOf(requireDate(value));
            case "date_end" -> optionalDateParam(value);
            default -> text(value);
        };
        int n = em.createNativeQuery(
                        "UPDATE app.ab_test SET " + set + ", timestamp_upd = now(), updated_by = :u" +
                        " WHERE id = :id AND (CAST(:ver AS timestamptz) IS NULL OR timestamp_upd = CAST(:ver AS timestamptz))")
                .setParameter("v", param)
                .setParameter("u", CurrentUser.email())
                .setParameter("id", id)
                .setParameter("ver", verParam(body.get("ver")))
                .executeUpdate();
        if (n == 0) {
            throw conflictOrGone(id);
        }
        writeLog(before, "UPDATE");
        return byId(id);
    }

    @Transactional
    public void delete(long id) {
        String before = snapshot(id);
        int n = em.createNativeQuery("DELETE FROM app.ab_test WHERE id = :id")
                .setParameter("id", id)
                .executeUpdate();
        if (n > 0) {
            writeLog(before, "DELETE");
        }
    }

    // ------------------------------------------------------------------ helpers
    private Map<String, Object> byId(long id) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + ROW_COLUMNS + " FROM app.ab_test WHERE id = :id")
                .setParameter("id", id)
                .getResultList();
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Строка не найдена");
        }
        return toDto(rows.get(0));
    }

    /** 0 обновлённых строк — либо версия разошлась (кто-то опередил), либо строки уже нет. */
    private ResponseStatusException conflictOrGone(long id) {
        Number cnt = (Number) em.createNativeQuery("SELECT count(*) FROM app.ab_test WHERE id = :id")
                .setParameter("id", id)
                .getSingleResult();
        if (cnt.longValue() == 0) {
            return new ResponseStatusException(HttpStatus.NOT_FOUND, "Строку уже удалили");
        }
        return new ResponseStatusException(HttpStatus.CONFLICT, "Строку изменил другой пользователь");
    }

    /** null/пусто — правка без проверки версии (для случаев, когда клиент версии не знает). */
    private static String verParam(Object ver) {
        String s = text(ver);
        return s.isEmpty() ? null : s;
    }

    /** Дата начала обязательна: без неё строка не встанет в порядок и не найдётся в срезе. */
    private static LocalDate requireDate(Object v) {
        String s = text(v);
        if (s.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Не указана дата начала");
        }
        return parseDate(s);
    }

    /** Дата окончания необязательна: пусто = тест ещё идёт, в базу уходит NULL. */
    private static String optionalDateParam(Object v) {
        String s = text(v);
        return s.isEmpty() ? null : parseDate(s).toString();
    }

    private static LocalDate parseDate(String s) {
        try {
            return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректная дата: " + s);
        }
    }

    /**
     * Версия строки (timestamp_upd) в ISO-8601. Драйвер отдаёт timestamptz то как Instant,
     * то как Timestamp/OffsetDateTime — приводим единообразно, иначе сравнение версий
     * на клиенте ломалось бы.
     */
    private static String instant(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Timestamp ts) {
            return ts.toInstant().toString();
        }
        if (v instanceof java.time.Instant i) {
            return i.toString();
        }
        if (v instanceof java.time.OffsetDateTime odt) {
            return odt.toInstant().toString();
        }
        return String.valueOf(v);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static String text(Object v) {
        return v == null ? "" : String.valueOf(v).trim();
    }

    /** Снимок строки для журнала: для UPDATE/DELETE снимается ДО операции. */
    private String snapshot(long id) {
        try {
            Object json = em.createNativeQuery("SELECT to_jsonb(t)::text FROM app.ab_test t WHERE id = :id")
                    .setParameter("id", id)
                    .getResultList().stream().findFirst().orElse(null);
            return json == null ? "{}" : String.valueOf(json);
        } catch (Exception e) {
            return "{}";
        }
    }

    private void writeLog(String rowJson, String operation) {
        try {
            adminLog.logTable("app.ab_test", operation, rowJson);
        } catch (Exception e) {
            // журнал не должен ронять саму операцию
        }
    }
}
