package ru.banki.crm.service.prod;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Затягивание событий из crmdb в нашу архитектуру — обратная сторона
 * {@link EventExportService}. В проде ничего не меняет, только читает.
 * <p>
 * Работа в два прохода, и порядок здесь принципиален:
 * <ol>
 *   <li><b>Слой B.</b> Строки прод-таблиц копируются в наши одноимённые копии. id у нас
 *       свои (identity), поэтому ссылки внутри пачки переставляются, а соответствие
 *       «наша строка ↔ продовая» пишется в {@code flow.t_event_link} с
 *       direction = IMPORT. Повторный прогон уже затянутое пропускает.</li>
 *   <li><b>Слой A.</b> Из накопленного слоя B собираются события {@code flow.d_event} и
 *       обвязка: доставка, расписание, шаги, шаблон, метод отправки. Здесь же наконец
 *       наполняется {@code flow.t_event_state} из V33 — таблица состояния, которая до
 *       сих пор пустовала, потому что зеркалить в неё было нечем.</li>
 * </ol>
 * Почему не одним проходом: событие в проде размазано по пяти таблицам, связанным не
 * ключами, а совпадением строк ({@code selection}, пара {@code event_name + system}).
 * Собрать его можно, только когда все части уже лежат рядом.
 */
@Service
public class EventImportService {

    private static final Logger log = LoggerFactory.getLogger(EventImportService.class);

    /** Порядок копирования: строка не может приехать раньше той, на которую ссылается. */
    private static final List<String> ORDER = List.of(
            "tracker.d_comm_creation",
            "tracker.t_event_comm",
            "scheduler.t_get_event",
            "scheduler.t_launch_settings",
            "scheduler.t_execution_steps",
            "template.d_template_mapping",
            "template.d_template_mapping_mass",
            "commapi.d_definition_mapping");

    /** Колонка-ссылка -> таблица, на которую она смотрит. */
    private static final Map<String, String> FK_OF = Map.of(
            "id_comm_creation", "tracker.d_comm_creation",
            "t_launch_settings_id", "scheduler.t_launch_settings",
            "get_event_id", "scheduler.t_get_event");

    private static final String MASS_TABLE = "template.d_template_mapping_mass";

    /** notify_channel прода -> канал единого справочника шаблонов. */
    private static final Map<String, String> CHANNEL_OF = Map.of(
            "SMS", "sms", "EMAIL", "email", "PUSH", "push",
            "CC", "cc", "FA", "fa", "VK", "vk");

    private final JdbcTemplate jdbc;
    private final EventDbService eventDb;
    private final AdminLogService adminLog;
    private final ObjectMapper om;
    private final Map<String, List<String>> colCache = new HashMap<>();

    private final ProcessControlService control;

    /** Потолок строк на таблицу: у хвоста маленький, у вечерней сверки большой. */
    @Value("${app.event-import.increment-limit:500}")
    private int incrementLimit;

    @Value("${app.event-import.full-limit:5000}")
    private int fullLimit;

    public EventImportService(JdbcTemplate jdbc, EventDbService eventDb,
                              AdminLogService adminLog, ObjectMapper om,
                              ProcessControlService control) {
        this.jdbc = jdbc;
        this.eventDb = eventDb;
        this.adminLog = adminLog;
        this.om = om;
        this.control = control;
    }

    // ================================================================= расписание

    /**
     * Частая сверка: не появилось ли в проде строк новее наших.
     * <p>
     * Дёшево именно потому, что смотрит только «хвост» — строки с id больше нашей
     * отметки по каждой таблице. Раз в несколько минут спрашивать так можно, а
     * вычитывать все восемь таблиц целиком — нет.
     */
    @Scheduled(fixedDelayString = "${app.event-import.interval-ms:300000}",
               initialDelayString = "${app.event-import.initial-delay-ms:90000}")
    public void tickIncremental() {
        /* Выключатель один — строка event-import в «Процессах переливов». Раньше поверх
           неё стояло свойство app.event-import.enabled с умолчанием false: экран
           показывал «включён», а импорт не запускался ни разу, и заметить это можно было
           только по пустому логу. Два выключателя, из которых виден не тот, что решает, —
           худший вид настройки. */
        if (!eventDb.configured() || !control.canStart(ProcessControlService.EVENT_IMPORT)) {
            return;
        }
        try {
            Map<String, Object> res = importAll(incrementLimit, true);
            long rows = cnt(res.get("copiedRows"));
            if (rows > 0) {
                log.info("event-import инкремент: строк {}, событий {}", rows, cnt(res.get("eventsBuilt")));
            }
            control.noteRun(ProcessControlService.EVENT_IMPORT,
                    "хвост: строк " + rows + ", событий " + cnt(res.get("eventsBuilt")));
        } catch (Exception e) {
            log.warn("event-import инкремент: {}", e.toString());
        }
    }

    /**
     * Вечерняя полная сверка: проходим таблицы целиком.
     * <p>
     * Нужна не «на всякий случай». Инкремент идёт по хвосту и не возвращается назад, а
     * строка могла быть пропущена из-за неприехавшей зависимости — например, шаг
     * выборки приехал раньше своей настройки запуска. Такие остаются позади отметки, и
     * подбирает их только этот прогон.
     */
    @Scheduled(cron = "${app.event-import.full-cron:0 30 22 * * *}")
    public void tickFull() {
        if (!eventDb.configured() || !control.canStart(ProcessControlService.EVENT_IMPORT)) {
            return;
        }
        try {
            Map<String, Object> res = importAll(fullLimit, false);
            log.info("event-import полная сверка: строк {}, событий {}",
                    cnt(res.get("copiedRows")), cnt(res.get("eventsBuilt")));
            control.noteRun(ProcessControlService.EVENT_IMPORT,
                    "полная сверка: строк " + cnt(res.get("copiedRows")) + ", событий " + cnt(res.get("eventsBuilt")));
        } catch (Exception e) {
            log.warn("event-import полная сверка: {}", e.toString());
        }
    }

