package ru.banki.crm.service.prod;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import ru.banki.crm.security.CurrentUser;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Выключатель процессов перелива: остановить и пустить снова.
 * <p>
 * Раньше остановить их было нечем. Доставка шаблонов шла по таймеру всегда; обратный ETL
 * включался свойством, то есть перезапуском; импорт событий гонял цикл в браузере.
 * Во время инцидента в проде нужен ровно этот рычаг — перекрыть поток и потом пустить.
 * <p>
 * Два флага на процесс, и они про разное:
 * <ul>
 *   <li>{@code enabled} — начинать ли НОВЫЕ прогоны. Лежит в базе, поэтому переживает
 *       перезапуск приложения (свойство — не переживало бы, а точнее требовало бы его);</li>
 *   <li>{@code stop_requested} — просьба ТЕКУЩЕМУ прогону закончиться. Прогон проверяет
 *       её на безопасных границах: между записями очереди, между каналами, между
 *       таблицами. Посередине пачки не рвём — в проде осталась бы половина.</li>
 * </ul>
 * Флаги читаются из горячих циклов (доставка перебирает очередь построчно), поэтому
 * ответ базы держится в кэше на секунду: точность «в пределах секунды» здесь ровно та,
 * что нужна, а запрос на каждую строку очереди — нет.
 */
@Service
public class ProcessControlService {

    public static final String PROD_SYNC = "prod-sync";
    public static final String ETL_NOTICE = "etl-notice";
    public static final String EVENT_IMPORT = "event-import";
    public static final String EVENT_EXPORT = "event-export";

    /** Сколько миллисекунд доверять прочитанному флагу, не переспрашивая базу. */
    private static final long CACHE_MS = 1000;

    private record Flags(boolean enabled, boolean stopRequested, long readAt) {}

    private final JdbcTemplate jdbc;
    private final Map<String, Flags> cache = new ConcurrentHashMap<>();

    public ProcessControlService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Можно ли начинать новый прогон: включён и никто не просил остановиться. */
    public boolean canStart(String code) {
        Flags f = flags(code);
        return f.enabled() && !f.stopRequested();
    }

    /** Пора ли текущему прогону заканчиваться — проверяется на безопасных границах. */
    public boolean stopRequested(String code) {
        return flags(code).stopRequested();
    }

    /**
     * То же, что {@link #canStart}, но для ручных кнопок: молча ничего не делать в ответ
     * на нажатие — худший вариант, поэтому здесь именно исключение с текстом.
     */
    public void requireEnabled(String code) {
        if (!canStart(code)) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.CONFLICT,
                    "Процесс остановлен в настройках: «Переливы» → «Процессы переливов». "
                    + "Запустите его, чтобы выполнить это действие.");
        }
    }

    /** Итог прогона — его показывает панель управления процессами. */
    public void noteRun(String code, String result) {
        try {
            jdbc.update("UPDATE app.sync_process SET last_run_at = now(), last_result = ?" +
                        " WHERE code = ?", trim(result), code);
        } catch (Exception e) {
            /* Журнал итога — удобство, а не часть перелива: не смогли записать — не повод
               ронять сам прогон, который к этому моменту уже отработал. */
        }
    }

    // ------------------------------------------------------------------ управление

    public List<Map<String, Object>> list() {
        return jdbc.query(
                "SELECT code, title, enabled, stop_requested, last_run_at, last_result," +
                " updated_by, timestamp_upd FROM app.sync_process ORDER BY code",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("code", rs.getString("code"));
                    m.put("title", rs.getString("title"));
                    m.put("enabled", rs.getBoolean("enabled"));
                    m.put("stopRequested", rs.getBoolean("stop_requested"));
                    m.put("lastRunAt", str(rs.getTimestamp("last_run_at")));
                    m.put("lastResult", rs.getString("last_result"));
                    m.put("updatedBy", rs.getString("updated_by"));
                    m.put("updatedAt", str(rs.getTimestamp("timestamp_upd")));
                    return m;
                });
    }

    /**
     * Остановить или пустить.
     * <p>
     * «Остановить» ставит оба флага сразу: новых прогонов не начинать И текущему
     * закончиться. Одного {@code enabled} было бы мало — прогон, начавшийся секунду
     * назад, продолжал бы лить в прод, а человек считал бы, что уже перекрыл.
     */
    public Map<String, Object> set(String code, boolean enabled) {
        int n = jdbc.update(
                "UPDATE app.sync_process SET enabled = ?, stop_requested = ?," +
                " updated_by = ?, timestamp_upd = now() WHERE code = ?",
                enabled, !enabled, CurrentUser.email(), code);
        if (n == 0) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.NOT_FOUND, "Неизвестный процесс: " + code);
        }
        cache.remove(code);
        return Map.of("code", code, "enabled", enabled);
    }

    // ------------------------------------------------------------------ внутреннее

    private Flags flags(String code) {
        Flags f = cache.get(code);
        long now = System.currentTimeMillis();
        if (f != null && now - f.readAt() < CACHE_MS) return f;
        Flags fresh = read(code);
        cache.put(code, fresh);
        return fresh;
    }

    private Flags read(String code) {
        try {
            List<Flags> rows = jdbc.query(
                    "SELECT enabled, stop_requested FROM app.sync_process WHERE code = ?",
                    (rs, i) -> new Flags(rs.getBoolean(1), rs.getBoolean(2), System.currentTimeMillis()),
                    code);
            /* Строки нет — процесс заведён в коде, но не в базе (миграцию не прогнали).
               Считаем включённым: выключатель не должен останавливать перелив только
               потому, что сам не доехал. */
            return rows.isEmpty() ? new Flags(true, false, System.currentTimeMillis()) : rows.get(0);
        } catch (Exception e) {
            return new Flags(true, false, System.currentTimeMillis());
        }
    }

    private static String trim(String s) {
        if (s == null) return null;
        return s.length() > 500 ? s.substring(0, 497) + "…" : s;
    }

    private static String str(java.sql.Timestamp ts) {
        return ts == null ? null : ts.toInstant().toString();
    }
}
