package ru.banki.crm.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.service.jira.JiraService;
import ru.banki.crm.service.prod.EventDbService;
import ru.banki.crm.service.prod.NoticeEtlService;
import ru.banki.crm.service.prod.ProcessControlService;
import ru.banki.crm.service.prod.ProdDbService;
import ru.banki.crm.service.prod.ProdSyncService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Карта интеграций: с кем панель разговаривает и в каком это состоянии прямо сейчас.
 * <p>
 * Своих данных у раздела нет — всё собирается из тех же источников, что и настроечные
 * панели: реестр подключений, очередь синка, водяные знаки ETL, выключатель процессов,
 * настройки Jira. Смысл именно в сведении: по отдельности каждый показатель лежит в своём
 * разделе, и чтобы ответить «всё ли доехало», приходилось обойти пять страниц.
 * <p>
 * Живые проверки соединения делаем здесь же (SELECT 1 с коротким таймаутом): карту
 * открывают, когда что-то не работает, и показывать вместо состояния прочерк — значит
 * отправить человека проверять руками то, что мы и так умеем проверить.
 */
@Service
public class IntegrationsService {

    /** Состояния, которыми карта раскрашивает узлы и стрелки. */
    private static final String OK = "ok";          // работает
    private static final String WARN = "warn";      // работает, но есть на что посмотреть
    private static final String DOWN = "down";      // не отвечает или настроено с ошибкой
    private static final String OFF = "off";        // выключено человеком либо не настроено

    private final JdbcTemplate jdbc;
    private final ProdDbService prod;
    private final EventDbService events;
    private final ProcessControlService control;
    private final ProdSyncService sync;
    private final NoticeEtlService etl;
    private final JiraService jira;
    private final ObjectMapper json;

    public IntegrationsService(JdbcTemplate jdbc, ProdDbService prod, EventDbService events,
                               ProcessControlService control, ProdSyncService sync,
                               NoticeEtlService etl, JiraService jira, ObjectMapper json) {
        this.jdbc = jdbc;
        this.prod = prod;
        this.events = events;
        this.control = control;
        this.sync = sync;
        this.etl = etl;
        this.jira = jira;
        this.json = json;
    }

