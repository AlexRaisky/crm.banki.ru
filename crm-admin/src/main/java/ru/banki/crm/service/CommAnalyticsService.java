package ru.banki.crm.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import ru.banki.crm.security.CurrentUser;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * Аналитика коммуникационной нагрузки: читает витрины {@code sandbox.t_comm_*} в Greenplum.
 * <p>
 * Витрины считает отдельный SQL-скрипт, панель их только показывает. Ничего не
 * пересчитывает и не пишет: соединение открывается read-only, все запросы —
 * {@code SELECT} по готовым таблицам. Тяжёлое (перцентили, оконные функции) уже посчитано
 * там, здесь остаются десятки строк на витрину.
 * <p>
 * <b>Порядок блоков не случаен.</b> Первым идёт качество разметки — так велит комментарий
 * в самом скрипте: «если доля конфликтов и NULL заметная, все цифры по рекламной нагрузке
 * ниже недостоверны». Показывать переспам над непроверенной разметкой значит выдавать
 * ошибку классификации за поведение рассылок.
 * <p>
 * <b>Про два флага рекламы.</b> В данных их два: строгий (оба классификатора сказали adv)
 * и широкий (хотя бы один). Панель считает по широкому — так же, как скрипт, — но строгий
 * показывает рядом. Три комбинации из семи противоречивы, и одно число вместо двух
 * означало бы принять спорное решение молча.
 * <p>
 * Подключение выбирается на самом экране и хранится своим ключом. Пока своё не выбрано,
 * наследуется подключение отчёта «ЧЕК СМС траффик» — чтобы экран работал сразу после
 * выката, — и о том, что оно унаследовано, экран говорит прямо.
 */
@Service
public class CommAnalyticsService {

    private static final Logger log = LoggerFactory.getLogger(CommAnalyticsService.class);

    /**
     * Ключ настройки с id подключения — свой.
     * <p>
     * Сначала он был общим с отчётом «ЧЕК СМС траффик»: витрины лежат в Greenplum, и
     * подключение к Greenplum в панели было ровно одно. Но это допущение, а не факт —
     * витрины могут стоять и в другой базе, а отчёт с аналитикой не обязаны переезжать
     * вместе. Поэтому ключ отдельный, а выбор виден на самом экране.
     * <p>
     * Пока свой не задан, берём подключение отчёта: так экран работает сразу после
     * выката, а не встречает пустотой. Что подключение унаследовано, экран говорит прямо.
     */
    private static final String SETTINGS_KEY = "commAnalytics";

    /** Откуда наследуем подключение, пока своё не выбрано. */
    private static final String FALLBACK_KEY = "smsCheckReport";

    /** Секунд на запрос. Витрины маленькие; дольше — значит что-то не так с базой. */
    private static final int QUERY_TIMEOUT_S = 30;

    /**
     * Витрины, которые показывает экран. Ключ — имя блока в ответе, значение — запрос.
     * <p>
     * Белый список, а не имя таблицы из параметра: снаружи приходит только имя блока.
     * Сортировка и лимиты заданы здесь же — «первые N по объёму» это часть вопроса, а не
     * оформление, и решать это на клиенте значило бы тянуть всю витрину ради десяти строк.
     */
    private static final Map<String, String> BLOCKS = new LinkedHashMap<>();

