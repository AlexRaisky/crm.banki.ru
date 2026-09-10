package ru.banki.crm.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.security.CurrentUser;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Каналы: во что обходится одна коммуникация.
 *
 * <p>Затраты и объём хранятся строками с периодом действия, поэтому цена считается
 * помесячно: сумма всех статей, действовавших в месяце, делится на объём того же
 * месяца. Так видно, как цена менялась при смене договоров, — одним числом на
 * канал это не показать, а при правке объёма прошлые месяцы пересчитались бы
 * задним числом.
 *
 * <p>Бесплатный канал считается нулём независимо от введённых строк: галка не
 * стирает данные, а отключает тарификацию.
 */
@Service
public class ChannelService {

    private static final BigDecimal MONTHS = BigDecimal.valueOf(12);
    private static final int SCALE = 6;

    private final JdbcTemplate jdbc;

    public ChannelService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /* ------------------------------------------------------------- каналы */

    @Transactional(readOnly = true)
    public List<Map<String, Object>> channels() {
        return jdbc.queryForList(
                "SELECT id, label, sort_order, is_free, is_active, timestamp_upd, updated_by" +
                "  FROM channel.d_channel WHERE is_active ORDER BY sort_order, id");
    }

    /** Переключатель «канал бесплатный». */
    @Transactional
    public Map<String, Object> setFree(String channelId, boolean free) {
        jdbc.update("UPDATE channel.d_channel SET is_free = ?, timestamp_upd = now(), updated_by = ?" +
                    " WHERE id = ?", free, CurrentUser.email(), channelId);
        return channel(channelId);
    }

    private Map<String, Object> channel(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, label, is_free FROM channel.d_channel WHERE id = ?", id);
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /* ------------------------------------------------------- статьи затрат */

    @Transactional(readOnly = true)
    public List<Map<String, Object>> costs(String channelId) {
        return jdbc.queryForList(
                "SELECT id, amount, amount_period, date_from, date_to, vendor, note," +
                "       timestamp_upd, updated_by" +
                "  FROM channel.d_cost WHERE channel_id = ?" +
                " ORDER BY date_from NULLS LAST, id", channelId);
    }

    @Transactional
    public Map<String, Object> saveCost(String channelId, Map<String, Object> body) {
        Long id = longOrNull(body.get("id"));
        String who = CurrentUser.email();
        if (id == null) {
            id = jdbc.queryForObject(
                    "INSERT INTO channel.d_cost (channel_id, amount, amount_period, date_from," +
                    "        date_to, vendor, note, created_by)" +
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                    Long.class, channelId, num(body.get("amount")), period(body.get("amountPeriod")),
                    date(body.get("dateFrom")), date(body.get("dateTo")),
                    str(body.get("vendor")), str(body.get("note")), who);
        } else {
            jdbc.update("UPDATE channel.d_cost SET amount = ?, amount_period = ?, date_from = ?," +
                        "       date_to = ?, vendor = ?, note = ?, timestamp_upd = now(), updated_by = ?" +
                        " WHERE id = ? AND channel_id = ?",
                    num(body.get("amount")), period(body.get("amountPeriod")),
                    date(body.get("dateFrom")), date(body.get("dateTo")),
                    str(body.get("vendor")), str(body.get("note")), who, id, channelId);
        }
        return Map.of("id", id);
    }

    @Transactional
    public void deleteCost(String channelId, long id) {
        jdbc.update("DELETE FROM channel.d_cost WHERE id = ? AND channel_id = ?", id, channelId);
    }

    /* --------------------------------------------------- модель тарификации */

    @Transactional(readOnly = true)
    public List<Map<String, Object>> volumes(String channelId) {
        return jdbc.queryForList(
                "SELECT id, kind, volume, volume_period, date_from, date_to, note," +
                "       timestamp_upd, updated_by" +
                "  FROM channel.d_volume WHERE channel_id = ?" +
                " ORDER BY date_from NULLS LAST, id", channelId);
    }

    @Transactional
    public Map<String, Object> saveVolume(String channelId, Map<String, Object> body) {
        Long id = longOrNull(body.get("id"));
        String who = CurrentUser.email();
        if (id == null) {
            id = jdbc.queryForObject(
                    "INSERT INTO channel.d_volume (channel_id, kind, volume, volume_period," +
                    "        date_from, date_to, note, created_by)" +
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                    Long.class, channelId, str(body.get("kind")) == null ? "per_message" : str(body.get("kind")),
                    num(body.get("volume")), period(body.get("volumePeriod")),
                    date(body.get("dateFrom")), date(body.get("dateTo")), str(body.get("note")), who);
        } else {
            jdbc.update("UPDATE channel.d_volume SET volume = ?, volume_period = ?, date_from = ?," +
                        "       date_to = ?, note = ?, timestamp_upd = now(), updated_by = ?" +
                        " WHERE id = ? AND channel_id = ?",
                    num(body.get("volume")), period(body.get("volumePeriod")),
                    date(body.get("dateFrom")), date(body.get("dateTo")),
                    str(body.get("note")), who, id, channelId);
        }
        return Map.of("id", id);
    }

    @Transactional
    public void deleteVolume(String channelId, long id) {
        jdbc.update("DELETE FROM channel.d_volume WHERE id = ? AND channel_id = ?", id, channelId);
    }

    /* ---------------------------------------------------------- расчёт цены */

    /**
     * Помесячный ряд: расходы, объём и цена одной коммуникации.
     *
     * <p>Строка без дат считается действующей всегда — иначе первая же запись «просто
     * договор» выпала бы из расчёта и цена показалась бы нулевой.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> pricing(String channelId, LocalDate from, LocalDate to) {
        Map<String, Object> ch = channel(channelId);
        boolean free = Boolean.TRUE.equals(ch.get("is_free"));

        List<Map<String, Object>> costs = costs(channelId);
        List<Map<String, Object>> volumes = volumes(channelId);

        YearMonth start = YearMonth.from(from != null ? from : firstDate(costs, volumes));
        YearMonth end = YearMonth.from(to != null ? to : LocalDate.now());
        if (start.isAfter(end)) {
            start = end;
        }

        List<Map<String, Object>> series = new ArrayList<>();
        BigDecimal totalCost = BigDecimal.ZERO;
        for (YearMonth m = start; !m.isAfter(end); m = m.plusMonths(1)) {
            BigDecimal cost = free ? BigDecimal.ZERO : monthlySum(costs, m, "amount", "amount_period");
            BigDecimal vol = monthlySum(volumes, m, "volume", "volume_period");
            BigDecimal price = (free || vol.signum() == 0)
                    ? (free ? BigDecimal.ZERO : null)
                    : cost.divide(vol, SCALE, RoundingMode.HALF_UP);
            totalCost = totalCost.add(cost);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("month", m.atDay(1).toString());
            row.put("cost", cost);
            row.put("volume", vol);
            row.put("price", price);
            series.add(row);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("channel", channelId);
        out.put("free", free);
        out.put("series", series);
        out.put("totalCost", totalCost);
        /* Цена «сейчас» — по текущему месяцу, а не последняя точка ряда: если
           выбран прошлый период, показывать его цену как актуальную нельзя. */
        YearMonth now = YearMonth.now();
        BigDecimal nowCost = free ? BigDecimal.ZERO : monthlySum(costs, now, "amount", "amount_period");
        BigDecimal nowVol = monthlySum(volumes, now, "volume", "volume_period");
        out.put("currentCost", nowCost);
        out.put("currentVolume", nowVol);
        out.put("currentPrice", free ? BigDecimal.ZERO
                : (nowVol.signum() == 0 ? null : nowCost.divide(nowVol, SCALE, RoundingMode.HALF_UP)));
        return out;
    }

