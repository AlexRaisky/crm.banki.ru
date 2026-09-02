package ru.banki.crm.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.service.deploy.BuildInfoService;
import ru.banki.crm.service.prod.EventDbService;
import ru.banki.crm.service.prod.NoticeEtlService;
import ru.banki.crm.service.prod.ProcessControlService;
import ru.banki.crm.service.prod.ProdDbService;
import ru.banki.crm.service.prod.ProdSyncService;

import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Состояние системы одной страницей: сколько чего в таблицах, работают ли переливы,
 * докуда доехала очередь, что с подключениями и какая версия собрана.
 * <p>
 * Раздел отвечает на вопрос «всё ли в порядке», который задают в двух случаях: утром
 * перед работой и когда что-то сломалось. Поэтому здесь не метрики ради метрик, а ровно
 * те цифры, по которым это видно, — и каждая со своим порогом, чтобы страница сама
 * говорила «вот тут не так», а не оставляла читателя сравнивать числа.
 * <p>
 * Счётчики строк: точный {@code count(*)} для таблиц панели (они небольшие, и «примерно
 * 40 тысяч» здесь бесполезно) и оценка планировщика для тех, что переросли порог —
 * полное сканирование ради страницы состояния не стоит своих секунд.
 */
@Service
public class HealthService {

    /** Выше этого числа строк считаем оценкой, а не точным count(*). */
    private static final long EXACT_LIMIT = 200_000;

    /** Что показываем и как называем. Порядок — от главного к служебному. */
    private static final List<String[]> TABLES = List.of(
            new String[]{"template.d_template", "Шаблоны коммуникаций"},
            new String[]{"app.promo_plan", "План промо"},
            new String[]{"app.prod_sync", "Очередь синка с продом"},
            new String[]{"flow.f_communication", "Цепочки: конфигурация"},
            new String[]{"flow.f_communication_task", "Цепочки: задания"},
            new String[]{"app.users", "Учётки панели"},
            new String[]{"app.role", "Роли"},
            new String[]{"app.backlog_item", "Бэклог доработок"},
            new String[]{"arch.t_admin_log", "Журнал действий"},
            new String[]{"app.schema_audit", "Журнал конструктора схемы"}
    );

    private final JdbcTemplate jdbc;
    private final ProdDbService prod;
    private final EventDbService events;
    private final ProcessControlService control;
    private final ProdSyncService sync;
    private final NoticeEtlService etl;
    private final BuildInfoService build;

    @Value("${app.env.name:prod}")
    private String envName;

    public HealthService(JdbcTemplate jdbc, ProdDbService prod, EventDbService events,
                         ProcessControlService control, ProdSyncService sync,
                         NoticeEtlService etl, BuildInfoService build) {
        this.jdbc = jdbc;
        this.prod = prod;
        this.events = events;
        this.control = control;
        this.sync = sync;
        this.etl = etl;
        this.build = build;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> report() {
        List<Map<String, Object>> checks = new ArrayList<>();
        Map<String, Object> out = new LinkedHashMap<>();

        out.put("env", envName);
        out.put("build", build.summary());
        out.put("uptimeMs", ManagementFactory.getRuntimeMXBean().getUptime());
        out.put("generatedAt", java.time.Instant.now().toString());
        out.put("database", database());
        out.put("runtime", runtime(checks));
        out.put("tables", tables());
        List<Map<String, Object>> procs = processes(checks);
        out.put("processes", procs);
        out.put("queue", queue(checks, byCode(procs)));
        out.put("etl", etlBlock(checks, byCode(procs)));
        out.put("connections", connections(checks));
        /* Ниже — то, что на числах не видно: как система вела себя во времени. Сутки
           очереди отвечают на «работал ли перелив ночью», две недели правок — на «живёт
           ли контур вообще», а «когда последний раз» ловит то, что отвалилось молча. */
        out.put("pulse", pulse());
        out.put("activity", activity());
        out.put("freshness", freshness());
        out.put("content", content());
        out.put("storage", storage());
        out.put("checks", checks);
        /* Итог страницы одним словом: худшее из проверок. Читают его первым, а иногда и
           единственным — например с телефона. */
        out.put("status", worst(checks));
        return out;
    }

    // ------------------------------------------------------------------ база

    private Map<String, Object> database() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("size", str(one("SELECT pg_size_pretty(pg_database_size(current_database()))")));
        m.put("name", str(one("SELECT current_database()")));
        m.put("version", firstWords(str(one("SELECT version()")), 2));
        m.put("connections", num(one("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")));
        /* Последняя миграция — самый короткий ответ на вопрос «а этот контур вообще
           обновляли?»: номер сразу говорит, что в нём есть, а чего ещё нет. */
        m.put("migration", str(one("SELECT version || ' · ' || description FROM app.flyway_schema_history"
                + " WHERE success ORDER BY installed_rank DESC LIMIT 1")));
        m.put("migratedAt", str(one("SELECT to_char(installed_on, 'YYYY-MM-DD HH24:MI') FROM app.flyway_schema_history"
                + " WHERE success ORDER BY installed_rank DESC LIMIT 1")));
        Object failed = one("SELECT count(*) FROM app.flyway_schema_history WHERE NOT success");
        m.put("failedMigrations", num(failed));
        return m;
    }