    /** Последний продовый id, который мы уже затянули по этой таблице. */
    private long lastProdId(String table) {
        Long max = jdbc.queryForObject(
                "SELECT coalesce(max(prod_id), 0) FROM flow.t_event_link" +
                " WHERE our_table = ? AND direction = 'IMPORT'", Long.class, table);
        return max == null ? 0L : max;
    }

    /* Своё имя: num(Object) в этом классе уже есть и возвращает Long, который бывает
       null. Для счётчиков прогона нужен ноль, а не NPE при распаковке. */
    private static long cnt(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    // ==================================================================== разведка

    /**
     * Что есть в crmdb и сколько из этого уже у нас. Только счётчики — безопасно
     * запускать когда угодно, это первый шаг перед импортом.
     */
    public Map<String, Object> scan() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("configured", eventDb.configured());
        out.put("eventsOurs", jdbc.queryForObject("SELECT count(*) FROM flow.d_event", Long.class));
        if (!eventDb.configured()) {
            return out;
        }
        Map<String, Object> tables = new LinkedHashMap<>();
        try (Connection c = eventDb.connection()) {
            /* Каждая таблица считается ОТДЕЛЬНО и со своей обработкой ошибки. Одна
               недоступная таблица — обычное дело: права в crmdb выдаются поштучно, и
               «permission denied» на одной не должен превращать всю сверку в пустой
               экран. Ошибку показываем в её строке, остальные строки при этом честные. */
            for (String t : ORDER) {
                Map<String, Object> row = new LinkedHashMap<>();
                try {
                    row.put("prod", countIn(c, t));
                } catch (Exception e) {
                    row.put("error", rootMessage(e));
                }
                row.put("ours", jdbc.queryForObject("SELECT count(*) FROM " + t, Long.class));
                row.put("linked", jdbc.queryForObject(
                        "SELECT count(*) FROM flow.t_event_link WHERE our_table = ?", Long.class, t));
                tables.put(t, row);
            }
            /* Событий в проде столько, сколько строк в ДВУХ справочниках: онлайновые в
               t_event_comm, по расписанию в t_get_event. Остальные таблицы — обвязка,
               считать их как события нельзя. Берём уже посчитанное выше, чтобы не
               спрашивать базу дважды и не падать второй раз на тех же правах. */
            Long online = countOf(tables, "tracker.t_event_comm");
            Long offline = countOf(tables, "scheduler.t_get_event");
            out.put("eventsOnline", online);
            out.put("eventsOffline", offline);
            out.put("eventsInProd", online == null || offline == null ? null : online + offline);
        } catch (Exception e) {
            // сюда попадаем только если не открылось само соединение
            out.put("error", rootMessage(e));
        }
        out.put("tables", tables);
        return out;
    }

    /**
     * Достроить обвязку событиям, у которых строка слоя B есть, а расписания, шагов,
     * шаблонов или задания планировщика нет.
     * <p>
     * Нужно для тех, кого привязали прежними прогонами — до того, как привязка стала
     * достраивать обвязку. Разово это чинит накопившееся, дальше проход почти всегда
     * пустой: условие отбирает ровно неполные события.
     * <p>
     * Порция ограничена: у события до десятка запросов на добор, и чинить пять тысяч
     * за один прогон значит держать транзакцию столько же. Остальное доберут следующие
     * прогоны — их и так делают до тех пор, пока сервер говорит «есть ещё».
     */
    private int backfillExisting() {
        List<Map<String, Object>> broken = jdbc.queryForList(
                "SELECT m.our_id::bigint AS event_id, m.prod_table, m.prod_id::bigint AS our_row" +
                "  FROM flow.t_materialization m" +
                " WHERE m.our_entity = 'flow.d_event'" +
                "   AND m.prod_table IN ('scheduler.t_get_event', 'tracker.t_event_comm')" +
                "   AND (NOT EXISTS (SELECT 1 FROM flow.d_event_template t" +
                "                     WHERE t.event_id = m.our_id::bigint)" +
                "     OR (m.prod_table = 'scheduler.t_get_event'" +
                "         AND NOT EXISTS (SELECT 1 FROM flow.d_event_step s" +
                "                          WHERE s.event_id = m.our_id::bigint)))" +
                " ORDER BY m.our_id::bigint DESC LIMIT 200");
        int done = 0;
        for (Map<String, Object> r : broken) {
            Long evId = num(r.get("event_id")), rowId = num(r.get("our_row"));
            if (evId == null || rowId == null) {
                continue;   /* строка журнала без номеров — чинить нечего */
            }
            try {
                backfill(evId, str(r, "prod_table"), rowId);
                done++;
            } catch (Exception e) {
                /* Одно событие с битой ссылкой не должно останавливать добор остальных. */
                log.info("event-import: событию {} обвязку достроить не вышло: {}",
                        r.get("event_id"), rootMessage(e));
            }
        }
        if (done > 0) {
            log.info("event-import: достроена обвязка у {} событий", done);
        }
        return done;
    }

    /** Счётчик из уже собранной сводки: null, если по этой таблице была ошибка. */
    private static Long countOf(Map<String, Object> tables, String table) {
        Object row = tables.get(table);
        if (row instanceof Map<?, ?> m && m.get("prod") instanceof Number n) {
            return n.longValue();
        }
        return null;
    }

    private static long countIn(Connection c, String table) throws Exception {
        try (PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM " + table);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0L;
        }
    }