    /**
     * Узлы (внешние системы) и потоки между ними. Форму держим плоской: рисование —
     * дело фронта, и координаты сюда не попадают, иначе перекладка схемы требовала бы
     * правки сервера.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> map() {
        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> flows = new ArrayList<>();

        Map<String, Map<String, Object>> procs = processes();

        // ---------------------------------------------------------------- наша база
        nodes.add(node("panel", "Панель CRM", "Наша база: шаблоны, доступ, очередь синка, планы промо.",
                ourDbOk() ? OK : DOWN, ourDbOk() ? "отвечает" : "не отвечает", null));

        // ------------------------------------------------- прод-БД шаблонов (notice)
        Map<String, Object> prodHealth = safe(prod::health);
        boolean prodConfigured = truthy(prodHealth.get("configured"));
        boolean prodOk = truthy(prodHealth.get("ok"));
        nodes.add(node("prod", "Прод-БД шаблонов", "Схемы notice и callcenter: боевые шаблоны коммуникаций.",
                !prodConfigured ? OFF : (prodOk ? OK : DOWN),
                !prodConfigured ? "приёмник не выбран"
                        : (prodOk ? str(prodHealth.get("url")) : "ошибка: " + str(prodHealth.get("error"))),
                "dbconn"));

        Map<String, Object> queue = safeMap(sync::stats);
        long pending = num(queue.get("pending")), error = num(queue.get("error")), sending = num(queue.get("sending"));
        Map<String, Object> syncProc = procs.get(ProcessControlService.PROD_SYNC);
        String syncState = state(syncProc, prodConfigured && prodOk,
                error > 0 ? WARN : OK);
        flows.add(flow("panel", "prod", "Доставка шаблонов",
                "Очередь app.prod_sync: заведённое и изменённое в панели уезжает в прод.",
                syncState,
                "в очереди " + pending + (sending > 0 ? ", отправляется " + sending : "")
                        + (error > 0 ? ", с ошибкой " + error : ""),
                ProcessControlService.PROD_SYNC, syncProc, "sync"));

        Map<String, Object> etlStatus = safeMap(etl::status);
        Map<String, Object> etlProc = procs.get(ProcessControlService.ETL_NOTICE);
        boolean etlEnabled = truthy(etlStatus.get("enabled"));
        flows.add(flow("prod", "panel", "Обратный ETL",
                "Прод — источник истины: изменения оттуда затягиваются в наш справочник каждые 5 минут.",
                !etlEnabled ? OFF : state(etlProc, prodConfigured && prodOk, OK),
                !etlEnabled ? "выключен настройкой ETL_ENABLED" : watermarks(etlStatus),
                ProcessControlService.ETL_NOTICE, etlProc, "sync"));

        // ------------------------------------------------------- база событий (crmdb)
        Map<String, Object> evHealth = safe(events::health);
        boolean evConfigured = truthy(evHealth.get("configured"));
        boolean evOk = truthy(evHealth.get("ok"));
        nodes.add(node("crmdb", "База событий crmdb", "Схемы tracker, scheduler, commapi: боевые события рассылок.",
                !evConfigured ? OFF : (evOk ? OK : DOWN),
                !evConfigured ? "база событий не выбрана"
                        : (evOk ? str(evHealth.get("url")) : "ошибка: " + str(evHealth.get("error"))),
                "dbconn"));

        Map<String, Object> impProc = procs.get(ProcessControlService.EVENT_IMPORT);
        flows.add(flow("crmdb", "panel", "Импорт событий",
                "Сравнение нашей модели событий с боевой базой и затягивание того, чего у нас нет.",
                state(impProc, evConfigured && evOk, OK), lastRun(impProc),
                ProcessControlService.EVENT_IMPORT, impProc, "events"));

        Map<String, Object> expProc = procs.get(ProcessControlService.EVENT_EXPORT);
        flows.add(flow("panel", "crmdb", "Перелив событий в прод",
                "Собранное у нас событие уезжает в боевые таблицы crmdb.",
                state(expProc, evConfigured && evOk, OK), lastRun(expProc),
                ProcessControlService.EVENT_EXPORT, expProc, "evexport"));

        // ------------------------------------------------------------------- Jira
        Map<String, Object> jiraCfg = safeMap(jira::config);
        boolean jiraSet = !str(jiraCfg.get("baseUrl")).isEmpty() && truthy(jiraCfg.get("hasToken"));
        String jiraLast = str(jiraCfg.get("lastStatus"));
        nodes.add(node("jira", "Jira", "Заведение задач CRM-Промо из «Планирования промо».",
                !jiraSet ? OFF : ("ERROR".equals(jiraLast) ? DOWN : (jiraLast.isEmpty() ? WARN : OK)),
                !jiraSet ? "адрес или токен не заданы"
                        : str(jiraCfg.get("baseUrl")) + (jiraLast.isEmpty() ? " · связь не проверялась"
                                : " · проверка " + jiraLast + " " + shortTs(str(jiraCfg.get("lastCheckedAt")))),
                "jira"));
        flows.add(flow("panel", "jira", "Задачи промо",
                "Кнопка «Создать задачу в Jira» из плана промо; поля собираются по карте полей.",
                !jiraSet ? OFF : ("ERROR".equals(jiraLast) ? DOWN : OK),
                truthy(jiraCfg.get("hasToken")) ? "токен сохранён" : "токен не задан",
                null, null, "jira"));

        // ------------------------------------------- прочие базы: витрины под отчёты
        List<Map<String, Object>> others = otherConnections();
        if (!others.isEmpty()) {
            long down = others.stream().filter(o -> "ERROR".equalsIgnoreCase(str(o.get("status")))).count();
            nodes.add(node("reportdb", "Базы под отчёты",
                    "Витрины, из которых панель читает данные отчётов (в том числе «ЧЕК СМС траффик»).",
                    down > 0 ? WARN : OK,
                    "подключений: " + others.size() + (down > 0 ? ", с ошибкой: " + down : ""),
                    "dbconn"));
            flows.add(flow("reportdb", "panel", "Чтение витрин",
                    "Отчёты панели ходят в эти базы по требованию — расписания у них нет.",
                    down > 0 ? WARN : OK, names(others), null, null, "dbconn"));
        }

        // --------------------------------------------------------------- Tableau
        Map<String, Object> tableau = tableauReports();
        if (num(tableau.get("total")) > 0) {
            nodes.add(node("tableau", "Tableau", "Встроенные отчёты: панель отдаёт браузеру адрес представления.",
                    OK, "отчётов настроено: " + num(tableau.get("total")), null));
            flows.add(flow("tableau", "panel", "Встроенные отчёты",
                    "Панель хранит адрес сервера и представления; данные браузер берёт у Tableau напрямую.",
                    OK, str(tableau.get("servers")), null, null, null));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("nodes", nodes);
        out.put("flows", flows);
        out.put("generatedAt", java.time.Instant.now().toString());
        return out;
    }

    // ------------------------------------------------------------------ сборка кусков

    private Map<String, Map<String, Object>> processes() {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        try {
            control.list().forEach(p -> out.put(String.valueOf(p.get("code")), p));
        } catch (RuntimeException ignore) {
            // выключателя может не быть на старой базе — карта всё равно должна открыться
        }
        return out;
    }

    /**
     * Состояние потока: остановленный человеком процесс — это не поломка, а решение,
     * и красным его красить нельзя; иначе дежурный бросится чинить то, что сам и перекрыл.
     */
    private String state(Map<String, Object> proc, boolean linkOk, String whenRunning) {
        if (proc != null && !truthy(proc.get("enabled"))) return OFF;
        if (!linkOk) return DOWN;
        return whenRunning;
    }