    private List<Map<String, Object>> tables() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String[] t : TABLES) {
            String table = t[0];
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("table", table);
            m.put("title", t[1]);
            Object reg = one("SELECT to_regclass('" + table + "')");
            if (reg == null) {
                m.put("exists", false);
                m.put("rows", null);
                m.put("size", "");
                out.add(m);
                continue;
            }
            m.put("exists", true);
            long estimate = num(one("SELECT coalesce(reltuples, 0)::bigint FROM pg_class"
                    + " WHERE oid = to_regclass('" + table + "')"));
            boolean exact = estimate < EXACT_LIMIT;
            m.put("rows", exact ? num(one("SELECT count(*) FROM " + table)) : Math.max(estimate, 0));
            m.put("exact", exact);
            m.put("size", str(one("SELECT pg_size_pretty(pg_total_relation_size(to_regclass('" + table + "')))")));
            out.add(m);
        }
        return out;
    }

    // ------------------------------------------------------------------ машина

    /**
     * Память, потоки, соединения — единственное место страницы, где мы смотрим не на
     * данные, а на саму машину. Всё остальное можно пересчитать запросом, а нехватку
     * памяти или упёршийся в потолок пул соединений видно только отсюда.
     * <p>
     * Проверку заводим одну — на соединения. Занятая куча в JVM сама по себе ни о чём не
     * говорит: перед сборкой мусора она штатно доходит до потолка, и порог по ней сделал
     * бы страницу вечно жёлтой. Её показываем цифрой, а решение оставляем человеку.
     */
    private Map<String, Object> runtime(List<Map<String, Object>> checks) {
        Map<String, Object> m = new LinkedHashMap<>();
        Runtime rt = Runtime.getRuntime();
        long max = rt.maxMemory(), used = rt.totalMemory() - rt.freeMemory();
        m.put("heapUsed", used);
        m.put("heapMax", max);
        m.put("heapPct", max > 0 ? Math.round(used * 100.0 / max) : 0);
        m.put("threads", ManagementFactory.getThreadMXBean().getThreadCount());
        m.put("cpus", rt.availableProcessors());
        double load = ManagementFactory.getOperatingSystemMXBean().getSystemLoadAverage();
        m.put("load", load < 0 ? null : Math.round(load * 100) / 100.0);

        long conns = num(one("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"));
        long limit = num(one("SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections'"));
        long active = num(one("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
                + " AND state = 'active'"));
        m.put("dbConnections", conns);
        m.put("dbActive", active);
        m.put("dbMaxConnections", limit);
        m.put("dbConnPct", limit > 0 ? Math.round(conns * 100.0 / limit) : 0);
        if (limit > 0 && conns * 100.0 / limit > 80) {
            checks.add(check("connections", "warn", "Соединений к базе " + conns + " из " + limit,
                    "Пул почти выбран. Обычно это забытый долгий запрос — посмотрите pg_stat_activity."));
        }
        return m;
    }

    // ------------------------------------------------------------------ время

    /**
     * Сутки очереди по часам. Отвечает на вопрос, который числом «в очереди 0» не
     * закрывается: очередь пуста, потому что всё доехало, или потому что ночью ничего
     * не отправлялось. Поставленные и доставленные считаем по разным колонкам —
     * {@code timestamp_cr} и {@code timestamp_upd}, — иначе одна запись попала бы в час
     * постановки, а не в час доставки, и провал в переливе был бы не виден.
     */
    private List<Map<String, Object>> pulse() {
        if (!has("app.prod_sync")) return List.of();
        return rows("WITH hours AS (SELECT generate_series(date_trunc('hour', now()) - interval '23 hours',"
                + "   date_trunc('hour', now()), interval '1 hour') AS h)"
                + " SELECT to_char(hours.h, 'HH24:MI') AS label, to_char(hours.h, 'DD.MM HH24:MI') AS at,"
                + "   coalesce(c.n, 0)::bigint AS queued, coalesce(d.ok, 0)::bigint AS ok,"
                + "   coalesce(d.err, 0)::bigint AS err"
                + " FROM hours"
                + " LEFT JOIN (SELECT date_trunc('hour', timestamp_cr) AS h, count(*) AS n FROM app.prod_sync"
                + "   WHERE timestamp_cr > now() - interval '24 hours' GROUP BY 1) c ON c.h = hours.h"
                + " LEFT JOIN (SELECT date_trunc('hour', timestamp_upd) AS h,"
                + "     count(*) FILTER (WHERE status = 'OK') AS ok,"
                + "     count(*) FILTER (WHERE status = 'ERROR') AS err"
                + "   FROM app.prod_sync WHERE timestamp_upd > now() - interval '24 hours'"
                + "   GROUP BY 1) d ON d.h = hours.h"
                + " ORDER BY hours.h");
    }

    /** Две недели правок в панели: по дням, и над чем именно работали. */
    private Map<String, Object> activity() {
        Map<String, Object> m = new LinkedHashMap<>();
        if (!has("arch.t_admin_log")) return m;
        m.put("days", rows("WITH days AS (SELECT generate_series(current_date - 13, current_date,"
                + "   interval '1 day')::date AS d)"
                + " SELECT to_char(days.d, 'DD.MM') AS label, to_char(days.d, 'YYYY-MM-DD') AS day,"
                + "   coalesce(a.n, 0)::bigint AS n, coalesce(a.users, 0)::bigint AS users"
                + " FROM days LEFT JOIN (SELECT timestamp_cr::date AS d, count(*) AS n,"
                + "     count(DISTINCT action_user) AS users FROM arch.t_admin_log"
                + "   WHERE timestamp_cr >= current_date - 13 GROUP BY 1) a ON a.d = days.d"
                + " ORDER BY days.d"));
        m.put("tables", rows("SELECT coalesce(nullif(table_name, ''), '—') AS table_name, count(*)::bigint AS n"
                + " FROM arch.t_admin_log WHERE timestamp_cr >= current_date - 13"
                + " GROUP BY 1 ORDER BY 2 DESC LIMIT 6"));
        m.put("people", rows("SELECT coalesce(nullif(action_user, ''), '—') AS who, count(*)::bigint AS n"
                + " FROM arch.t_admin_log WHERE timestamp_cr >= current_date - 13"
                + " GROUP BY 1 ORDER BY 2 DESC LIMIT 6"));
        return m;
    }

    /**
     * «Когда последний раз». Самая полезная строка страницы при разборе: перелив,
     * отвалившийся молча, виден не по ошибке — ошибок нет, — а по тому, что последняя
     * удачная доставка была вчера.
     * <p>
     * Возраст считаем на сервере в секундах, а не отдаём отметку времени: у контуров и
     * браузеров разные часовые пояса, и «два часа назад» из-за этого превращалось бы
     * в «через три часа».
     */
    private List<Map<String, Object>> freshness() {
        List<Map<String, Object>> out = new ArrayList<>();
        /* Последний параметр — через сколько секунд молчание становится подозрительным.
           Ноль значит «не следим»: заведение шаблона или выкат делает человек, и «два дня
           назад» здесь нормально. Красить всё подряд по возрасту нельзя — страница
           краснела бы на выходных. */
        fresh(out, "Заведён шаблон", "template.d_template", "timestamp_cr", "",
                "последнее заведение или правка в панели", 0);
        fresh(out, "Шаблон доставлен в прод", "app.prod_sync", "timestamp_upd", "status = 'OK'",
                "последняя удачная запись в боевую базу", 6 * 3600);
        fresh(out, "Заведено событие", "flow.d_event", "timestamp_cr", "",
                "последнее онлайн-событие или событие по расписанию", 0);
        fresh(out, "Событие уехало в crmdb", "flow.t_event_export", "exported_at", "",
                "последний перелив события в боевую базу", 0);
        fresh(out, "Обратный ETL прочитал прод", "app.sync_watermark", "last_prod_ts", "",
                "самый свежий водяной знак по каналам", 6 * 3600);
        fresh(out, "Правка в панели", "arch.t_admin_log", "timestamp_cr", "",
                "любое действие над данными", 0);
        fresh(out, "Выкат", "app.deploy_log", "timestamp_cr", "",
                "последняя запись в журнале выкаток", 0);
        return out;
    }

    private void fresh(List<Map<String, Object>> out, String title, String table,
                       String column, String where, String hint, long warnAfterSec) {
        if (!has(table)) return;
        List<Map<String, Object>> r = rows("SELECT to_char(max(" + column + "), 'DD.MM HH24:MI') AS at,"
                + " extract(epoch from (now() - max(" + column + ")::timestamptz))::bigint AS ago"
                + " FROM " + table + (where.isEmpty() ? "" : " WHERE " + where));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", title);
        m.put("hint", hint);
        m.put("at", r.isEmpty() ? "" : str(r.get(0).get("at")));
        m.put("ago", r.isEmpty() ? null : r.get(0).get("ago"));
        m.put("warnAfter", warnAfterSec);
        out.add(m);
    }

    // ------------------------------------------------------------------ содержимое

    /** Из чего состоят данные контура: каналы шаблонов, виды событий, статусы очереди. */
    private Map<String, Object> content() {
        Map<String, Object> m = new LinkedHashMap<>();
        if (has("template.d_template")) {
            m.put("templates", rows("SELECT channel, count(*)::bigint AS n,"
                    + " (count(*) FILTER (WHERE active_flag))::bigint AS active"
                    + " FROM template.d_template GROUP BY 1 ORDER BY 2 DESC"));
            /* Месяц заведений — чтобы всплеск или тишина были видны без выгрузки в Excel. */
            m.put("trend", rows("WITH days AS (SELECT generate_series(current_date - 29, current_date,"
                    + "   interval '1 day')::date AS d)"
                    + " SELECT to_char(days.d, 'DD.MM') AS label, coalesce(t.n, 0)::bigint AS n"
                    + " FROM days LEFT JOIN (SELECT timestamp_cr::date AS d, count(*) AS n"
                    + "   FROM template.d_template WHERE timestamp_cr >= current_date - 29 GROUP BY 1) t"
                    + " ON t.d = days.d ORDER BY days.d"));
        }
        if (has("flow.d_event")) {
            m.put("events", rows("SELECT kind, count(*)::bigint AS n,"
                    + " (count(*) FILTER (WHERE is_active))::bigint AS active"
                    + " FROM flow.d_event GROUP BY 1 ORDER BY 2 DESC"));
        }
        if (has("app.prod_sync")) {
            m.put("queue", rows("SELECT status, count(*)::bigint AS n FROM app.prod_sync"
                    + " GROUP BY 1 ORDER BY 2 DESC"));
        }
        return m;
    }

    /**
     * Где лежит место. Считаем по всей базе, а не по списку {@link #TABLES}: место
     * обычно съедает как раз то, о чём не думали, — журнал, очередь, чужая таблица,
     * приехавшая переносом.
     */
    private Map<String, Object> storage() {
        Map<String, Object> m = new LinkedHashMap<>();
        String from = " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
                + " WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')"
                + " AND n.nspname NOT LIKE 'pg_%'";
        m.put("tables", rows("SELECT n.nspname || '.' || c.relname AS table_name,"
                + " pg_total_relation_size(c.oid)::bigint AS bytes,"
                + " pg_size_pretty(pg_total_relation_size(c.oid)) AS size,"
                + " coalesce(c.reltuples, 0)::bigint AS rows_estimate"
                + from + " ORDER BY 2 DESC LIMIT 10"));
        m.put("schemas", rows("SELECT n.nspname AS schema_name, count(*)::bigint AS tables,"
                + " sum(pg_total_relation_size(c.oid))::bigint AS bytes,"
                + " pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS size"
                + from + " GROUP BY 1 ORDER BY 3 DESC"));
        return m;
    }

    // ------------------------------------------------------------------ переливы

    private List<Map<String, Object>> processes(List<Map<String, Object>> checks) {
        List<Map<String, Object>> list;
        try {
            list = control.list();
        } catch (RuntimeException e) {
            return List.of();
        }
        long stopped = list.stream().filter(p -> !Boolean.TRUE.equals(p.get("enabled"))).count();
        if (stopped > 0) {
            /* Остановленный процесс — это решение человека, а не поломка: отмечаем как
               «обратите внимание», но не красным. Иначе дежурный побежит чинить то, что
               сам и перекрыл. */
            checks.add(check("processes", "warn", "Остановлено процессов: " + stopped,
                    "Проверьте раздел «Процессы переливов» — возможно, так и задумано."));
        } else {
            checks.add(check("processes", "ok", "Все переливы работают", ""));
        }
        return list;
    }

    /** Процессы по коду — чтобы проверки могли спросить «а не остановлено ли это руками». */
    private static Map<String, Map<String, Object>> byCode(List<Map<String, Object>> procs) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        procs.forEach(p -> out.put(String.valueOf(p.get("code")), p));
        return out;
    }

    private static boolean stopped(Map<String, Map<String, Object>> procs, String code) {
        Map<String, Object> p = procs.get(code);
        return p != null && !Boolean.TRUE.equals(p.get("enabled"));
    }

    private Map<String, Object> queue(List<Map<String, Object>> checks, Map<String, Map<String, Object>> procs) {
        Map<String, Object> q;
        try {
            q = new LinkedHashMap<>(sync.stats());
        } catch (RuntimeException e) {
            return Map.of();
        }
        long error = num(q.get("error")), pending = num(q.get("pending")), sending = num(q.get("sending"));
        if (error > 0) {
            checks.add(check("queue", "down", "В очереди синка ошибок: " + error,
                    "Откройте «Синхронизацию шаблонов»: у каждой записи виден текст отказа и кнопка повтора."));
        } else if (stopped(procs, ProcessControlService.PROD_SYNC) && pending > 0) {
            /* Доставку перекрыл человек — очередь копится не потому, что сломалось.
               Пишем причину прямо, иначе дежурный пойдёт чинить работающее. */
            checks.add(check("queue", "off", "Доставка шаблонов остановлена, в очереди: " + pending,
                    "Так и задумано, если перелив останавливали. Пустить обратно — в «Процессах переливов»."));
        } else if (pending > 50) {
            checks.add(check("queue", "warn", "Очередь синка растёт: " + pending,
                    "Столько записей ждут отправки. Проверьте, работает ли доставка и отвечает ли прод."));
        } else {
            checks.add(check("queue", "ok", "Очередь синка чистая", pending > 0 ? "ждут отправки: " + pending : ""));
        }
        /* Долго висящий SENDING значит, что доставка прервалась между отправкой и отметкой:
           сама очередь такое не переотправляет, и разбирается с этим человек. */
        if (sending > 0) {
            q.put("sendingNote", "отправляется прямо сейчас");
        }
        return q;
    }

    /**
     * У ETL два выключателя, и путать их нельзя: переменная {@code ETL_ENABLED} решает,
     * заведён ли процесс вообще, а кнопка в «Процессах переливов» — идёт ли он прямо
     * сейчас. Прогон требует обоих ({@code NoticeEtlService.tickIncremental}), поэтому и
     * проверка смотрит на оба: раньше она видела только переменную и продолжала ругаться
     * на процесс, который человек уже остановил, — с непонятным выводом «почему я не могу
     * это выключить».
     */
    private Map<String, Object> etlBlock(List<Map<String, Object>> checks, Map<String, Map<String, Object>> procs) {
        Map<String, Object> s;
        try {
            s = new LinkedHashMap<>(etl.status());
        } catch (RuntimeException e) {
            return Map.of();
        }
        boolean enabled = Boolean.TRUE.equals(s.get("enabled"));
        boolean configured = Boolean.TRUE.equals(s.get("configured"));
        boolean halted = stopped(procs, ProcessControlService.ETL_NOTICE);
        s.put("stopped", halted);
        if (halted) {
            checks.add(check("etl", "off", "Обратный ETL остановлен",
                    "Остановлен в «Процессах переливов». Пустить обратно — там же."));
        } else if (!enabled) {
            checks.add(check("etl", "off", "Обратный ETL выключен", "Включается переменной ETL_ENABLED."));
        } else if (!configured) {
            checks.add(check("etl", "warn", "ETL включён, но прод-приёмник не настроен",
                    "Выберите базу-приёмник в «Подключениях к БД» — или остановите ETL"
                    + " в «Процессах переливов», если на этом контуре он не нужен."));
        } else {
            checks.add(check("etl", "ok", "Обратный ETL работает", ""));
        }
        return s;
    }

    private List<Map<String, Object>> connections(List<Map<String, Object>> checks) {
        Map<String, Object> prodH = safe(prod::health);
        Map<String, Object> evH = safe(events::health);

        List<Map<String, Object>> out = new ArrayList<>();
        out.add(connection("Прод-БД шаблонов", prodH));
        out.add(connection("База событий crmdb", evH));

        addConnCheck(checks, "prod-db", "Прод-БД шаблонов", prodH,
                "Доставка шаблонов и обратный ETL сейчас не работают.");
        addConnCheck(checks, "event-db", "База событий crmdb", evH,
                "Импорт и перелив событий сейчас не работают.");

        /* Прочие подключения проверяем не сейчас, а показываем результат последней
           проверки: они нужны отчётам по требованию, и дёргать их при каждом открытии
           страницы состояния — лишняя нагрузка на чужие базы. */
        try {
            jdbc.queryForList("SELECT name, coalesce(purpose,'') AS purpose, coalesce(last_status,'') AS status,"
                            + " coalesce(last_error,'') AS error,"
                            + " to_char(last_checked_at, 'YYYY-MM-DD HH24:MI') AS checked"
                            + " FROM app.db_connection WHERE is_active AND NOT is_prod_sync AND NOT is_event_db"
                            + " ORDER BY name")
                    .forEach(r -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("title", str(r.get("name")));
                        m.put("purpose", str(r.get("purpose")));
                        m.put("ok", "OK".equalsIgnoreCase(str(r.get("status"))));
                        m.put("configured", true);
                        m.put("detail", "OK".equalsIgnoreCase(str(r.get("status")))
                                ? "проверено " + str(r.get("checked"))
                                : (str(r.get("error")).isEmpty() ? "не проверялось" : str(r.get("error"))));
                        m.put("live", false);
                        out.add(m);
                    });
        } catch (RuntimeException ignore) {
            // реестра может не быть на старой базе — остальная страница от этого не зависит
        }
        return out;
    }

    private void addConnCheck(List<Map<String, Object>> checks, String id, String title,
                              Map<String, Object> health, String consequence) {
        boolean configured = Boolean.TRUE.equals(health.get("configured"));
        boolean ok = alive(health);
        if (!configured) {
            checks.add(check(id, "off", title + ": не настроена", "Выберите базу в «Подключениях к БД»."));
        } else if (!ok) {
            checks.add(check(id, "down", title + ": не отвечает",
                    consequence + " " + str(health.get("error"))));
        } else {
            checks.add(check(id, "ok", title + ": отвечает", ""));
        }
    }

    private Map<String, Object> connection(String title, Map<String, Object> health) {
        boolean ok = alive(health);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", title);
        m.put("configured", Boolean.TRUE.equals(health.get("configured")));
        m.put("ok", ok);
        m.put("detail", ok
                ? str(health.get("url"))
                : str(health.getOrDefault("error", health.getOrDefault("message", ""))));
        m.put("live", true);
        return m;
    }

    /**
     * Отвечает ли подключение. Проверки писались в разное время и называют успех
     * по-разному: база событий кладёт {@code ok}, прод-БД — {@code reachable}. Читать
     * только один ключ значит однажды объявить живую базу мёртвой, что и случилось.
     */
    private static boolean alive(Map<String, Object> health) {
        return Boolean.TRUE.equals(health.get("ok")) || Boolean.TRUE.equals(health.get("reachable"));
    }

    // ------------------------------------------------------------------ мелочи

    private static Map<String, Object> check(String id, String status, String title, String hint) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("status", status);
        m.put("title", title);
        m.put("hint", hint);
        return m;
    }

    /** Худшее из состояний: страницу читают сверху и часто только первую строку. */
    private static String worst(List<Map<String, Object>> checks) {
        boolean warn = false;
        for (Map<String, Object> c : checks) {
            String s = String.valueOf(c.get("status"));
            if ("down".equals(s)) return "down";
            if ("warn".equals(s)) warn = true;
        }
        return warn ? "warn" : "ok";
    }

    private Map<String, Object> safe(java.util.function.Supplier<Map<String, Object>> f) {
        try {
            Map<String, Object> m = f.get();
            return m == null ? Map.of() : m;
        } catch (RuntimeException e) {
            return Map.of("configured", true, "ok", false, "error", String.valueOf(e.getMessage()));
        }
    }

    /**
     * Строки для графиков. Ошибку глушим так же, как в {@link #one}, но полагаться на
     * это нельзя: упавший оператор обрывает транзакцию целиком, и все следующие запросы
     * вернули бы пустоту. Поэтому к прикладным таблицам ходим только через {@link #has}.
     */
    private List<Map<String, Object>> rows(String sql) {
        try {
            return jdbc.queryForList(sql);
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    /** Есть ли таблица на этом контуре: у теста и прода набор разный. */
    private boolean has(String table) {
        return one("SELECT to_regclass('" + table + "')") != null;
    }

    private Object one(String sql) {
        try {
            List<Object> rows = jdbc.queryForList(sql, Object.class);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static String firstWords(String s, int words) {
        String[] parts = str(s).split("\\s+");
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < Math.min(words, parts.length); i++) {
            if (i > 0) b.append(' ');
            b.append(parts[i]);
        }
        return b.toString();
    }
}