    // ===================================================================== импорт

    /**
     * Затянуть то, чего у нас ещё нет, и собрать из этого события.
     *
     * @param limitPerTable потолок строк на таблицу за прогон: прод-таблицы бывают
     *                      большими, а импорт идёт одной транзакцией. Прогон повторяют,
     *                      пока в ответе {@code more} не станет false.
     */
    /*
     * БЕЗ @Transactional, и это не упущение. В Postgres любая ошибка внутри транзакции
     * переводит её в aborted: все следующие команды отвечают «current transaction is
     * aborted» до самого конца блока. То есть «одна транзакция на весь импорт» и «тянем
     * всё, что можем, пропуская недоступное» — взаимоисключающие требования, и выбрано
     * второе. Атомарность отдельного события обеспечивается вручную: не собралось —
     * удаляем его целиком (обвязка уходит по ON DELETE CASCADE), чтобы не осталось
     * полусобранное, которое следующий прогон посчитает готовым.
     */
    public Map<String, Object> importAll(int limitPerTable) {
        return importAll(limitPerTable, false);
    }

    /** @param sinceLastId частая сверка: только строки новее нашей отметки по каждой таблице. */
    public Map<String, Object> importAll(int limitPerTable, boolean sinceLastId) {
        if (!eventDb.configured()) {
            throw bad("База событий (crmdb) не выбрана: /settings -> Подключения к БД, галка «база событий».");
        }
        /* Сводка строкой на таблицу: что затянулось, что пропущено и почему. Отдельные
           словари «получилось» и «не получилось» пришлось бы сопоставлять глазами, а
           вопрос у человека один — откуда взялось, а откуда нет. */
        /* Импорт идёт проходами, и цикл «пока more» крутит браузер. Значит выключатель
           обязан отвечать и здесь: иначе «остановить» работало бы, только пока открыта
           вкладка того, кто нажал. */
        control.requireEnabled(ProcessControlService.EVENT_IMPORT);
        List<Map<String, Object>> summary = new ArrayList<>();
        long total = 0;
        int skipped = 0;
        long pendingTotal = 0;
        boolean more = false;
        boolean stopped = false;
        try (Connection c = eventDb.connection()) {
            for (String table : ORDER) {
                /* Безопасная граница — между таблицами: строки одной таблицы копируются
                   пачкой со своими ссылками, и обрыв посередине оставил бы половину
                   пачки без пар в журнале связей. */
                if (control.stopRequested(ProcessControlService.EVENT_IMPORT)) {
                    stopped = true;
                    break;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("table", table);
                /* Недоступная таблица не отменяет весь импорт: тянем всё, что можем.
                   Учтите — без части таблиц ссылки внутри пачки останутся пустыми, и это
                   написано в ответе прямым текстом, а не подразумевается. */
                try {
                    int[] pending = {0};
                    int n = copyTable(c, table, limitPerTable, pending, sinceLastId);
                    row.put("status", "ok");
                    row.put("rows", n);
                    if (pending[0] > 0) row.put("pending", pending[0]);
                    pendingTotal += pending[0];
                    total += n;
                    if (n >= limitPerTable) {
                        more = true;
                    }
                } catch (Exception e) {
                    row.put("status", "skipped");
                    row.put("rows", 0);
                    row.put("error", rootMessage(e));
                    skipped++;
                    log.warn("импорт из crmdb: таблица {} пропущена: {}", table, rootMessage(e));
                }
                summary.add(row);
            }
        } catch (Exception e) {
            log.warn("импорт событий из crmdb не удался: {}", rootMessage(e));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Импорт не выполнен, соединение с crmdb не открылось: " + rootMessage(e));
        }

        Map<String, Object> online = buildOnlineEvents();
        Map<String, Object> offline = buildOfflineEvents();
        int repaired = backfillExisting();
        int built = intOf(online.get("built")) + intOf(offline.get("built"));
        int adopted = intOf(online.get("adopted")) + intOf(offline.get("adopted"));
        int eventErrors = intOf(online.get("failed")) + intOf(offline.get("failed"));
        adminLog.logTable("flow.d_event", "INSERT",
                "{\"imported_rows\":" + total + ",\"events\":" + built + "}");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("copiedRows", total);
        out.put("summary", summary);
        out.put("tablesSkipped", skipped);
        out.put("eventsBuilt", built);
        out.put("eventsOnline", online.get("built"));
        out.put("eventsOffline", offline.get("built"));
        out.put("eventsFailed", eventErrors);
        /* Строки, привязанные к событиям, которые уже были заведены у нас. Новых событий
           из них не появилось, но и «затянуто ноль» про них сказать нельзя: работа
           сделана, и без этой цифры она выглядела бы как ничего. */
        out.put("eventsAdopted", adopted);
        /* События, которым достроили недостающую обвязку. Отдельной цифрой: новых
           событий не появилось, но карточки, которые были пустыми, перестали такими
           быть — и это стоит увидеть, а не гадать, изменилось ли что-нибудь. */
        out.put("eventsRepaired", repaired);
        out.put("eventErrors", concat(online.get("errors"), offline.get("errors")));
        out.put("pending", pendingTotal);
        /* Отложенные строки — тоже повод для следующего прогона: их зависимости приехали
           в этом. Условие «и что-то скопировалось» защищает от вечного цикла на сиротах,
           у которых ссылки нет и в проде: такие не разрешатся никогда. */
        /* Остановлен — значит и клиенту незачем идти на следующий проход: more гасим,
           иначе браузер продолжал бы стучаться и получать 409 на каждом заходе. */
        out.put("more", !stopped && (more || (pendingTotal > 0 && total > 0)));
        if (stopped) out.put("stopped", "Импорт остановлен по запросу, часть таблиц не читалась");
        control.noteRun(ProcessControlService.EVENT_IMPORT,
                "строк " + total + ", событий " + built + (stopped ? ", остановлен по запросу" : ""));
        return out;
    }

    // ------------------------------------------------------------ слой B: копирование

    /** Копирует строки одной прод-таблицы, которых у нас ещё нет. Возвращает их число. */
    private int copyTable(Connection c, String table, int limit, int[] pending) throws Exception {
        return copyTable(c, table, limit, pending, false);
    }

    /**
     * @param sinceLastId тянуть только строки с id больше нашего последнего.
     *                    Это режим частой сверки: в проде id растут, и вопрос «появилось
     *                    ли что-то новое» отвечается одним сравнением вместо вычитывания
     *                    всей таблицы каждые пять минут. Платим за это тем, что строки,
     *                    пропущенные из-за неприехавшей зависимости, остаются позади
     *                    отметки и назад мы за ними не возвращаемся — их подбирает
     *                    вечерний полный прогон, который идёт по всей таблице.
     */
    private int copyTable(Connection c, String table, int limit, int[] pending, boolean sinceLastId)
            throws Exception {
        Set<Long> known = sinceLastId ? Set.of() : new HashSet<>(jdbc.queryForList(
                "SELECT prod_id FROM flow.t_event_link WHERE our_table = ?", Long.class, table));
        long watermark = sinceLastId ? lastProdId(table) : 0L;
        Map<String, Map<Long, Long>> maps = new HashMap<>();

        List<Object[]> links = new ArrayList<>();
        int done = 0;
        String sql = sinceLastId
                ? "SELECT id, to_jsonb(t)::text FROM " + table + " t WHERE id > " + watermark + " ORDER BY id"
                : "SELECT id, to_jsonb(t)::text FROM " + table + " t ORDER BY id";
        try (PreparedStatement ps = c.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next() && done < limit) {
                long prodId = rs.getLong(1);
                if (known.contains(prodId)) {
                    continue;
                }
                ObjectNode values = (ObjectNode) om.readTree(rs.getString(2));
                values.remove("id");                  // id у нас свой, identity
                if (!remapForeignKeys(table, values, maps)) {
                    pending[0]++;                     // зависимость ещё не приехала — ждём прогона
                    continue;
                }
                Long ourId = insertOurs(table, values);
                if (ourId == null) {
                    continue;
                }
                links.add(new Object[]{table, ourId, prodId, CurrentUser.email()});
                done++;
            }
        }
        if (!links.isEmpty()) {
            jdbc.batchUpdate("INSERT INTO flow.t_event_link" +
                    " (our_table, our_id, prod_id, linked_by, direction)" +
                    " VALUES (?, ?, ?, ?, 'IMPORT')", links);
        }
        return done;
    }

