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
import java.util.Set;

/**
 * Планирование промо — общая таблица app.promo_plan (раньше localStorage у каждого свой).
 *
 * Правки идут по одному полю (в разделе редактируется ячейка), поэтому конкурентность
 * решается оптимистической блокировкой: клиент присылает timestamp_upd строки, который
 * он видел; если в базе он уже другой — 409, и раздел перечитывает строку. Без этого
 * двое планировщиков молча затирали бы правки друг друга — баг, который замечают неделями.
 */
@Service
public class PromoPlanService {

    /** Поля строки, которые раздел имеет право менять (ключ v1 -> колонка). */
    private static final Map<String, String> COLUMNS = Map.of(
            "d", "plan_date",
            "product", "product",
            "partner", "partner",
            "base", "base",
            "chan", "channel",
            "total", "is_total",
            "uniq", "uniq_name",
            "task", "task_key",
            "owner", "owner_name",
            "status", "status");
    /** note вынесен отдельно: Map.of ограничен 10 парами. */
    private static final String NOTE_COLUMN = "note";

    private static final String STATUS_PLANNED = "запланировано";
    private static final String STATUS_SENT = "отправлено";

    @PersistenceContext
    private EntityManager em;

    private final AdminLogService adminLog;

    public PromoPlanService(AdminLogService adminLog) {
        this.adminLog = adminLog;
    }

    // ------------------------------------------------------------------ чтение
    /**
     * Весь план. Строк тут порядок сотен (план на месяцы вперёд плюс архив),
     * поэтому отдаём целиком: фильтры, вкладки и правила считаются на клиенте
     * по всему набору — постранично их не посчитать.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT id, plan_date, product, partner, base, channel, is_total," +
                        " uniq_name, task_key, owner_name, status, note, communication_name, timestamp_upd" +
                        " FROM app.promo_plan ORDER BY plan_date, id")
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
        m.put("d", String.valueOf(r[1]));                       // ISO yyyy-MM-dd
        m.put("product", str(r[2]));
        m.put("partner", str(r[3]));
        m.put("base", str(r[4]));
        // на клиенте канал — массив (исторически, из мультивыбора); у строки он всегда один
        m.put("chan", str(r[5]).isEmpty() ? List.of() : List.of(str(r[5])));
        m.put("total", Boolean.TRUE.equals(r[6]));
        m.put("uniq", str(r[7]));
        m.put("task", str(r[8]));
        m.put("owner", str(r[9]));
        m.put("status", str(r[10]));
        m.put("note", str(r[11]));
        m.put("commName", str(r[12]));   // сохранённое «Название коммуникации» (обычно из импорта)
        m.put("ver", instant(r[13]));
        return m;
    }

    /**
     * Версия строки (timestamp_upd) в ISO-8601. Драйвер отдаёт timestamptz то как Instant,
     * то как Timestamp/OffsetDateTime — приводим единообразно, иначе клиент получал бы
     * разные форматы и сравнение версий ломалось бы.
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

    // ------------------------------------------------------------------ запись
    /**
     * Заведение записи. Каналов может быть несколько — создаём по строке на канал
     * (правило «одна запись = один канал»), возвращаем все созданные строки.
     */
    @Transactional
    public List<Map<String, Object>> create(Map<String, Object> body) {
        List<String> channels = channels(body.get("chan"));
        if (channels.isEmpty()) {
            channels = List.of("");     // канал можно не указывать — строка «требует заполнения»
        }
        LocalDate date = parseDate(body.get("d"));
        List<Long> ids = new ArrayList<>();
        for (String ch : channels) {
            // id берём из последовательности заранее: Hibernate считает нативный INSERT
            // изменяющим запросом и результат RETURNING отдать не даст
            long id = ((Number) em.createNativeQuery("SELECT nextval('app.promo_plan_id_seq')")
                    .getSingleResult()).longValue();
            em.createNativeQuery(
                            "INSERT INTO app.promo_plan (id, plan_date, product, partner, base, channel," +
                            " is_total, uniq_name, task_key, owner_name, status, note, created_by, updated_by)" +
                            " VALUES (:id, :d, :product, :partner, :base, :ch, :total, :uniq, :task, :owner," +
                            " :status, :note, :u, :u)")
                    .setParameter("id", id)
                    .setParameter("d", date)
                    .setParameter("product", text(body.get("product")))
                    .setParameter("partner", text(body.get("partner")))
                    .setParameter("base", text(body.get("base")))
                    .setParameter("ch", ch)
                    .setParameter("total", bool(body.get("total")))
                    .setParameter("uniq", text(body.get("uniq")))
                    .setParameter("task", text(body.get("task")))
                    .setParameter("owner", text(body.get("owner")))
                    .setParameter("status", text(body.get("status")))
                    .setParameter("note", text(body.get("note")))
                    .setParameter("u", CurrentUser.email())
                    .executeUpdate();
            ids.add(id);
            writeLog(operationSnapshot(id), "INSERT");
        }
        return byIds(ids);
    }