    static {
        /* 1. Качество разметки — смотреть первым. */
        BLOCKS.put("quality",
                "SELECT comm_class, communication_type, business_communication_type,"
                + " is_conflict, is_not_set, comm_cnt, comm_share_pct, users_cnt,"
                + " first_dt, last_dt"
                + " FROM sandbox.t_comm_class_quality ORDER BY comm_cnt DESC");

        /* Кто порождает спорные комбинации — рабочий список для разбора. */
        BLOCKS.put("conflicts",
                "SELECT comm_class, source_crm, channel, product_type, source_flag,"
                + " comm_cnt, users_cnt, first_dt, last_dt"
                + " FROM sandbox.t_comm_class_conflicts ORDER BY comm_cnt DESC LIMIT 30");

        /* 2. Сводка в разрезах — длинный формат dim_name / dim_value. */
        BLOCKS.put("summary",
                "SELECT dim_name, dim_value, comm_cnt, users_cnt, avg_per_user,"
                + " ad_any_share_pct, ad_strict_share_pct, conflict_share_pct"
                + " FROM sandbox.t_comm_summary ORDER BY dim_name, comm_cnt DESC");

        /* 3. Нагрузка на человека: перцентили важнее среднего. */
        BLOCKS.put("load",
                "SELECT channel, comm_class, users_cnt, comm_cnt, avg_per_user, max_per_user,"
                + " p50_per_user, p90_per_user, p95_per_user, p99_per_user"
                + " FROM sandbox.t_comm_load ORDER BY comm_cnt DESC LIMIT 40");

        /* 4. Переспам по каналам и поверх всех каналов сразу. */
        BLOCKS.put("overspam",
                "SELECT dt_month, channel, users_cnt, ad_comm_cnt, avg_ad_per_user,"
                + " max_ad_per_user, p50_ad_per_user, p95_ad_per_user, users_overspam,"
                + " users_overspam_strict, overspam_share_pct, comm_in_overspam,"
                + " comm_in_overspam_pct"
                + " FROM sandbox.t_comm_overspam ORDER BY dt_month DESC, channel");

        BLOCKS.put("overspamAll",
                "SELECT dt_month, users_cnt, ad_comm_cnt, avg_ad_per_user, max_ad_per_user,"
                + " p95_ad_per_user, users_over_3, users_over_5, users_over_10,"
                + " users_multichannel"
                + " FROM sandbox.t_comm_overspam_allchannel ORDER BY dt_month");

        /* 5. Динамика: за счёт чего растёт объём. */
        BLOCKS.put("dynamics",
                "SELECT dt_month, channel, comm_class, comm_cnt, users_cnt, users_new,"
                + " users_returning, avg_per_user"
                + " FROM sandbox.t_comm_dynamics ORDER BY dt_month, channel");

        /* 6. Концентрация: сколько рекламы уходит на верхний процент базы. */
        BLOCKS.put("concentration",
                "SELECT user_group, users_cnt, ad_comm_cnt, ad_share_pct, min_ad, max_ad"
                + " FROM sandbox.t_comm_concentration");

        /* 7. Частота касаний: разрывы между сообщениями. */
        BLOCKS.put("frequency",
                "SELECT channel, is_ad_any, users_with_2plus, avg_gap_days, p50_gap_days,"
                + " p10_gap_days, min_gap_days, max_gap_days, avg_comm_per_30d,"
                + " users_same_day_hits"
                + " FROM sandbox.t_comm_frequency ORDER BY channel, is_ad_any DESC");

        /* 8. Дубли — почти всегда баг сценария. */
        BLOCKS.put("duplicates",
                "SELECT channel, source_crm, product_type, comm_class, dup_groups,"
                + " users_affected, extra_comm_cnt, max_in_group"
                + " FROM sandbox.t_comm_duplicates ORDER BY extra_comm_cnt DESC LIMIT 30");

        /* 9. День недели. */
        BLOCKS.put("weekday",
                "SELECT weekday_num, weekday_name, channel, comm_class, comm_cnt, users_cnt"
                + " FROM sandbox.t_comm_weekday ORDER BY weekday_num, channel");

        /* 10. Давление за день: сколько всего и сколько рекламы в один день. */
        BLOCKS.put("dailyPressure",
                "SELECT comm_in_day, ad_in_day, user_days, users_cnt, multichannel_days,"
                + " ad_and_service_same_day, multiproduct_days"
                + " FROM sandbox.t_comm_daily_pressure"
                + " WHERE comm_in_day <= 20 ORDER BY comm_in_day, ad_in_day");
    }

    private final JdbcTemplate jdbc;

    public CommAnalyticsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------- конфиг

    /**
     * Настройки экрана: выбранное подключение и список доступных.
     * <p>
     * Список отдаём целиком, без фильтра по «похоже на Greenplum»: угадывать базу по
     * строке подключения — способ однажды спрятать нужную. Ошибочный выбор виден сразу
     * же, первым запросом: витрин там не окажется.
     */
    public Map<String, Object> config() {
        Long own = settingId(SETTINGS_KEY);
        Long id = own != null ? own : settingId(FALLBACK_KEY);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connectionId", id);
        out.put("connectionName", id == null ? null : connectionName(id));
        out.put("inherited", own == null && id != null);
        out.put("canEdit", isAdmin());
        out.put("connections", jdbc.queryForList(
                "SELECT id, name, jdbc_url AS \"jdbcUrl\" FROM app.db_connection"
                + " WHERE is_active ORDER BY lower(name)"));
        out.put("blocks", new ArrayList<>(BLOCKS.keySet()));
        return out;
    }

    /**
     * Выбрать подключение. Только администратор — как и у отчёта: строка подключения
     * содержит адрес и учётку боевой базы, и менять её кому попало нельзя.
     *
     * @param connectionId {@code null} — вернуться к унаследованному от отчёта
     */
    public void configSet(Long connectionId) {
        if (!isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Менять источник может только администратор.");
        }
        if (connectionId != null) {
            Integer ok = jdbc.queryForObject(
                    "SELECT count(*) FROM app.db_connection WHERE id = ?", Integer.class, connectionId);
            if (ok == null || ok == 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нет такого подключения.");
            }
        }
        String value = connectionId == null ? "{}" : "{\"connectionId\": " + connectionId + "}";
        jdbc.update("INSERT INTO app.panel_settings (key, value, timestamp_upd)"
                + " VALUES (?, CAST(? AS jsonb), now())"
                + " ON CONFLICT (key) DO UPDATE SET value = CAST(? AS jsonb), timestamp_upd = now()",
                SETTINGS_KEY, value, value);
    }

    // ------------------------------------------------------------------- данные