    /**
     * Ссылки прода переставляем на наши id по журналу соответствий.
     * <p>
     * Пары нет — значит строка, на которую ссылаются, ещё не затянута: прогон берёт не
     * больше limit строк на таблицу, и зависимость легко оказывается за этой границей.
     * Тогда строку НЕ вставляем вовсе и ждём следующего прогона.
     * <p>
     * Раньше в этом случае ссылка обнулялась — и это было прямой ошибкой: у
     * t_execution_steps.t_launch_settings_id стоит NOT NULL, вставка падала, а вместе с
     * ней пропускалась вся таблица за прогон. Испортить связь тише, чем потерять строку,
     * тоже не вариант: шаг выборки без своего расписания бессмыслен.
     *
     * @return false, если хоть одну ссылку сопоставить не удалось
     */
    private boolean remapForeignKeys(String table, ObjectNode values, Map<String, Map<Long, Long>> maps) {
        boolean ok = true;
        for (Map.Entry<String, String> e : FK_OF.entrySet()) {
            if (!remapOne(values, e.getKey(), e.getValue(), maps)) ok = false;
        }
        if (MASS_TABLE.equals(table) && !remapOne(values, "event_id", "scheduler.t_get_event", maps)) {
            ok = false;
        }
        return ok;
    }

    /** @return false, если значение есть, а пары к нему в журнале ещё нет */
    private boolean remapOne(ObjectNode values, String col, String refTable,
                             Map<String, Map<Long, Long>> maps) {
        if (!values.hasNonNull(col)) {
            return true;                      // пустая ссылка — это нормально, переставлять нечего
        }
        Map<Long, Long> map = maps.computeIfAbsent(refTable, t -> {
            Map<Long, Long> m = new HashMap<>();
            jdbc.queryForList("SELECT prod_id, our_id FROM flow.t_event_link WHERE our_table = ?", t)
                    .forEach(r -> m.put(((Number) r.get("prod_id")).longValue(),
                                        ((Number) r.get("our_id")).longValue()));
            return m;
        });
        Long ours = map.get(values.get(col).asLong());
        if (ours == null) {
            return false;
        }
        values.put(col, ours);
        return true;
    }

    /** Вставка в НАШУ таблицу: id даёт identity, типы приводит jsonb_populate_record. */
    private Long insertOurs(String table, ObjectNode values) {
        List<String> ourCols = ourColumns(table);
        List<String> cols = new ArrayList<>();
        values.fieldNames().forEachRemaining(k -> {
            if ("id".equals(k) || !ourCols.contains(k)) return;
            if (!k.matches("[a-z_][a-z0-9_]*")) return;
            if (values.get(k) == null || values.get(k).isNull()) return;
            cols.add(k);
        });
        if (cols.isEmpty()) {
            return null;
        }
        String colList = String.join(", ", cols);
        String valList = String.join(", ", cols.stream().map(k -> "p." + k).toList());
        String sql = "INSERT INTO " + table + " (" + colList + ") SELECT " + valList +
                " FROM jsonb_populate_record(NULL::" + table + ", ?::jsonb) p RETURNING id";
        return jdbc.queryForObject(sql, Long.class, values.toString());
    }

