package ru.banki.crm.service.flow;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Список событий — витрина слоя A, устроенная как список шаблонов: фильтрация, поиск и
 * подсчёт идут на сервере, в браузер приезжает страница строк.
 * <p>
 * Так сделано не для красоты. После импорта из crmdb событий несколько тысяч, и отдавать
 * их целиком, чтобы фильтровать в браузере, значит грузить мегабайты ради двадцати строк
 * на экране — ровно та ошибка, которую в списке шаблонов уже исправляли.
 * <p>
 * Каждое событие собирается из шести таблиц, и все дополнения сделаны ПОДЗАПРОСАМИ, а не
 * JOIN-ами. Причина конкретная: у d_event_delivery и d_event_template нет уникальности по
 * event_id, поэтому обычный JOIN размножил бы строку события по числу связанных записей —
 * и «всего событий» перестало бы сходиться с числом строк на экране.
 */
@Service
public class EventListService {

    /** Потолок страницы: выше и запрос тяжелеет, и таблица в браузере перестаёт быть списком. */
    private static final int MAX_LIMIT = 500;

    private final JdbcTemplate jdbc;

    public EventListService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Фильтры списка. Пустые значения условие не добавляют. */
    public record Filter(String q, String kind, String channel, Boolean active, Boolean exported) {}

    @Transactional(readOnly = true)
    public Map<String, Object> list(Filter f, int limit, int offset) {
        int lim = Math.max(1, Math.min(MAX_LIMIT, limit));
        int off = Math.max(0, offset);

        List<Object> args = new ArrayList<>();
        String where = where(f, args);

        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM flow.d_event e" + where, Long.class, args.toArray());

        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(lim);
        pageArgs.add(off);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT e.id, e.kind, e.event_name, e.system, e.source, e.is_active," +
                "       e.group_event_descr, e.timestamp_cr," +
                "       (SELECT d.notify_channel FROM flow.d_event_delivery d" +
                "         WHERE d.event_id = e.id ORDER BY d.id LIMIT 1) AS notify_channel," +
                "       s.crontab, s.database, s.is_batch," +
                "       st.phase, st.cron_state, st.last_result, st.date_next," +
                "       (SELECT count(*) FROM flow.d_event_step x WHERE x.event_id = e.id) AS steps," +
                /* Шаблоны показываем как «канал:код» — именно так их ищут в списке шаблонов.
                   Связь может быть пустой: код из прода не всегда есть в нашем справочнике. */
                "       (SELECT string_agg(DISTINCT t.channel || ':' || t.code, ', ')" +
                "          FROM flow.d_event_template et" +
                "          JOIN template.d_template t ON t.id = et.template_id" +
                "         WHERE et.event_id = e.id) AS templates," +
                "       (SELECT count(*) FROM flow.d_event_template et WHERE et.event_id = e.id) AS templates_total," +
                "       (SELECT count(*) FROM flow.t_event_link l" +
                "         WHERE l.event_id = e.id AND l.direction = 'EXPORT') AS exported," +
                "       (SELECT count(*) FROM flow.t_event_link l" +
                "         WHERE l.event_id = e.id AND l.direction = 'IMPORT') AS imported" +
                "  FROM flow.d_event e" +
                "  LEFT JOIN flow.d_event_schedule s ON s.event_id = e.id" +
                "  LEFT JOIN flow.t_event_state st ON st.event_id = e.id" +
                where +
                " ORDER BY e.id DESC LIMIT ? OFFSET ?", pageArgs.toArray());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", total == null ? 0 : total);
        out.put("limit", lim);
        out.put("offset", off);
        out.put("rows", rows);
        return out;
    }

    /** Значения для выпадающих списков фильтра — только те, что реально встречаются. */
    @Transactional(readOnly = true)
    public Map<String, Object> facets() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("channels", jdbc.queryForList(
                "SELECT DISTINCT notify_channel FROM flow.d_event_delivery" +
                " WHERE notify_channel IS NOT NULL AND notify_channel <> '' ORDER BY 1", String.class));
        out.put("systems", jdbc.queryForList(
                "SELECT DISTINCT system FROM flow.d_event" +
                " WHERE system IS NOT NULL AND system <> '' ORDER BY 1", String.class));
        return out;
    }

    /** Полная карточка одного события: обвязка целиком, включая шаги выборки. */
    @Transactional(readOnly = true)
    public Map<String, Object> one(long id) {
        List<Map<String, Object>> ev = jdbc.queryForList(
                "SELECT * FROM flow.d_event WHERE id = ?", id);
        if (ev.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("event", ev.get(0));
        out.put("delivery", first(jdbc.queryForList(
                "SELECT * FROM flow.d_event_delivery WHERE event_id = ? ORDER BY id LIMIT 1", id)));
        out.put("schedule", first(jdbc.queryForList(
                "SELECT * FROM flow.d_event_schedule WHERE event_id = ?", id)));
        out.put("state", first(jdbc.queryForList(
                "SELECT * FROM flow.t_event_state WHERE event_id = ?", id)));
        out.put("steps", jdbc.queryForList(
                "SELECT order_num, process_name, returns_result_set, is_active, sql_text" +
                "  FROM flow.d_event_step WHERE event_id = ? ORDER BY order_num", id));
        out.put("templates", jdbc.queryForList(
                "SELECT et.step_no, et.segment_id, t.channel, t.code, t.communication_name" +
                "  FROM flow.d_event_template et" +
                "  LEFT JOIN template.d_template t ON t.id = et.template_id" +
                " WHERE et.event_id = ? ORDER BY coalesce(et.step_no, 0), et.id", id));
        out.put("definition", first(jdbc.queryForList(
                "SELECT * FROM flow.d_event_definition WHERE event_id = ? ORDER BY id LIMIT 1", id)));
        out.put("links", jdbc.queryForList(
                "SELECT our_table, our_id, prod_id, direction, linked_at, linked_by" +
                "  FROM flow.t_event_link WHERE event_id = ? ORDER BY id", id));
        return out;
    }

    private static Object first(List<Map<String, Object>> rows) {
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Условия фильтра плюс их параметры. Пустой фильтр даёт пустую строку. */
    private static String where(Filter f, List<Object> args) {
        List<String> cond = new ArrayList<>();
        if (f != null) {
            if (notBlank(f.q())) {
                /* Ищем по имени, системе и source разом: человек помнит что-то одно из трёх,
                   а заставлять его выбирать поле для поиска — лишний шаг. */
                cond.add("(e.event_name ILIKE ? OR coalesce(e.system,'') ILIKE ?" +
                         " OR coalesce(e.source,'') ILIKE ?)");
                String like = "%" + f.q().trim() + "%";
                args.add(like);
                args.add(like);
                args.add(like);
            }
            if (notBlank(f.kind())) {
                cond.add("e.kind = ?");
                args.add(f.kind().trim());
            }
            if (notBlank(f.channel())) {
                cond.add("EXISTS (SELECT 1 FROM flow.d_event_delivery d" +
                         " WHERE d.event_id = e.id AND d.notify_channel = ?)");
                args.add(f.channel().trim());
            }
            if (f.active() != null) {
                cond.add("e.is_active = ?");
                args.add(f.active());
            }
            if (f.exported() != null) {
                String has = "EXISTS (SELECT 1 FROM flow.t_event_link l" +
                             " WHERE l.event_id = e.id AND l.direction = 'EXPORT')";
                cond.add(f.exported() ? has : "NOT " + has);
            }
        }
        return cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
    }

    private static boolean notBlank(String v) {
        return v != null && !v.isBlank();
    }
}