    /** Сумма строк, действующих в месяце, приведённая к месячной. */
    private BigDecimal monthlySum(List<Map<String, Object>> rows, YearMonth m,
                                  String valueKey, String periodKey) {
        LocalDate first = m.atDay(1), last = m.atEndOfMonth();
        BigDecimal sum = BigDecimal.ZERO;
        for (Map<String, Object> r : rows) {
            LocalDate df = toLocal(r.get("date_from"));
            LocalDate dt = toLocal(r.get("date_to"));
            if (df != null && df.isAfter(last)) continue;
            if (dt != null && dt.isBefore(first)) continue;
            BigDecimal v = (BigDecimal) r.get(valueKey);
            if (v == null) continue;
            sum = sum.add("year".equals(r.get(periodKey))
                    ? v.divide(MONTHS, SCALE, RoundingMode.HALF_UP)
                    : v);
        }
        return sum;
    }

    private LocalDate firstDate(List<Map<String, Object>> costs, List<Map<String, Object>> volumes) {
        LocalDate min = null;
        for (List<Map<String, Object>> list : List.of(costs, volumes)) {
            for (Map<String, Object> r : list) {
                LocalDate d = toLocal(r.get("date_from"));
                if (d != null && (min == null || d.isBefore(min))) min = d;
            }
        }
        /* Ничего не заведено — показываем последний год, чтобы график не был пустым. */
        return min != null ? min : LocalDate.now().minusMonths(11);
    }

    /* ------------------------------------------------------------- мелочи */

    private static LocalDate toLocal(Object v) {
        if (v instanceof java.sql.Date d) return d.toLocalDate();
        if (v instanceof LocalDate d) return d;
        return null;
    }

    private static String period(Object v) {
        return "month".equals(String.valueOf(v)) ? "month" : "year";
    }

    private static String str(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? null : s;
    }

    private static BigDecimal num(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        try {
            return new BigDecimal(String.valueOf(v).replace(',', '.').replace(" ", "").trim());
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private static Long longOrNull(Object v) {
        if (v == null) return null;
        try {
            return Long.valueOf(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Date date(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.length() < 10) return null;
        try {
            return Date.valueOf(LocalDate.parse(s.substring(0, 10)));
        } catch (RuntimeException e) {
            return null;
        }
    }
}
