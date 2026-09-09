package ru.banki.crm.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.security.CurrentUser;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Панель отклонений: выручка по дням, снимки расчёта и разбор гипотез.
 *
 * <p>Раздел до этого жил целиком в браузере — цифры из Excel, комментарии в
 * localStorage. Здесь всё то же самое, но общее: цифры видят все, комментарий
 * коллеги не пропадает вместе с его браузером, а снимок расчёта позволяет через
 * полгода показать, что отклонение действительно было и с какими порогами его
 * посчитали.
 *
 * <p>Сам расчёт (медиана, флаги, тренды) остаётся на клиенте: он уже написан,
 * работает и в демо-режиме без сервера. Сервер хранит вход (факт) и результат
 * (снимок) — переносить арифметику сюда значило бы держать две её копии.
 */
@Service
public class DeviationService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public DeviationService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /* ---------------------------------------------------------------- факт */

    /** Выручка по дням; период необязателен — без него отдаём всё, что есть. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> revenue(LocalDate from, LocalDate to) {
        StringBuilder sql = new StringBuilder(
                "SELECT fact_date, group1, group2, channel, revenue" +
                "  FROM deviation.d_revenue_daily WHERE 1 = 1");
        List<Object> args = new ArrayList<>();
        if (from != null) { sql.append(" AND fact_date >= ?"); args.add(Date.valueOf(from)); }
        if (to != null)   { sql.append(" AND fact_date <= ?"); args.add(Date.valueOf(to)); }
        sql.append(" ORDER BY fact_date, group1, group2, channel");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /**
     * Приём выручки: строки {date, g1, g2, g3, revenue}.
     *
     * <p>mode=replace очищает период загружаемых дней — иначе продукт, исчезнувший
     * из нового файла, навсегда остался бы в базе со старой цифрой. mode=append
     * трогает только пришедшие дни.
     *
     * <p>Повторная загрузка того же файла не должна ничего удваивать, поэтому
     * запись идёт через ON CONFLICT по (дата, group1, group2, канал).
     */
    @Transactional
    public Map<String, Object> saveRevenue(Map<String, Object> body) {
        String mode = str(body.get("mode"), "append");
        if (!"replace".equals(mode) && !"append".equals(mode)) {
            mode = "append";
        }
        List<?> rows = (body.get("rows") instanceof List<?> l) ? l : List.of();

        LocalDate min = null, max = null;
        List<Object[]> batch = new ArrayList<>();
        for (Object o : rows) {
            if (!(o instanceof Map<?, ?> r)) {
                continue;
            }
            LocalDate d = date(r.get("date"));
            String g1 = str(r.get("g1"), "");
            String g2 = str(r.get("g2"), "");
            String ch = str(r.get("g3"), "");
            if (d == null || g1.isBlank() || g2.isBlank() || ch.isBlank()) {
                continue;   /* служебные строки файла (Grand Total и прочие) сюда не доезжают */
            }
            batch.add(new Object[]{ Date.valueOf(d), g1, g2, ch, num(r.get("revenue")) });
            if (min == null || d.isBefore(min)) min = d;
            if (max == null || d.isAfter(max))  max = d;
        }

        String who = CurrentUser.email();
        Long loadId = jdbc.queryForObject(
                "INSERT INTO deviation.t_load (kind, mode, file_name, date_from, date_to," +
                "                              rows_total, created_by)" +
                " VALUES ('file', ?, ?, ?, ?, ?, ?) RETURNING id",
                Long.class,
                mode, str(body.get("fileName"), null),
                min == null ? null : Date.valueOf(min),
                max == null ? null : Date.valueOf(max),
                batch.size(), who);

        int existed = 0;
        if (!batch.isEmpty()) {
            /* Сколько строк в этих днях уже лежало — чтобы в журнале было видно
               «дозагрузили новые дни» против «переписали то же самое». Считаем по
               диапазону одним запросом: построчная проверка на полугодовом файле
               (это десятки тысяч строк) означала бы столько же запросов. */
            Integer had = jdbc.queryForObject(
                    "SELECT count(*) FROM deviation.d_revenue_daily WHERE fact_date BETWEEN ? AND ?",
                    Integer.class, Date.valueOf(min), Date.valueOf(max));
            existed = had == null ? 0 : Math.min(had, batch.size());
            if ("replace".equals(mode)) {
                /* Продукт, исчезнувший из нового файла, иначе остался бы в базе со
                   старой цифрой и продолжал бы влиять на итог дня. */
                jdbc.update("DELETE FROM deviation.d_revenue_daily WHERE fact_date BETWEEN ? AND ?",
                        Date.valueOf(min), Date.valueOf(max));
                existed = 0;
            }
            List<Object[]> args = new ArrayList<>(batch.size());
            for (Object[] row : batch) {
                args.add(new Object[]{ row[0], row[1], row[2], row[3], row[4], loadId });
            }
            jdbc.batchUpdate(
                    "INSERT INTO deviation.d_revenue_daily" +
                    "       (fact_date, group1, group2, channel, revenue, load_id)" +
                    " VALUES (?, ?, ?, ?, ?, ?)" +
                    " ON CONFLICT (fact_date, group1, group2, channel) DO UPDATE" +
                    "    SET revenue = EXCLUDED.revenue," +
                    "        load_id = EXCLUDED.load_id," +
                    "        timestamp_upd = now()",
                    args);
        }

        jdbc.update("UPDATE deviation.t_load SET rows_new = ?, rows_updated = ?, finished_at = now()" +
                    " WHERE id = ?", batch.size() - existed, existed, loadId);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("loadId", loadId);
        out.put("rows", batch.size());
        out.put("inserted", batch.size() - existed);
        out.put("updated", existed);
        out.put("dateFrom", min);
        out.put("dateTo", max);
        return out;
    }

    /** Журнал поступлений — последние загрузки и синхронизации. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> loads(int limit) {
        return jdbc.queryForList(
                "SELECT id, kind, mode, file_name, date_from, date_to, rows_total, rows_new," +
                "       rows_updated, status, message, timestamp_cr, created_by" +
                "  FROM deviation.t_load ORDER BY id DESC LIMIT ?",
                Math.max(1, Math.min(limit, 200)));
    }

    /* -------------------------------------------------------------- пороги */

    /**
     * Пороги. Строку заводит миграция, но если её кто-то удалит — отдаём значения
     * по умолчанию, а не пустоту: на них ссылается запись снимка, где колонки
     * NOT NULL, и раздел молча перестал бы сохранять историю.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> thresholds() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT base_window, spike_pct, product_spike_pct, decline_min_days," +
                "       decline_total_pct, decline_product_pct, timestamp_upd, updated_by" +
                "  FROM deviation.d_threshold WHERE id = 1");
        if (!rows.isEmpty()) {
            return rows.get(0);
        }
        Map<String, Object> def = new LinkedHashMap<>();
        def.put("base_window", 7);
        def.put("spike_pct", new BigDecimal("20"));
        def.put("product_spike_pct", new BigDecimal("60"));
        def.put("decline_min_days", 14);
        def.put("decline_total_pct", new BigDecimal("20"));
        def.put("decline_product_pct", new BigDecimal("30"));
        return def;
    }

    @Transactional
    public Map<String, Object> saveThresholds(Map<String, Object> body) {
        jdbc.update(
                "UPDATE deviation.d_threshold" +
                "   SET base_window = coalesce(?, base_window)," +
                "       spike_pct = coalesce(?, spike_pct)," +
                "       product_spike_pct = coalesce(?, product_spike_pct)," +
                "       decline_min_days = coalesce(?, decline_min_days)," +
                "       decline_total_pct = coalesce(?, decline_total_pct)," +
                "       decline_product_pct = coalesce(?, decline_product_pct)," +
                "       timestamp_upd = now(), updated_by = ?" +
                " WHERE id = 1",
                intOrNull(body.get("baseWindow")), num(body.get("spikePct")),
                num(body.get("productSpikePct")), intOrNull(body.get("declineMinDays")),
                num(body.get("declineTotalPct")), num(body.get("declineProductPct")),
                CurrentUser.email());
        return thresholds();
    }

    /* -------------------------------------------------------------- снимки */

    /**
     * Сохранить снимок расчёта целиком: ряд по дням, отклонения, тренды, месяцы и
     * дни «на проверку». Пороги пишем в сам снимок — по ним потом и объясняется,
     * почему день попал в отклонения.
     */
    @Transactional
    public Map<String, Object> saveRun(Map<String, Object> body) {
        Map<String, Object> th = thresholds();
        List<?> daily = list(body.get("daily"));
        List<?> flags = list(body.get("flags"));
        List<?> declines = list(body.get("declines"));
        List<?> monthly = list(body.get("monthly"));
        List<?> checkdays = list(body.get("checkdays"));

        LocalDate from = null, to = null;
        for (Object o : daily) {
            if (o instanceof Map<?, ?> r) {
                LocalDate d = date(r.get("date"));
                if (d == null) continue;
                if (from == null || d.isBefore(from)) from = d;
                if (to == null || d.isAfter(to)) to = d;
            }
        }
        if (from == null) {
            return Map.of("saved", false, "reason", "пустой расчёт");
        }

        Long runId = jdbc.queryForObject(
                "INSERT INTO deviation.t_run (date_from, date_to, days_count, flags_count," +
                "        declines_count, checkdays_count, products_count, total_revenue," +
                "        base_window, spike_pct, product_spike_pct, decline_min_days," +
                "        decline_total_pct, decline_product_pct, load_id, created_by)" +
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                Long.class,
                Date.valueOf(from), Date.valueOf(to), daily.size(), flags.size(),
                declines.size(), checkdays.size(),
                intOrNull(body.get("productsCount")), num(body.get("totalRevenue")),
                th.get("base_window"), th.get("spike_pct"), th.get("product_spike_pct"),
                th.get("decline_min_days"), th.get("decline_total_pct"), th.get("decline_product_pct"),
                longOrNull(body.get("loadId")), CurrentUser.email());

        for (Object o : daily) {
            if (!(o instanceof Map<?, ?> r)) continue;
            LocalDate d = date(r.get("date"));
            if (d == null) continue;
            jdbc.update("INSERT INTO deviation.t_run_daily" +
                    "       (run_id, fact_date, revenue, base_median, deviation_pct, dod_pct, is_flagged)" +
                    " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, fact_date) DO NOTHING",
                    runId, Date.valueOf(d), num(r.get("rev")), num(r.get("base")),
                    num(r.get("dev")), num(r.get("dod")), Boolean.TRUE.equals(r.get("flagged")));
        }
        for (Object o : flags) {
            if (!(o instanceof Map<?, ?> r)) continue;
            LocalDate d = date(r.get("date"));
            if (d == null) continue;
            /* «РОСТ»/«ПАДЕНИЕ» приходят с клиента по-русски, в базе — up/down:
               направление не должно зависеть от языка интерфейса. */
            String dir = "РОСТ".equals(str(r.get("flag"), "")) ? "up" : "down";
            jdbc.update("INSERT INTO deviation.t_run_flag" +
                    "       (run_id, fact_date, direction, deviation_pct, revenue, base_median," +
                    "        strength, label, hypothesis_auto, drivers)" +
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)" +
                    " ON CONFLICT (run_id, fact_date) DO NOTHING",
                    runId, Date.valueOf(d), dir, num(r.get("dev")), num(r.get("rev")),
                    num(r.get("base")), blankToNull(r.get("strength")), blankToNull(r.get("type")),
                    blankToNull(r.get("comment")), toJson(r.get("drivers")));
        }
        for (Object o : declines) {
            if (!(o instanceof Map<?, ?> r)) continue;
            LocalDate ds = date(r.get("start")), de = date(r.get("end"));
            if (ds == null || de == null) continue;
            String level = str(r.get("level"), "");
            jdbc.update("INSERT INTO deviation.t_run_decline" +
                    "       (run_id, level_kind, level_name, date_start, date_end, days_count," +
                    "        revenue_start, revenue_end, drop_pct, hypothesis_auto)" +
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
                    " ON CONFLICT (run_id, level_name, date_start) DO NOTHING",
                    runId, level.startsWith("Итого") ? "total" : "product", level,
                    Date.valueOf(ds), Date.valueOf(de), intOrNull(r.get("days")),
                    num(r.get("rev_start")), num(r.get("rev_end")), num(r.get("drop")),
                    str(r.get("comment"), null));
        }
        for (Object o : monthly) {
            if (!(o instanceof Map<?, ?> r)) continue;
            LocalDate m = date(r.get("monthStart"));
            if (m == null) continue;
            jdbc.update("INSERT INTO deviation.t_run_monthly" +
                    "       (run_id, month_start, total_revenue, avg_day, min_day, max_day, std_dev, mom_pct)" +
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, month_start) DO NOTHING",
                    runId, Date.valueOf(m), num(r.get("total")), num(r.get("avg")),
                    num(r.get("min")), num(r.get("max")), num(r.get("std")), num(r.get("mom")));
        }
        for (Object o : checkdays) {
            if (!(o instanceof Map<?, ?> r)) continue;
            LocalDate d = date(r.get("date"));
            if (d == null) continue;
            jdbc.update("INSERT INTO deviation.t_run_checkday (run_id, fact_date, note_auto)" +
                    " VALUES (?, ?, ?) ON CONFLICT (run_id, fact_date) DO NOTHING",
                    runId, Date.valueOf(d), str(r.get("comment"), null));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("saved", true);
        out.put("runId", runId);
        return out;
    }

    /** Список снимков — что и когда считали. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> runs(int limit) {
        return jdbc.queryForList(
                "SELECT id, calc_ts, date_from, date_to, days_count, flags_count, declines_count," +
                "       checkdays_count, total_revenue, base_window, spike_pct, created_by" +
                "  FROM deviation.t_run ORDER BY id DESC LIMIT ?",
                Math.max(1, Math.min(limit, 200)));
    }

    /** Один снимок целиком — для доказательства «отклонение было». */
    @Transactional(readOnly = true)
    public Map<String, Object> run(long id) {
        List<Map<String, Object>> head = jdbc.queryForList(
                "SELECT * FROM deviation.t_run WHERE id = ?", id);
        if (head.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", head.get(0));
        out.put("daily", jdbc.queryForList(
                "SELECT fact_date, revenue, base_median, deviation_pct, dod_pct, is_flagged" +
                "  FROM deviation.t_run_daily WHERE run_id = ? ORDER BY fact_date", id));
        out.put("flags", jdbc.queryForList(
                "SELECT fact_date, direction, deviation_pct, revenue, base_median, strength," +
                "       label, hypothesis_auto, drivers" +
                "  FROM deviation.t_run_flag WHERE run_id = ? ORDER BY fact_date", id));
        out.put("declines", jdbc.queryForList(
                "SELECT level_kind, level_name, date_start, date_end, days_count," +
                "       revenue_start, revenue_end, drop_pct, hypothesis_auto" +
                "  FROM deviation.t_run_decline WHERE run_id = ? ORDER BY date_start, level_name", id));
        out.put("monthly", jdbc.queryForList(
                "SELECT month_start, total_revenue, avg_day, min_day, max_day, std_dev, mom_pct" +
                "  FROM deviation.t_run_monthly WHERE run_id = ? ORDER BY month_start", id));
        out.put("checkdays", jdbc.queryForList(
                "SELECT fact_date, note_auto FROM deviation.t_run_checkday" +
                " WHERE run_id = ? ORDER BY fact_date", id));
        return out;
    }

    /* ------------------------------------------------------- разбор гипотез */

    /** Все комментарии и статусы: раздел читает их одним запросом при открытии. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> notes() {
        return jdbc.queryForList(
                "SELECT object_kind, object_key, fact_date, level_name, comment, status," +
                "       snapshot, timestamp_cr, created_by, timestamp_upd, updated_by" +
                "  FROM deviation.t_note ORDER BY fact_date NULLS LAST, id");
    }

    /**
     * Записать комментарий и/или статус. Ключ объекта задаёт раздел: для дня это
     * дата, для тренда «уровень|дата начала».
     *
     * <p>Пустой комментарий при статусе open удаляет запись — иначе в базе копились
     * бы строки, оставшиеся от стёртого текста, и «решено» считалось бы по ним.
     */
    @Transactional
    public Map<String, Object> saveNote(Map<String, Object> body) {
        String kind = str(body.get("kind"), "");
        String key = str(body.get("key"), "");
        if (!("day".equals(kind) || "decline".equals(kind)) || key.isBlank()) {
            return Map.of("saved", false, "reason", "не указан объект");
        }
        String comment = str(body.get("comment"), "");
        String status = "solved".equals(str(body.get("status"), "open")) ? "solved" : "open";
        String who = CurrentUser.email();

        if (comment.isBlank() && "open".equals(status)) {
            jdbc.update("DELETE FROM deviation.t_note WHERE object_kind = ? AND object_key = ?", kind, key);
            return Map.of("saved", true, "deleted", true);
        }
        jdbc.update(
                "INSERT INTO deviation.t_note" +
                "       (object_kind, object_key, fact_date, level_name, comment, status," +
                "        snapshot, created_by, timestamp_upd, updated_by)" +
                " VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, now(), ?)" +
                " ON CONFLICT (object_kind, object_key) DO UPDATE" +
                "    SET comment = EXCLUDED.comment," +
                "        status = EXCLUDED.status," +
                "        fact_date = coalesce(EXCLUDED.fact_date, deviation.t_note.fact_date)," +
                "        level_name = coalesce(EXCLUDED.level_name, deviation.t_note.level_name)," +
                /* Снимок пишем только когда он пришёл: правка статуса не должна
                   затирать обстоятельства, при которых комментарий был написан. */
                "        snapshot = coalesce(EXCLUDED.snapshot, deviation.t_note.snapshot)," +
                "        timestamp_upd = now()," +
                "        updated_by = EXCLUDED.updated_by",
                kind, key, dateOrNull(body.get("date")), str(body.get("level"), null),
                comment, status, toJson(body.get("snapshot")), who, who);
        return Map.of("saved", true);
    }

    /* ------------------------------------------------------------ мелочи */

    private static List<?> list(Object v) {
        return (v instanceof List<?> l) ? l : List.of();
    }

    private static String str(Object v, String def) {
        return v == null ? def : String.valueOf(v);
    }

    /** Пустая строка с клиента — это «не заполнено», а не значение. */
    private static String blankToNull(Object v) {
        String s = str(v, null);
        return (s == null || s.isBlank()) ? null : s;
    }

    private static BigDecimal num(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        try {
            return new BigDecimal(String.valueOf(v).replace(',', '.').trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer intOrNull(Object v) {
        BigDecimal b = num(v);
        return b == null ? null : b.intValue();
    }

    private static Long longOrNull(Object v) {
        BigDecimal b = num(v);
        return b == null ? null : b.longValue();
    }

    private static LocalDate date(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.length() < 10) return null;
        try {
            return LocalDate.parse(s.substring(0, 10));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Date dateOrNull(Object v) {
        LocalDate d = date(v);
        return d == null ? null : Date.valueOf(d);
    }

    private String toJson(Object v) {
        if (v == null) return null;
        try {
            return json.writeValueAsString(v);
        } catch (Exception e) {
            return null;
        }
    }
}