    private String lastRun(Map<String, Object> proc) {
        if (proc == null) return "";
        String at = shortTs(str(proc.get("lastRunAt")));
        String res = str(proc.get("lastResult"));
        if (at.isEmpty() && res.isEmpty()) return "прогонов ещё не было";
        return (res.isEmpty() ? "" : res) + (at.isEmpty() ? "" : " · " + at);
    }

    private String watermarks(Map<String, Object> etlStatus) {
        Object w = etlStatus.get("watermarks");
        if (!(w instanceof List<?> list) || list.isEmpty()) return "водяных знаков ещё нет";
        String newest = "";
        for (Object o : list) {
            if (o instanceof Map<?, ?> m) {
                String ts = String.valueOf(m.get("lastProdTs"));
                if (ts.compareTo(newest) > 0) newest = ts;
            }
        }
        return "прочитано до " + shortTs(newest);
    }

    /** Пользовательские подключения, кроме приёмника шаблонов и базы событий. */
    private List<Map<String, Object>> otherConnections() {
        try {
            return jdbc.query(
                    "SELECT name, coalesce(purpose, '') AS purpose, coalesce(last_status, '') AS status"
                    + "  FROM app.db_connection"
                    + " WHERE is_active AND NOT is_prod_sync AND NOT is_event_db"
                    + " ORDER BY name",
                    (rs, i) -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("name", rs.getString("name"));
                        m.put("purpose", rs.getString("purpose"));
                        m.put("status", rs.getString("status"));
                        return m;
                    });
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    private String names(List<Map<String, Object>> list) {
        List<String> out = new ArrayList<>();
        list.forEach(m -> out.add(str(m.get("name"))));
        return String.join(", ", out);
    }

    /** Отчёты Tableau из app.panel_settings — сколько настроено и на каких серверах. */
    private Map<String, Object> tableauReports() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", 0L);
        out.put("servers", "");
        try {
            List<String> raw = jdbc.queryForList(
                    "SELECT value::text FROM app.panel_settings WHERE key = 'tableauReports'", String.class);
            if (raw.isEmpty()) return out;
            JsonNode all = json.readTree(raw.get(0));
            List<String> servers = new ArrayList<>();
            long n = 0;
            for (java.util.Iterator<String> it = all.fieldNames(); it.hasNext(); ) {
                JsonNode e = all.get(it.next());
                if (e == null || !e.isObject()) continue;
                n++;
                String server = e.path("server").asText("");
                if (!server.isEmpty() && !servers.contains(server)) servers.add(server);
            }
            out.put("total", n);
            out.put("servers", String.join(", ", servers));
        } catch (Exception ignore) {
            // ключа может не быть — раздел отчётов просто не настроен
        }
        return out;
    }

    private boolean ourDbOk() {
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ мелочи

    private Map<String, Object> node(String id, String title, String about, String status,
                                     String detail, String pane) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title);
        m.put("about", about);
        m.put("status", status);
        m.put("detail", detail == null ? "" : detail);
        m.put("pane", pane);      // куда вести по клику: id панели настроек либо null
        return m;
    }

    private Map<String, Object> flow(String from, String to, String title, String about, String status,
                                     String detail, String process, Map<String, Object> proc, String pane) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", from);
        m.put("to", to);
        m.put("title", title);
        m.put("about", about);
        m.put("status", status);
        m.put("detail", detail == null ? "" : detail);
        m.put("process", process);
        m.put("processEnabled", proc == null ? null : truthy(proc.get("enabled")));
        m.put("pane", pane);
        return m;
    }

    /** Проверка соединения не должна ронять карту: не вышло — так и покажем. */
    private Map<String, Object> safe(java.util.function.Supplier<Map<String, Object>> f) {
        try {
            Map<String, Object> m = f.get();
            return m == null ? Map.of() : m;
        } catch (RuntimeException e) {
            return Map.of("configured", true, "ok", false, "error", String.valueOf(e.getMessage()));
        }
    }

    private Map<String, Object> safeMap(java.util.function.Supplier<Map<String, Object>> f) {
        try {
            Map<String, Object> m = f.get();
            return m == null ? Map.of() : m;
        } catch (RuntimeException e) {
            return Map.of();
        }
    }

    private static boolean truthy(Object o) {
        return Boolean.TRUE.equals(o) || "true".equalsIgnoreCase(String.valueOf(o));
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    private static String str(Object o) {
        return o == null || "null".equals(String.valueOf(o)) ? "" : String.valueOf(o);
    }

    /** Метку времени показываем до минут: на карте важно «когда примерно», а не секунды. */
    private static String shortTs(String ts) {
        String s = str(ts);
        return s.length() > 16 ? s.substring(0, 16).replace('T', ' ') : s.replace('T', ' ');
    }
}