    /**
     * Все блоки одним ответом.
     * <p>
     * Одним, а не десятью запросами с фронта: витрины маленькие, а десять параллельных
     * соединений к Greenplum ради одного экрана — это десять соединений к Greenplum.
     * Блок, который не прочитался (витрину ещё не собрали, нет прав), не роняет остальные:
     * вместо строк у него встаёт причина, и экран честно показывает, чего не хватает.
     */
    public Map<String, Object> overview() {
        Long connId = connectionId();
        if (connId == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Источник данных не выбран. Подключение с витринами sandbox.t_comm_*"
                    + " выбирается тут же, строкой над блоками.");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> blocks = new LinkedHashMap<>();
        long started = System.currentTimeMillis();
        try (Connection c = connect(connId)) {
            for (Map.Entry<String, String> e : BLOCKS.entrySet()) {
                blocks.put(e.getKey(), readBlock(c, e.getKey(), e.getValue()));
            }
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            log.warn("comm-analytics: не подключились к источнику {}: {}", connId, msg);
            /* Название подключения в тексте — не украшение: источник выбирается тут же
               строкой выше, и «не удалось прочитать» без имени заставляет гадать, к
               какому именно из них это относится. */
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Не удалось прочитать витрины через подключение «" + connectionName(connId)
                    + "»: " + msg
                    + (msg.contains("connection attempt failed")
                        ? ". Хост недоступен с сервера панели: проверьте адрес и порт в"
                          + " «Подключениях к БД» и то, что до этой машины вообще есть сеть."
                        : ""));
        }
        out.put("blocks", blocks);
        out.put("tookMs", System.currentTimeMillis() - started);
        out.put("connectionName", connectionName(connId));
        return out;
    }

    private Map<String, Object> readBlock(Connection c, String name, String sql) {
        Map<String, Object> block = new LinkedHashMap<>();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setQueryTimeout(QUERY_TIMEOUT_S);
            try (ResultSet rs = ps.executeQuery()) {
                ResultSetMetaData md = rs.getMetaData();
                int n = md.getColumnCount();
                List<Map<String, Object>> rows = new ArrayList<>();
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= n; i++) {
                        Object v = rs.getObject(i);
                        /* Даты и numeric отдаём строками: JSON-число теряет точность на
                           numeric, а дату браузер разберёт как угодно в зависимости от
                           часового пояса. Форматирует пусть экран. */
                        row.put(md.getColumnLabel(i), v == null ? null
                                : (v instanceof Number || v instanceof Boolean ? v : String.valueOf(v)));
                    }
                    rows.add(row);
                }
                block.put("rows", rows);
            }
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage().trim();
            /* Витрины собирают скриптом вручную, и «таблицы ещё нет» — обычное состояние,
               а не поломка. Говорим про конкретный блок, остальные читаем дальше. */
            log.info("comm-analytics: блок {} не прочитан: {}", name, msg);
            block.put("rows", List.of());
            block.put("error", msg);
        }
        return block;
    }

    // ------------------------------------------------------------------- мелочи

    private Long connectionId() {
        Long own = settingId(SETTINGS_KEY);
        return own != null ? own : settingId(FALLBACK_KEY);
    }

    private Long settingId(String key) {
        List<Long> ids = jdbc.query(
                "SELECT (value->>'connectionId')::bigint AS id FROM app.panel_settings WHERE key = ?",
                (rs, i) -> {
                    long v = rs.getLong("id");
                    return rs.wasNull() ? null : v;
                }, key);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private boolean isAdmin() {
        var auth = org.springframework.security.core.context.SecurityContextHolder
                .getContext().getAuthentication();
        return auth != null && auth.getAuthorities().stream()
                .anyMatch(g -> "ROLE_ADMIN".equals(g.getAuthority()));
    }

    private String connectionName(long id) {
        try {
            return jdbc.queryForObject("SELECT name FROM app.db_connection WHERE id = ?", String.class, id);
        } catch (Exception e) {
            return null;
        }
    }

    /** Соединение с источником. Всегда read-only: экран только читает готовые витрины. */
    private Connection connect(long connId) throws Exception {
        Map<String, Object> c;
        try {
            c = jdbc.queryForMap(
                    "SELECT jdbc_url, username, password FROM app.db_connection WHERE id = ?", connId);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Подключение-источник удалено. Задайте его заново в разделе «Отчёты».");
        }
        Properties props = new Properties();
        String user = str(c.get("username")), pass = str(c.get("password"));
        if (!user.isEmpty()) {
            props.setProperty("user", user);
        }
        if (!pass.isEmpty()) {
            props.setProperty("password", pass);
        }
        props.setProperty("connectTimeout", "20");
        props.setProperty("socketTimeout", String.valueOf(QUERY_TIMEOUT_S + 10));
        Connection conn = DriverManager.getConnection(str(c.get("jdbc_url")), props);
        try {
            conn.setReadOnly(true);
        } catch (Exception ignore) {
            /* Драйвер может не поддерживать — тогда защита остаётся на уровне того, что
               мы шлём только SELECT из белого списка выше. */
        }
        log.debug("comm-analytics: {} читает витрины через подключение {}", CurrentUser.email(), connId);
        return conn;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }
}
