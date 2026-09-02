package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Бэклог панели: заявки на доработки — что просили, что в работе, что сделано.
 * <p>
 * Раздел админский целиком: маршрут {@code /api/admin/**} закрыт ролью в SecurityConfig,
 * поэтому своей секции в матрице прав у бэклога нет и права здесь не проверяются повторно.
 * <p>
 * Статус и приоритет — короткие перечисления, и проверяются они здесь, а не ограничением
 * в базе: набор меняется от разговора к разговору («отложено», «в Jira»), и каждый раз
 * ходить миграцией ради строки в CHECK — дороже, чем держать список в одном месте кода.
 */
@Service
public class BacklogService {

    /** Порядок важен: он же задаёт сортировку списка. */
    public static final List<String> STATUSES = List.of("new", "in_progress", "done", "rejected");
    public static final List<String> PRIORITIES = List.of("high", "normal", "low");

    private static final int MAX_TITLE = 300;
    private static final int MAX_AREA = 120;
    private static final int MAX_ASSIGNEE = 160;

    private final JdbcTemplate jdbc;

    public BacklogService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Список задач. Сортировка: сначала незакрытые, внутри — по приоритету, потом новые
     * сверху. Именно в таком порядке список и читают: «что горит», а не «что когда завели».
     *
     * @param status один из STATUSES либо пусто — все
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(String status) {
        String where = "";
        List<Object> args = new ArrayList<>();
        String s = nz(status);
        if (!s.isEmpty()) {
            if (!STATUSES.contains(s)) {
                throw bad("Неизвестный статус: " + s);
            }
            where = " WHERE status = ?";
            args.add(s);
        }
        return jdbc.query(
                "SELECT id, title, description, area, priority, status, assignee, author,"
                + "       timestamp_cr, timestamp_upd, updated_by"
                + "  FROM app.backlog_item" + where
                + " ORDER BY array_position(ARRAY['new','in_progress','done','rejected'], status),"
                + "          array_position(ARRAY['high','normal','low'], priority),"
                + "          id DESC",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("title", rs.getString("title"));
                    m.put("description", rs.getString("description"));
                    m.put("area", rs.getString("area"));
                    m.put("priority", rs.getString("priority"));
                    m.put("status", rs.getString("status"));
                    m.put("assignee", rs.getString("assignee"));
                    m.put("author", rs.getString("author"));
                    m.put("createdAt", String.valueOf(rs.getTimestamp("timestamp_cr")));
                    m.put("updatedAt", String.valueOf(rs.getTimestamp("timestamp_upd")));
                    m.put("updatedBy", nz(rs.getString("updated_by")));
                    return m;
                },
                args.toArray());
    }

    /** Сводка по статусам — для подписей вкладок, чтобы не считать их на клиенте. */
    @Transactional(readOnly = true)
    public Map<String, Object> counts() {
        Map<String, Object> out = new LinkedHashMap<>();
        STATUSES.forEach(s -> out.put(s, 0L));
        jdbc.query("SELECT status, count(*) AS n FROM app.backlog_item GROUP BY status", rs -> {
            out.put(rs.getString("status"), rs.getLong("n"));
        });
        out.put("total", jdbc.queryForObject("SELECT count(*) FROM app.backlog_item", Long.class));
        return out;
    }

    /**
     * Кому можно поручить задачу: учётки с супер-ролью.
     * <p>
     * Бэклог ведут те, кто эти доработки и делает, а это ровно супер-админы — остальным
     * список исполнителей только мешал бы промахиваться. Отключённые учётки не показываем:
     * назначить задачу на того, кто не может войти, — это потерять её.
     * <p>
     * Наружу состав супер-админов панель не раскрывает (роль везде маскируется под
     * «Админ»), но здесь раздел админский целиком, и список видят только администраторы.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> assignees() {
        return jdbc.query(
                "SELECT u.email, coalesce(u.display_name, '') AS display_name"
                + "  FROM app.users u JOIN app.role r ON r.id = u.role_id"
                + " WHERE r.is_super_admin AND u.enabled"
                + " ORDER BY lower(u.email)",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("email", rs.getString("email"));
                    m.put("name", nz(rs.getString("display_name")));
                    return m;
                });
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> body) {
        String title = text(body.get("title"), MAX_TITLE);
        if (title.isEmpty()) {
            throw bad("Нужен заголовок задачи");
        }
        Long id = jdbc.queryForObject(
                "INSERT INTO app.backlog_item (title, description, area, priority, status,"
                + " assignee, author, updated_by)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                Long.class,
                title,
                nz(str(body.get("description"))),
                text(body.get("area"), MAX_AREA),
                priority(body.get("priority")),
                status(body.get("status")),
                text(body.get("assignee"), MAX_ASSIGNEE),
                CurrentUser.email(),
                CurrentUser.email());
        return one(id);
    }

    /**
     * Правка. Поля, которых нет в теле, не трогаем: список правят по одному полю —
     * сменить статус, приписать исполнителя, — и слать ради этого всю карточку незачем.
     */
    @Transactional
    public Map<String, Object> update(long id, Map<String, Object> body) {
        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        if (body.containsKey("title")) {
            String title = text(body.get("title"), MAX_TITLE);
            if (title.isEmpty()) {
                throw bad("Нужен заголовок задачи");
            }
            sets.add("title = ?");
            args.add(title);
        }
        if (body.containsKey("description")) {
            sets.add("description = ?");
            args.add(nz(str(body.get("description"))));
        }
        if (body.containsKey("area")) {
            sets.add("area = ?");
            args.add(text(body.get("area"), MAX_AREA));
        }
        if (body.containsKey("priority")) {
            sets.add("priority = ?");
            args.add(priority(body.get("priority")));
        }
        if (body.containsKey("status")) {
            sets.add("status = ?");
            args.add(status(body.get("status")));
        }
        if (body.containsKey("assignee")) {
            sets.add("assignee = ?");
            args.add(text(body.get("assignee"), MAX_ASSIGNEE));
        }
        if (sets.isEmpty()) {
            return one(id);
        }
        sets.add("timestamp_upd = now()");
        sets.add("updated_by = ?");
        args.add(CurrentUser.email());
        args.add(id);
        int n = jdbc.update("UPDATE app.backlog_item SET " + String.join(", ", sets) + " WHERE id = ?",
                args.toArray());
        if (n == 0) {
            throw notFound(id);
        }
        return one(id);
    }

    @Transactional
    public void delete(long id) {
        if (jdbc.update("DELETE FROM app.backlog_item WHERE id = ?", id) == 0) {
            throw notFound(id);
        }
    }

    // ------------------------------------------------------------------ helpers
    private Map<String, Object> one(Long id) {
        List<Map<String, Object>> rows = list(null).stream()
                .filter(m -> id != null && id.equals(m.get("id")))
                .toList();
        if (rows.isEmpty()) {
            throw notFound(id == null ? 0 : id);
        }
        return rows.get(0);
    }

    private String priority(Object v) {
        String p = nz(str(v)).toLowerCase();
        if (p.isEmpty()) {
            return "normal";
        }
        if (!PRIORITIES.contains(p)) {
            throw bad("Неизвестный приоритет: " + p);
        }
        return p;
    }

    private String status(Object v) {
        String s = nz(str(v)).toLowerCase();
        if (s.isEmpty()) {
            return "new";
        }
        if (!STATUSES.contains(s)) {
            throw bad("Неизвестный статус: " + s);
        }
        return s;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static String nz(String s) {
        return s == null ? "" : s.trim();
    }

    /** Обрезаем по длине колонки: иначе длинный заголовок падал бы ошибкой базы. */
    private static String text(Object o, int max) {
        String s = nz(str(o));
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException notFound(long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Задача не найдена: " + id);
    }
}
