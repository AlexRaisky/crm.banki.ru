package ru.banki.crm.service.flow;

import org.springframework.stereotype.Service;
import ru.banki.crm.service.prod.EventDbService;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Цепочка онлайн-события: чтение из {@code commapi.events_chain} в crmdb.
 * <p>
 * Таблица описывает, что происходит после прихода события: сколько ждать, каким
 * шаблоном ответить, какое событие обрывает шаг и какое — весь поток. По ней и
 * рисуется онлайн-процесс.
 * <p>
 * Только чтение. Заводят и правят цепочки не здесь — панель показывает то, что
 * реально исполняется, и добавлять второй способ это менять значило бы завести
 * два источника истины.
 * <p>
 * Таблицы может не быть: на контуре без подключённой базы событий или на более
 * старой её версии. Тогда раздел молчит и показывает, что цепочек нет, — падать
 * из-за отсутствия чужой таблицы он не должен.
 */
@Service
public class EventChainService {

    private static final String TABLE = "commapi.events_chain";

    /** Колонки в кавычках: order и system — зарезервированные слова. */
    private static final String COLUMNS =
            "id, t_event_comm_id, is_active, \"order\", event_name, \"system\","
            + " wait_time, exit_condition, exit_step, communication_template_id, ts_cr";

    private final EventDbService events;

    public EventChainService(EventDbService events) {
        this.events = events;
    }

    /**
     * Список цепочек: по строке на {@code t_event_comm_id}.
     * <p>
     * Имя события берём из первого шага — по таблице оно у шагов одной цепочки
     * повторяется, и {@code min} здесь просто способ взять любое, не разворачивая
     * группировку в подзапрос.
     */
    public List<Map<String, Object>> list() {
        if (!events.configured() || !exists()) {
            return List.of();
        }
        String sql = "SELECT t_event_comm_id, min(event_name) AS event_name, min(\"system\") AS system,"
                + " count(*) AS steps,"
                + " count(*) FILTER (WHERE is_active) AS steps_active,"
                + " max(ts_cr) AS ts_cr"
                + " FROM " + TABLE
                + " GROUP BY t_event_comm_id ORDER BY min(event_name), t_event_comm_id";
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = events.connection();
             PreparedStatement ps = c.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", rs.getLong("t_event_comm_id"));
                m.put("eventName", rs.getString("event_name"));
                m.put("system", rs.getString("system"));
                m.put("steps", rs.getInt("steps"));
                m.put("stepsActive", rs.getInt("steps_active"));
                m.put("createdAt", str(rs.getTimestamp("ts_cr")));
                out.add(m);
            }
        } catch (Exception e) {
            return List.of();
        }
        return out;
    }

    /**
     * Одна цепочка по {@code t_event_comm_id}: шаги по порядку.
     * <p>
     * {@code exitCondition} поднимаем на уровень цепочки, а не оставляем у шага:
     * это событие обрывает весь поток, и на схеме ему место полосой под всеми
     * шагами, а не отметкой на одном. У шага остаётся {@code exitStep} — то, что
     * снимает именно его.
     */
    public Map<String, Object> chain(long tEventCommId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", tEventCommId);
        List<Map<String, Object>> steps = new ArrayList<>();
        out.put("steps", steps);
        if (!events.configured() || !exists()) {
            out.put("available", false);
            return out;
        }
        out.put("available", true);

        String sql = "SELECT " + COLUMNS + " FROM " + TABLE
                + " WHERE t_event_comm_id = ? ORDER BY \"order\", id";
        try (Connection c = events.connection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, tEventCommId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> s = new LinkedHashMap<>();
                    s.put("id", rs.getLong("id"));
                    s.put("order", rs.getInt("order"));
                    s.put("active", rs.getBoolean("is_active"));
                    s.put("waitTime", num(rs, "wait_time"));
                    s.put("templateId", num(rs, "communication_template_id"));
                    s.put("exitStep", rs.getString("exit_step"));
                    steps.add(s);
                    if (!out.containsKey("eventName")) {
                        out.put("eventName", rs.getString("event_name"));
                        out.put("system", rs.getString("system"));
                    }
                    /* Условие выхода одно на цепочку, но лежит у каждого шага.
                       Берём первое непустое: если у шагов оно разное, это ошибка
                       заведения, и показать надо то, что стоит в начале потока. */
                    String exit = rs.getString("exit_condition");
                    if (exit != null && !exit.isBlank() && !out.containsKey("exitCondition")) {
                        out.put("exitCondition", exit);
                    }
                }
            }
        } catch (Exception e) {
            out.put("available", false);
            out.put("error", String.valueOf(e.getMessage()));
        }
        return out;
    }

    /** Есть ли таблица: на старой базе событий её может не быть вовсе. */
    private boolean exists() {
        try (Connection c = events.connection();
             PreparedStatement ps = c.prepareStatement("SELECT to_regclass(?)")) {
            ps.setString(1, TABLE);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getString(1) != null;
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static Long num(ResultSet rs, String col) throws java.sql.SQLException {
        long v = rs.getLong(col);
        return rs.wasNull() ? null : v;
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }
}
