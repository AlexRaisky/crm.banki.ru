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
        out.put("tables", tables());
        out.put("processes", processes(checks));
        out.put("queue", queue(checks));
        out.put("etl", etlBlock(checks));
        out.put("connections", connections(checks));
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

    private Map<String, Object> queue(List<Map<String, Object>> checks) {
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

    private Map<String, Object> etlBlock(List<Map<String, Object>> checks) {
        Map<String, Object> s;
        try {
            s = new LinkedHashMap<>(etl.status());
        } catch (RuntimeException e) {
            return Map.of();
        }
        boolean enabled = Boolean.TRUE.equals(s.get("enabled"));
        boolean configured = Boolean.TRUE.equals(s.get("configured"));
        if (!enabled) {
            checks.add(check("etl", "off", "Обратный ETL выключен", "Включается переменной ETL_ENABLED."));
        } else if (!configured) {
            checks.add(check("etl", "down", "ETL включён, но прод-приёмник не настроен",
                    "Выберите базу-приёмник в «Подключениях к БД»."));
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
        boolean ok = Boolean.TRUE.equals(health.get("ok"));
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
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", title);
        m.put("configured", Boolean.TRUE.equals(health.get("configured")));
        m.put("ok", Boolean.TRUE.equals(health.get("ok")));
        m.put("detail", Boolean.TRUE.equals(health.get("ok"))
                ? str(health.get("url"))
                : str(health.getOrDefault("error", health.getOrDefault("message", ""))));
        m.put("live", true);
        return m;
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