    /**
     * Правка одного поля. body: {field, value, ver}. ver — timestamp_upd, который видел клиент.
     *
     * @return строка после правки
     */
    @Transactional
    public Map<String, Object> updateField(long id, Map<String, Object> body) {
        String field = text(body.get("field"));
        String column = NOTE_COLUMN.equals(field) ? NOTE_COLUMN : COLUMNS.get(field);
        if (column == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Поле нельзя менять: " + field);
        }
        Object value = body.get("value");
        // снимок ДО правки — как в остальном журнале админки; в лог пишем только
        // если правка прошла, иначе конфликт версий оставлял бы ложные записи
        String before = operationSnapshot(id);

        // Смена канала на несколько значений разворачивается в копии строки (как при заведении).
        if ("chan".equals(field)) {
            Map<String, Object> res = updateChannels(id, channels(value), body.get("ver"));
            writeLog(before, "UPDATE");
            return res;
        }

        String set = switch (column) {
            case "plan_date" -> "plan_date = CAST(:v AS date)";
            case "is_total" -> "is_total = CAST(:v AS boolean)";
            default -> column + " = :v";
        };
        Object param = switch (column) {
            case "plan_date" -> String.valueOf(parseDate(value));
            case "is_total" -> String.valueOf(bool(value));
            default -> text(value);
        };
        int n = em.createNativeQuery(
                        "UPDATE app.promo_plan SET " + set + ", timestamp_upd = now(), updated_by = :u" +
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

    /** Смена набора каналов: текущая строка берёт первый, остальные уезжают в копии. */
    private Map<String, Object> updateChannels(long id, List<String> channels, Object ver) {
        String first = channels.isEmpty() ? "" : channels.get(0);
        int n = em.createNativeQuery(
                        "UPDATE app.promo_plan SET channel = :ch, timestamp_upd = now(), updated_by = :u" +
                        " WHERE id = :id AND (CAST(:ver AS timestamptz) IS NULL OR timestamp_upd = CAST(:ver AS timestamptz))")
                .setParameter("ch", first)
                .setParameter("u", CurrentUser.email())
                .setParameter("id", id)
                .setParameter("ver", verParam(ver))
                .executeUpdate();
        if (n == 0) {
            throw conflictOrGone(id);
        }
        for (String ch : channels.subList(Math.min(1, channels.size()), channels.size())) {
            em.createNativeQuery(
                            "INSERT INTO app.promo_plan (plan_date, product, partner, base, channel, is_total," +
                            " uniq_name, task_key, owner_name, status, note, created_by, updated_by)" +
                            " SELECT plan_date, product, partner, base, :ch, is_total, uniq_name, task_key," +
                            " owner_name, status, note, :u, :u FROM app.promo_plan WHERE id = :id")
                    .setParameter("ch", ch)
                    .setParameter("u", CurrentUser.email())
                    .setParameter("id", id)
                    .executeUpdate();
        }
        return byId(id);
    }

    @Transactional
    public void delete(long id) {
        String before = operationSnapshot(id);
        int n = em.createNativeQuery("DELETE FROM app.promo_plan WHERE id = :id")
                .setParameter("id", id)
                .executeUpdate();
        if (n > 0) {
            writeLog(before, "DELETE");
        }
    }

    /**
     * Прошедшие даты со статусом «запланировано» переводим в «отправлено».
     * Раньше это делал каждый клиент при открытии раздела и тут же сохранял —
     * на общей таблице это значило бы запись в базу с каждого открытия страницы.
     * Теперь один проход при чтении списка, и только если есть что менять.
     *
     * @return сколько строк перевели
     */
    @Transactional
    public int archiveSync() {
        return em.createNativeQuery(
                        "UPDATE app.promo_plan SET status = :sent, timestamp_upd = now()" +
                        " WHERE plan_date < CURRENT_DATE AND status = :planned")
                .setParameter("sent", STATUS_SENT)
                .setParameter("planned", STATUS_PLANNED)
                .executeUpdate();
    }

    // ------------------------------------------------------------------ helpers
    private Map<String, Object> byId(long id) {
        List<Map<String, Object>> rows = byIds(List.of(id));
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Строка не найдена");
        }
        return rows.get(0);
    }

    private List<Map<String, Object>> byIds(List<Long> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT id, plan_date, product, partner, base, channel, is_total," +
                        " uniq_name, task_key, owner_name, status, note, timestamp_upd" +
                        " FROM app.promo_plan WHERE id IN (:ids) ORDER BY plan_date, id")
                .setParameter("ids", ids)
                .getResultList();
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(toDto(r));
        }
        return out;
    }

    /** 0 обновлённых строк — либо версия разошлась (кто-то опередил), либо строки уже нет. */
    private ResponseStatusException conflictOrGone(long id) {
        Number cnt = (Number) em.createNativeQuery("SELECT count(*) FROM app.promo_plan WHERE id = :id")
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

    private static List<String> channels(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> list) {
            for (Object o : list) {
                String s = text(o);
                if (!s.isEmpty() && !out.contains(s)) {
                    out.add(s);
                }
            }
        } else {
            String s = text(v);
            if (!s.isEmpty()) {
                out.add(s);
            }
        }
        return out;
    }

    private static LocalDate parseDate(Object v) {
        String s = text(v);
        if (s.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Не указана дата");
        }
        try {
            return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректная дата: " + s);
        }
    }

    private static boolean bool(Object v) {
        return v instanceof Boolean b ? b : Set.of("true", "1", "on").contains(text(v).toLowerCase());
    }

    private static String text(Object v) {
        return v == null ? "" : String.valueOf(v).trim();
    }

    /** Снимок строки для журнала: для UPDATE/DELETE снимается ДО операции. */
    private String operationSnapshot(long id) {
        try {
            Object json = em.createNativeQuery(
                            "SELECT to_jsonb(t)::text FROM app.promo_plan t WHERE id = :id")
                    .setParameter("id", id)
                    .getResultList().stream().findFirst().orElse(null);
            return json == null ? "{}" : String.valueOf(json);
        } catch (Exception e) {
            return "{}";
        }
    }

    private void writeLog(String rowJson, String operation) {
        try {
            adminLog.logTable("app.promo_plan", operation, rowJson);
        } catch (Exception e) {
            // журнал не должен ронять саму операцию
        }
    }
}