    private List<String> ourColumns(String table) {
        return colCache.computeIfAbsent(table, t -> {
            String[] parts = t.split("[.]", 2);
            return jdbc.queryForList(
                    "SELECT column_name FROM information_schema.columns" +
                    " WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
                    String.class, parts[0], parts[1]);
        });
    }

    // -------------------------------------------------------------- слой A: сборка

    /**
     * Онлайновые события: t_event_comm плюс его набор параметров доставки.
     * <p>
     * Сбой на одном событии не отменяет остальные: причина обычно локальная (не сошёлся
     * канал, нет шаблона), и терять из-за неё девяносто девять собранных событий незачем.
     */
    private Map<String, Object> buildOnlineEvents() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT ec.*, cc.notify_channel AS cc_channel, cc.send_delay AS cc_delay," +
                "       cc.lifetime AS cc_lifetime, cc.allow_ml AS cc_ml," +
                "       cc.comm_decision_tree_id AS cc_tree" +
                "  FROM tracker.t_event_comm ec" +
                "  LEFT JOIN tracker.d_comm_creation cc ON cc.id = ec.id_comm_creation" +
                " WHERE NOT EXISTS (SELECT 1 FROM flow.t_materialization m" +
                "                    WHERE m.our_entity = 'flow.d_event'" +
                "                      AND m.prod_table = 'tracker.t_event_comm'" +
                "                      AND m.prod_id = ec.id::text)");
        int built = 0, adopted = 0;
        List<String> errors = new ArrayList<>();
        for (Map<String, Object> r : rows) {
          try {
            Long eventId = insertEvent("income", str(r, "event_name"), str(r, "system"), null,
                    str(r, "group_event_descr"), bool(r, "is_active"), null);
            if (eventId == null) {
                /* Событие с таким именем и системой уже есть — но это НЕ значит, что оно
                   знает про эту строку. Так бывает, когда событие завели формой, а строку
                   слоя B потеряли (её удалили руками, импорт затянул заново с новым id).
                   Раньше здесь стоял голый continue: строка оставалась без отметки о
                   принадлежности, каждый прогон снова попадала в выборку и не собиралась
                   никогда, а событие в панели выглядело как непереведённое в прод —
                   переливать у него было нечего. Теперь привязываем строку к событию. */
                if (adopt(findEventId(str(r, "event_name"), str(r, "system")),
                        "tracker.t_event_comm", num(r.get("id")))) {
                    adopted++;
                }
                continue;
            }
            jdbc.update("INSERT INTO flow.d_event_delivery" +
                            " (event_id, notify_channel, sub_channel, platform, send_delay," +
                            "  life_time, allow_ml, comm_decision_tree_id, stop_product_ids, stop_events)" +
                            " SELECT ?, ?, ?, ?, ?, ?, ?, ?, ec.stop_product_ids, ec.stop_events" +
                            "   FROM tracker.t_event_comm ec WHERE ec.id = ?",
                    eventId, str(r, "cc_channel"), str(r, "sub_channel"), str(r, "platform"),
                    r.get("cc_delay"), r.get("cc_lifetime"), bool(r, "cc_ml"), r.get("cc_tree"),
                    r.get("id"));
            link(eventId, "tracker.t_event_comm", num(r.get("id")));
            link(eventId, "tracker.d_comm_creation", num(r.get("id_comm_creation")));
            attachMappings(eventId, str(r, "event_name"), str(r, "system"));
            built++;
          } catch (Exception e) {
            errors.add("онлайн «" + str(r, "event_name") + "»: " + rootMessage(e));
            dropEvent(str(r, "event_name"), str(r, "system"));
          }
        }
        return Map.of("built", built, "adopted", adopted,
                "failed", errors.size(), "errors", errors);
    }

    /** События по расписанию: t_get_event + настройки запуска + шаги выборки. */
    private Map<String, Object> buildOfflineEvents() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM scheduler.t_get_event ge" +
                " WHERE NOT EXISTS (SELECT 1 FROM flow.t_materialization m" +
                "                    WHERE m.our_entity = 'flow.d_event'" +
                "                      AND m.prod_table = 'scheduler.t_get_event'" +
                "                      AND m.prod_id = ge.id::text)");
        int built = 0, adopted = 0;
        List<String> errors = new ArrayList<>();
        for (Map<String, Object> r : rows) {
          try {
            String selection = str(r, "selection");
            Long eventId = insertEvent("time", str(r, "event_name"), str(r, "system"),
                    str(r, "source"), str(r, "group_event_descr"), bool(r, "is_active"), selection);
            if (eventId == null) {
                /* См. онлайн-ветку: имя занято существующим событием, а строка про него не
                   знает. Привязываем, иначе она будет всплывать в каждом прогоне. */
                if (adopt(findEventId(str(r, "event_name"), str(r, "system")),
                        "scheduler.t_get_event", num(r.get("id")))) {
                    adopted++;
                }
                continue;
            }
            jdbc.update("INSERT INTO flow.d_event_delivery" +
                            " (event_id, notify_channel, sub_channel, platform, send_delay," +
                            "  life_time, allow_ml, comm_decision_tree_id)" +
                            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    eventId, str(r, "notify_channel"), str(r, "sub_channel"), str(r, "platform"),
                    r.get("send_delay"), r.get("life_time"), bool(r, "allow_ml"),
                    r.get("comm_decision_tree_id"));
            link(eventId, "scheduler.t_get_event", num(r.get("id")));
            attachSchedule(eventId, selection);
            attachMappings(eventId, str(r, "event_name"), str(r, "system"));
            built++;
          } catch (Exception e) {
            errors.add("расписание «" + str(r, "event_name") + "»: " + rootMessage(e));
            dropEvent(str(r, "event_name"), str(r, "system"));
          }
        }
        return Map.of("built", built, "adopted", adopted,
                "failed", errors.size(), "errors", errors);
    }

    /**
     * Расписание и шаги. Настройки ищем по selection: внешнего ключа между t_get_event и
     * t_launch_settings в проде нет, связь держится на совпадении строки.
     */
    private void attachSchedule(long eventId, String selection) {
        if (selection == null || selection.isBlank()) {
            return;
        }
        /* Строк расписания на одно событие бывает несколько: планировщик заводит новую
           при каждой регистрации, и после пары переливов их накапливается три-четыре с
           одним и тем же selection. Шаги привязаны к ОДНОЙ из них — берём ту, у которой
           они есть, и только если таких нет, самую свежую. Прежний «первый по id» с
           равной вероятностью выбирал пустую, и событие оставалось без шагов при живых
           шагах в соседней строке. */
        List<Map<String, Object>> found = jdbc.queryForList(
                "SELECT ls.* FROM scheduler.t_launch_settings ls" +
                " WHERE ls.selection = ?" +
                " ORDER BY (SELECT count(*) FROM scheduler.t_execution_steps st" +
                "            WHERE st.t_launch_settings_id = ls.id) DESC, ls.id DESC LIMIT 1",
                selection);
        if (found.isEmpty()) {
            return;
        }
        Map<String, Object> s = found.get(0);
        ensureDatabase(str(s, "database"));
        jdbc.update("INSERT INTO flow.d_event_schedule" +
                        " (event_id, crontab, database, is_batch, max_retry_attempts, priority, job_group)" +
                        " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING",
                eventId, str(s, "crontab"), nz(str(s, "database"), "crmdb"), bool(s, "is_batch"),
                s.get("max_retry_attempts"), s.get("priority"), str(s, "job_group"));
        /* Ради этого и заводилась t_event_state в V33: состояние планировщика, которое до
           сих пор было нечем наполнить. Три колонки прода со словом status раскладываются
           по трём с честными именами: фаза, знает ли о задании крон, чем кончился прогон. */
        jdbc.update("INSERT INTO flow.t_event_state" +
                        " (event_id, phase, cron_state, last_result, date_next," +
                        "  time_start, period_unit, period_q, date_start, date_end)" +
                        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
                        " ON CONFLICT (event_id) DO UPDATE SET phase = EXCLUDED.phase," +
                        "   cron_state = EXCLUDED.cron_state, last_result = EXCLUDED.last_result," +
                        "   date_next = EXCLUDED.date_next, synced_at = now()",
                eventId, str(s, "status"), str(s, "cron_status"), str(s, "last_exec_status"),
                s.get("date_next"), s.get("time_start"), str(s, "period_unit"),
                s.get("period_q"), s.get("date_start"), s.get("date_end"));
        link(eventId, "scheduler.t_launch_settings", num(s.get("id")));

        List<Map<String, Object>> steps = jdbc.queryForList(
                "SELECT * FROM scheduler.t_execution_steps WHERE t_launch_settings_id = ?" +
                " ORDER BY order_num, id", s.get("id"));
        int n = 0;
        for (Map<String, Object> st : steps) {
            n++;
            /* order_num в проде уникальностью не защищён, задвоенные там встречаются. У нас
               на (event_id, order_num) стоит UNIQUE (V33), поэтому нумеруем заново подряд —
               сам порядок при этом сохраняется. */
            jdbc.update("INSERT INTO flow.d_event_step" +
                            " (event_id, order_num, process_name, sql_text, returns_result_set, is_active)" +
                            " VALUES (?, ?, ?, ?, ?, ?)",
                    eventId, n, str(st, "process_name"), str(st, "sql_text"),
                    bool(st, "returns_result_set"), bool(st, "is_active"));
            link(eventId, "scheduler.t_execution_steps", num(st.get("id")));
        }
    }

    /** Шаблон и метод отправки: и то и другое ищется по паре event_name + system. */
    private void attachMappings(long eventId, String eventName, String system) {
        for (Map<String, Object> m : jdbc.queryForList(
                "SELECT * FROM template.d_template_mapping" +
                " WHERE event_name = ? AND coalesce(system,'') = coalesce(?,'')", eventName, system)) {
            jdbc.update("INSERT INTO flow.d_event_template" +
                            " (event_id, template_id, segment_id, is_multiple_choice)" +
                            " VALUES (?, ?, ?, ?)",
                    eventId, localTemplate(str(m, "notify_channel"), m.get("template_id")),
                    m.get("segment_id"), bool(m, "is_multiple_choice"));
            link(eventId, "template.d_template_mapping", num(m.get("id")));
        }
        int step = 0;
        for (Map<String, Object> m : jdbc.queryForList(
                "SELECT * FROM template.d_template_mapping_mass WHERE event_name = ? ORDER BY id",
                eventName)) {
            step++;
            jdbc.update("INSERT INTO flow.d_event_template (event_id, template_id, step_no)" +
                            " VALUES (?, ?, ?)",
                    eventId, localTemplate(str(m, "channel"), m.get("template_id")), step);
            link(eventId, MASS_TABLE, num(m.get("id")));
        }
        for (Map<String, Object> d : jdbc.queryForList(
                "SELECT * FROM commapi.d_definition_mapping" +
                " WHERE event_name = ? AND coalesce(system,'') = coalesce(?,'')", eventName, system)) {
            jdbc.update("INSERT INTO flow.d_event_definition (event_id, notify_channel," +
                            " definition_key, business_key_prefix, is_correlation, correlation_keys)" +
                            " SELECT ?, ?, ?, ?, ?, dm.correlation_keys" +
                            "   FROM commapi.d_definition_mapping dm WHERE dm.id = ?",
                    eventId, str(d, "notify_channel"), str(d, "definition_key"),
                    str(d, "business_key_prefix"), bool(d, "is_correlation"), d.get("id"));
            link(eventId, "commapi.d_definition_mapping", num(d.get("id")));
        }
    }

    // ------------------------------------------------------------------- кусочки

    /**
     * Событие в справочнике. При совпадении (event_name, system) чужое НЕ переписываем:
     * возвращаем null, и сборка этого прохода пропускается. Такое бывает штатно — одно и
     * то же имя встречается и в онлайне, и в расписании.
     */
    private Long insertEvent(String kind, String eventName, String system, String source,
                             String group, boolean active, String description) {
        List<Long> ids = jdbc.queryForList(
                "INSERT INTO flow.d_event (kind, event_name, system, source, group_event_descr," +
                " description, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)" +
                " ON CONFLICT (event_name, system) DO NOTHING RETURNING id",
                Long.class, kind, eventName, nz(system, ""), source, group, description, active);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /** id события по имени и системе; null — нет или неоднозначно. */
    private Long findEventId(String eventName, String system) {
        List<Long> ids = jdbc.queryForList(
                "SELECT id FROM flow.d_event" +
                " WHERE event_name = ? AND coalesce(system,'') = coalesce(?,'')",
                Long.class, eventName, nz(system, ""));
        /* Двух событий с одним именем быть не должно — на паре стоит уникальность. Но
           если они как-то появились, выбирать между ними наугад нельзя: привязанная не к
           тому событию строка уедет в прод под чужим именем. */
        return ids.size() == 1 ? ids.get(0) : null;
    }

    /**
     * Привязать существующее событие к строке слоя B, о которой оно не знает.
     * <p>
     * Только отметка о принадлежности — ни доставку, ни маппинги здесь не заводим: у
     * события они уже есть, а вставка вторых сделала бы из одного события полтора.
     * <p>
     * Не трогаем событие, у которого своя строка этой таблицы уже есть: значит в проде
     * лежат две строки с одним именем, и вторая — не его. Такую оставляем как есть, она
     * видна в сверке как незатянутая.
     *
     * @return true, если привязали
     */
    private boolean adopt(Long eventId, String table, Long ourId) {
        if (eventId == null || ourId == null) {
            return false;
        }
        Integer has = jdbc.queryForObject(
                "SELECT count(*) FROM flow.t_materialization" +
                " WHERE our_entity = 'flow.d_event' AND our_id = ? AND prod_table = ?",
                Integer.class, String.valueOf(eventId), table);
        if (has != null && has > 0) {
            return false;
        }
        link(eventId, table, ourId);
        backfill(eventId, table, ourId);
        log.info("event-import: строка {}#{} привязана к уже заведённому событию {}",
                table, ourId, eventId);
        return true;
    }

    /**
     * Достроить обвязку события, которой у него нет.
     * <p>
     * Привязать строку мало: карточка события показывает расписание, шаги выборки,
     * шаблоны и задание планировщика, а всё это лежит в отдельных таблицах нашей модели.
     * У «усыновлённого» события их не было — оно заводилось формой (и тогда обвязка
     * своя) либо доставалось из прода другим проходом, после которого осталось только
     * имя. На экране это выглядело как «Шаги (0), Шаблоны (0), задание не заведено» —
     * при том, что в проде всё на месте.
     * <p>
     * Достраиваем только пустое. Повторная вставка маппингов удвоила бы шаблоны, а
     * повторная вставка шагов упёрлась бы в UNIQUE (event_id, order_num).
     */
    private void backfill(long eventId, String table, Long ourId) {
        if ("scheduler.t_get_event".equals(table)) {
            if (!empty(eventId, "flow.d_event_step") && !empty(eventId, "flow.d_event_schedule")) {
                return;
            }
            List<Map<String, Object>> ge = jdbc.queryForList(
                    "SELECT selection, event_name, system FROM scheduler.t_get_event WHERE id = ?", ourId);
            if (ge.isEmpty()) {
                return;
            }
            attachSchedule(eventId, nz(str(ge.get(0), "selection"), str(ge.get(0), "event_name")));
            if (empty(eventId, "flow.d_event_template")) {
                attachMappings(eventId, str(ge.get(0), "event_name"), str(ge.get(0), "system"));
            }
        } else if ("tracker.t_event_comm".equals(table)) {
            List<Map<String, Object>> ec = jdbc.queryForList(
                    "SELECT event_name, system FROM tracker.t_event_comm WHERE id = ?", ourId);
            if (!ec.isEmpty() && empty(eventId, "flow.d_event_template")) {
                attachMappings(eventId, str(ec.get(0), "event_name"), str(ec.get(0), "system"));
            }
        }
        linkCron(eventId);
    }

    /** В таблице нет ни одной строки этого события. */
    private boolean empty(long eventId, String table) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM " + table + " WHERE event_id = ?", Integer.class, eventId);
        return n == null || n == 0;
    }

    /**
     * Задание планировщика для события, пришедшего из прода.
     * <p>
     * Панель считает, что задания нет, если о нём нет записи в {@code flow.t_event_cron},
     * — и предлагает «Зарегистрировать» событие, у которого расписание в проде давно
     * стоит. Второе задание на то же событие ничем хорошим не кончится.
     * <p>
     * Id задания и есть id строки {@code scheduler.t_launch_settings}: планировщик её сам
     * создаёт и её же номер возвращает при регистрации. Значит для затянутых событий он
     * известен — лежит в журнале связей.
     */
    private void linkCron(long eventId) {
        Integer has = jdbc.queryForObject(
                "SELECT count(*) FROM flow.t_event_cron WHERE event_id = ?", Integer.class, eventId);
        if (has != null && has > 0) {
            return;
        }
        List<Long> ids = jdbc.queryForList(
                "SELECT prod_id FROM flow.t_event_link" +
                " WHERE event_id = ? AND our_table = 'scheduler.t_launch_settings'" +
                " ORDER BY id LIMIT 1", Long.class, eventId);
        if (ids.isEmpty()) {
            return;
        }
        jdbc.update("INSERT INTO flow.t_event_cron" +
                        " (event_id, cron_event_id, last_status, last_action, last_actor)" +
                        " VALUES (?, ?, NULL, 'import', ?) ON CONFLICT (event_id) DO NOTHING",
                eventId, ids.get(0), CurrentUser.email());
        log.info("event-import: событию {} проставлено задание планировщика {}", eventId, ids.get(0));
    }

    /** Отметка «эта строка нашего слоя B принадлежит этому событию» — как у материализации. */
    private void link(long eventId, String ourTable, Long ourId) {
        if (ourId == null) {
            return;
        }
        /* Только если такой отметки ещё нет. Уникальности на тройке в таблице не стоит
           (её ведут и материализация цепочек, и импорт), а вставка «в лоб» плодила
           дубли: добор обвязки повторяется каждый прогон, пока событие неполное, и
           каждый раз дописывал ту же строку. В карточке это выглядело как несколько
           одинаковых связей на одну запись. */
        jdbc.update("INSERT INTO flow.t_materialization" +
                        " (our_entity, our_id, prod_table, prod_id, materialized_by)" +
                        " SELECT 'flow.d_event', ?, ?, ?, ?" +
                        " WHERE NOT EXISTS (SELECT 1 FROM flow.t_materialization" +
                        "   WHERE our_entity = 'flow.d_event' AND our_id = ?" +
                        "     AND prod_table = ? AND prod_id = ?)",
                String.valueOf(eventId), ourTable, String.valueOf(ourId), CurrentUser.email(),
                String.valueOf(eventId), ourTable, String.valueOf(ourId));
        // событие в журнале соответствий известно только здесь: при копировании его ещё нет
        jdbc.update("UPDATE flow.t_event_link SET event_id = ?" +
                        " WHERE our_table = ? AND our_id = ? AND event_id IS NULL",
                eventId, ourTable, ourId);
    }

    /** Продовый код шаблона -> id в едином справочнике. Не нашли — связь остаётся пустой. */
    private Long localTemplate(String notifyChannel, Object code) {
        String channel = CHANNEL_OF.get(notifyChannel == null ? "" : notifyChannel.toUpperCase());
        if (channel == null || !(code instanceof Number n)) {
            return null;
        }
        List<Long> ids = jdbc.queryForList(
                "SELECT id FROM template.d_template WHERE channel = ? AND code = ?",
                Long.class, channel, n.longValue());
        return ids.isEmpty() ? null : ids.get(0);
    }

    /** База выборки обязана быть в справочнике: с V33 на неё смотрит внешний ключ. */
    private void ensureDatabase(String code) {
        if (code == null || code.isBlank()) {
            return;
        }
        jdbc.update("INSERT INTO flow.d_database (code, description) VALUES (?, ?)" +
                " ON CONFLICT (code) DO NOTHING", code, "Заведена импортом из crmdb");
    }

    /**
     * Снести недособранное событие. Без этого полусобранная запись осталась бы навсегда:
     * следующий прогон увидел бы её в d_event, получил бы null из insertEvent
     * (ON CONFLICT DO NOTHING) и молча прошёл мимо. Обвязка уходит по ON DELETE CASCADE,
     * отметки принадлежности строк — руками, внешнего ключа у них нет.
     */
    private void dropEvent(String eventName, String system) {
        try {
            List<Long> ids = jdbc.queryForList(
                    "SELECT id FROM flow.d_event WHERE event_name = ? AND coalesce(system,'') = ?",
                    Long.class, eventName, nz(system, ""));
            for (Long id : ids) {
                jdbc.update("DELETE FROM flow.t_materialization" +
                        " WHERE our_entity = 'flow.d_event' AND our_id = ?", String.valueOf(id));
                jdbc.update("UPDATE flow.t_event_link SET event_id = NULL WHERE event_id = ?", id);
                jdbc.update("DELETE FROM flow.d_event WHERE id = ?", id);
            }
        } catch (Exception e) {
            log.warn("не удалось снести недособранное событие «{}»: {}", eventName, rootMessage(e));
        }
    }

    @SuppressWarnings("unchecked")
    private static List<String> concat(Object a, Object b) {
        List<String> out = new ArrayList<>();
        if (a instanceof List<?> l) out.addAll((List<String>) l);
        if (b instanceof List<?> l) out.addAll((List<String>) l);
        return out;
    }

    private static String str(Map<String, Object> r, String k) {
        Object v = r.get(k);
        return v == null ? null : String.valueOf(v);
    }

    private static boolean bool(Map<String, Object> r, String k) {
        return r.get(k) instanceof Boolean b && b;
    }

    private static int intOf(Object v) {
        return v instanceof Number n ? n.intValue() : 0;
    }

    private static Long num(Object v) {
        return v instanceof Number n ? n.longValue() : null;
    }

    private static String nz(String v, String def) {
        return v == null || v.isBlank() ? def : v;
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
