package ru.banki.crm.service.prod;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;
import ru.banki.crm.service.cron.CronService;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Перелив события в crmdb: строки НАШЕГО слоя B переносятся в одноимённые таблицы
 * боевой базы, которые читают движки рассылок.
 * <p>
 * Приёмник здесь СВОЙ, не тот, куда уезжают шаблоны. Шаблоны идут в базу со схемами
 * notice/callcenter (флаг is_prod_sync), события — в crmdb со схемами tracker,
 * scheduler, template, commapi (флаг is_event_db). Обе строки лежат в одном реестре
 * app.db_connection и различаются только флагом.
 * <p>
 * Зачем отдельный шаг, а не запись сразу в прод: заведение события — это до восьми строк
 * в пяти таблицах со ссылками друг на друга, и половина из них имеет смысл только вместе.
 * Сначала событие собирается у нас целиком, потом уезжает одним действием.
 * <p>
 * Четыре вещи, без которых перелив ломается:
 * <ol>
 *   <li><b>id назначает прод.</b> Мы его не считаем и не передаём: строка уходит без
 *       колонки id, а присвоенный номер забирается через {@code RETURNING}. Прежний
 *       {@code max(id)+1} был гонкой с любым другим писателем и обходом
 *       последовательности, если она у колонки есть. Наш локальный id в прод не
 *       переносится в любом случае.</li>
 *   <li><b>Внешние ключи переставляются.</b> Раз id другой, ссылки внутри пачки
 *       (id_comm_creation, t_launch_settings_id, get_event_id) надо заменить на
 *       продовые. Отсюда фиксированный порядок вставки: сначала то, на что ссылаются.</li>
 *   <li><b>Строка едет через jsonb.</b> Читаем {@code to_jsonb(t)}, вставляем через
 *       {@code jsonb_populate_record} — тем же приёмом, что и шаблоны. Иначе массивы
 *       ({@code stop_product_ids}, {@code correlation_keys}) и jsonb-колонки пришлось бы
 *       перекладывать между двумя соединениями руками, а {@code java.sql.Array} к чужому
 *       соединению не привяжешь.</li>
 *   <li><b>Расписание создаёт планировщик.</b> {@code scheduler.t_launch_settings} мы не
 *       вставляем: её заводит {@code POST /api/v1/event}, и он же создаёт контекст
 *       Quartz. Возвращённый id идёт в {@code t_execution_steps.t_launch_settings_id}.
 *       Пока вставляли и мы, на событие приходилось две строки расписания — наша с
 *       шагами и сервисная с заданием, но без шагов.</li>
 *   <li><b>Справочники не дописываются.</b> {@code tracker.d_comm_creation} перелив
 *       только читает (см. {@link #PROD_READ_ONLY}): событие выбирает готовый набор
 *       параметров доставки, а не заводит свой.</li>
 *   <li><b>Повторный перелив ничего не дублирует.</b> Каждая уехавшая строка
 *       записывается в {@code flow.t_event_link} с UNIQUE (our_table, our_id); строка,
 *       которая уже там есть, второй раз не отправляется. Ровно на этом мы обожглись с
 *       очередью шаблонов, когда откат транзакции уносил отметку «доставлено» и запись
 *       уезжала в прод дважды.</li>
 * </ol>
 */
@Service
public class EventExportService {

    private static final Logger log = LoggerFactory.getLogger(EventExportService.class);

    /**
     * Порядок вставки: строка не может уехать раньше той, на которую ссылается.
     * Он же — белый список: таблицы вне этого набора перелив не трогает.
     */
    private static final List<String> ORDER = List.of(
            "tracker.d_comm_creation",
            "tracker.t_event_comm",
            "scheduler.t_get_event",
            "scheduler.t_launch_settings",
            "scheduler.t_execution_steps",
            "template.d_template_mapping",
            "template.d_template_mapping_mass",
            "commapi.d_definition_mapping");

    /**
     * Таблицы, в которые перелив НЕ ПИШЕТ никогда.
     * <p>
     * {@code tracker.d_comm_creation} — справочник наборов параметров доставки. Его
     * девятнадцать строк заведены в проде руками с 2022 года, и новых там быть не должно:
     * событие ссылается на готовый набор, а не создаёт свой. Раньше таблица стояла в
     * общем списке наравне с остальными, и перелив цепочки, у которой материализация
     * завела собственный набор, дописывал в боевой справочник двадцатую строку — тихо,
     * потому что вставка проходит без ошибки.
     * <p>
     * Из {@link #ORDER} таблицу не убираем: строки такого рода в нашем слое B бывают, и
     * встретив их, перелив должен осознанно пропустить, а не упасть на «таблица не входит
     * в набор». Ссылка на неё при этом обязана разрешиться по журналу связей — иначе
     * событие в прод не поедет вовсе.
     */
    private static final Set<String> PROD_READ_ONLY = Set.of("tracker.d_comm_creation");

    /**
     * Строку расписания в проде создаём НЕ мы, а планировщик.
     * <p>
     * {@code POST /api/v1/event} принимает ровно набор колонок этой таблицы, вставляет её
     * сам и заодно заводит контекст Quartz. Пока мы вставляли её тоже, на одно событие
     * приходилось две строки: наша — с шагами выборки, и созданная сервисом — с заданием,
     * но без шагов. Исполнялась вторая, то есть не исполнялось ничего.
     * <p>
     * Из {@link #ORDER} таблицу не убираем: строка такого рода в нашем слое B есть, и
     * встретив её, перелив должен осознанно передать дело планировщику, а не упасть на
     * «таблица не входит в набор».
     */
    private static final String LAUNCH_TABLE = "scheduler.t_launch_settings";

    /** Колонка-ссылка → таблица, на которую она смотрит. Значение подменяется продовым id. */
    private static final Map<String, String> FK_OF = Map.of(
            "id_comm_creation", "tracker.d_comm_creation",
            "t_launch_settings_id", "scheduler.t_launch_settings",
            "get_event_id", "scheduler.t_get_event");

    /** Ссылка на t_get_event, названная не как у всех: только в этой таблице. */
    private static final String MASS_TABLE = "template.d_template_mapping_mass";

    private final JdbcTemplate jdbc;
    private final EventDbService eventDb;
    private final AdminLogService adminLog;
    private final ObjectMapper om;
    private final CronService cron;

    private final ProcessControlService control;

    public EventExportService(JdbcTemplate jdbc, EventDbService eventDb,
                              AdminLogService adminLog, ObjectMapper om,
                              CronService cron,
                              ProcessControlService control) {
        this.jdbc = jdbc;
        this.eventDb = eventDb;
        this.adminLog = adminLog;
        this.om = om;
        this.cron = cron;
        this.control = control;
    }

    // ================================================================== состояние

    /** События с их состоянием перелива — для списка в разделе. */
    public List<Map<String, Object>> list(int limit) {
        return jdbc.queryForList(
                "SELECT e.id, e.kind, e.event_name, e.system, e.is_active, e.timestamp_cr," +
                "       count(m.id) AS rows_total," +
                "       count(x.id) AS rows_exported," +
                "       max(x.linked_at) AS exported_at," +
                "       max(x.linked_by) AS exported_by" +
                "  FROM flow.d_event e" +
                "  LEFT JOIN flow.t_materialization m" +
                "         ON m.our_entity = 'flow.d_event' AND m.our_id = e.id::text" +
                "  LEFT JOIN flow.t_event_link x" +
                "         ON x.our_table = m.prod_table AND x.our_id::text = m.prod_id" +
                " GROUP BY e.id" +
                " ORDER BY e.id DESC LIMIT ?", limit);
    }

    // ==================================================================== перелив

    /** Перелить одно событие. Возвращает, что уехало и что пропущено как уехавшее ранее. */
    public Map<String, Object> export(long eventId) {
        /* Одно событие уезжает целиком за один вызов, поэтому «остановить на границе»
           здесь не про что: граница — сам вызов. Выключатель решает только, начинать ли
           его вообще. Именно так перекрывают запись в прод во время инцидента. */
        control.requireEnabled(ProcessControlService.EVENT_EXPORT);
        if (!eventDb.configured()) {
            throw bad("База событий (crmdb) не выбрана: /settings → Подключения к БД, галка «база событий».");
        }
        List<String> names = jdbc.queryForList(
                "SELECT event_name FROM flow.d_event WHERE id = ?", String.class, eventId);
        if (names.isEmpty()) {
            throw bad("Событие " + eventId + " не найдено");
        }
        String eventName = names.get(0);

        // строки нашего слоя B, сделанные этим событием
        List<Map<String, Object>> ours = new ArrayList<>(jdbc.queryForList(
                "SELECT prod_table AS tbl, prod_id AS id FROM flow.t_materialization" +
                " WHERE our_entity = 'flow.d_event' AND our_id = ? ORDER BY id",
                String.valueOf(eventId)));
        if (ours.isEmpty()) {
            throw bad("У события «" + eventName + "» нет строк слоя B — переливать нечего");
        }
        for (Map<String, Object> r : ours) {
            if (!ORDER.contains(String.valueOf(r.get("tbl")))) {
                throw bad("Таблица " + r.get("tbl") + " не входит в набор перелива");
            }
        }
        ours.sort((a, b) -> Integer.compare(
                ORDER.indexOf(String.valueOf(a.get("tbl"))),
                ORDER.indexOf(String.valueOf(b.get("tbl")))));

        /* Соответствие «наша строка → строка в проде», по ПАРЕ таблица+id, а не по одной
           таблице. Раньше ключом была таблица, и в карте оставалась последняя строка из
           неё — для t_get_event и t_launch_settings это безразлично (их по одной на
           событие), а для всего остального было бы неверно.

           Карта наполняется по ходу: сначала тем, что уехало раньше, потом каждой
           вставкой этой пачки. Строки, на которые ссылаются, идут первыми — порядок задан
           ORDER, — поэтому к моменту переставления ссылки нужный id уже здесь. */
        Map<String, Long> prodIdOf = new LinkedHashMap<>();   // таблица#наш_id -> id в проде
        Map<String, Long> already = new HashMap<>();          // то же, но только для пропуска
        jdbc.queryForList("SELECT our_table, our_id, prod_id FROM flow.t_event_link" +
                        " WHERE event_id = ?", eventId)
                .forEach(r -> {
                    String key = r.get("our_table") + "#" + r.get("our_id");
                    long pid = ((Number) r.get("prod_id")).longValue();
                    already.put(key, pid);
                    prodIdOf.put(key, pid);
                });

        List<Map<String, Object>> sent = new ArrayList<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        List<Object[]> journal = new ArrayList<>();

        /* ---- ПЕРВЫМ ДЕЛОМ: расписание заводит планировщик.
           Вызов чужого API стоит ДО транзакции в crmdb намеренно: откатить его нельзя, и
           внутри транзакции он превратил бы откат в ложь. При сбое дальше остаётся
           зарегистрированное, но ОСТАНОВЛЕННОЕ задание без шагов — оно ничего не сделает,
           и это лучший из возможных остатков.

           Повторный перелив второго задания не заводит: id берётся из flow.t_event_cron. */
        Long launchOurId = ourRowId(ours, LAUNCH_TABLE);
        Long launchProdId = null;
        if (launchOurId != null) {
            launchProdId = already.get(LAUNCH_TABLE + "#" + launchOurId);
            if (launchProdId == null) {
                launchProdId = cron.registeredId(eventId);
            }
            if (launchProdId == null) {
                Map<String, Object> reg = cron.register(eventId);
                Object id = reg.get("cronEventId");
                if (id == null) {
                    throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                            "Планировщик не вернул id задания — переливать шаги некуда."
                            + " Перелив остановлен, в crmdb ничего не записано.");
                }
                launchProdId = ((Number) id).longValue();
            }
            prodIdOf.put(LAUNCH_TABLE + "#" + launchOurId, launchProdId);
            if (!already.containsKey(LAUNCH_TABLE + "#" + launchOurId)) {
                journal.add(new Object[]{eventId, LAUNCH_TABLE, launchOurId, launchProdId,
                        CurrentUser.email()});
                sent.add(Map.of("table", LAUNCH_TABLE, "ourId", launchOurId,
                        "prodId", launchProdId, "by", "планировщик"));
            }
        }

        try (Connection c = eventDb.connection()) {
            c.setAutoCommit(false);
            try {
                for (Map<String, Object> row : ours) {
                    String table = String.valueOf(row.get("tbl"));
                    long ourId = Long.parseLong(String.valueOf(row.get("id")));
                    Long done = already.get(table + "#" + ourId);
                    if (done != null) {
                        skipped.add(Map.of("table", table, "ourId", ourId, "prodId", done));
                        continue;
                    }
                    if (LAUNCH_TABLE.equals(table)) {
                        /* Уже создано планировщиком выше — сюда доходим только затем,
                           чтобы не вставить её вторично. */
                        continue;
                    }
                    if (PROD_READ_ONLY.contains(table)) {
                        /* Пропускаем молча для базы, но громко для человека: строка
                           числится в слое B события, а в прод не поедет, и это должно
                           быть видно в отчёте о переливе, а не выясняться потом. */
                        skipped.add(Map.of("table", table, "ourId", ourId,
                                "prodId", "—", "reason", "справочник прода, запись запрещена"));
                        continue;
                    }
                    ObjectNode values = readOurRow(table, ourId);
                    remapForeignKeys(table, values, prodIdOf);
                    /* id не назначаем — его выдаёт прод. Раньше он считался как max+1 и
                       вставлялся явно: это гонка с любым другим писателем в ту же
                       таблицу и, если у колонки есть последовательность, ещё и способ
                       её обойти — она не сдвинется, и следующая чужая вставка упрётся в
                       занятый номер. */
                    long prodId = insertIntoProd(c, table, values);
                    prodIdOf.put(table + "#" + ourId, prodId);
                    journal.add(new Object[]{eventId, table, ourId, prodId, CurrentUser.email()});
                    sent.add(Map.of("table", table, "ourId", ourId, "prodId", prodId));
                }
                c.commit();
            } catch (Exception e) {
                try { c.rollback(); } catch (Exception ignored) { }
                throw e;
            }
        } catch (ResponseStatusException e) {
            /* Наш собственный отказ (например, несопоставимая ссылка) — он уже объясняет
               причину человеческим языком. Заворачивать его в «перелив не выполнен: 409
               CONFLICT ...» значит спрятать объяснение внутрь чужого текста. Транзакция к
               этому моменту откачена там же, где и при любой другой ошибке. */
            log.warn("перелив события {} остановлен: {}", eventId, e.getReason());
            throw e;
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            log.warn("перелив события {} не удался: {}", eventId, msg);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Перелив не выполнен, в проде ничего не создано: " + msg + hintFor(msg));
        }

        /* Прод уже закоммичен. Отметку пишем немедленно: без неё повторное нажатие
           отправит те же строки второй раз. Если журнал всё же не записался — говорим
           об этом прямо, молчать тут нельзя. */
        if (!journal.isEmpty()) {
            try {
                jdbc.batchUpdate("INSERT INTO flow.t_event_link" +
                        " (event_id, our_table, our_id, prod_id, linked_by, direction)" +
                        " VALUES (?, ?, ?, ?, ?, 'EXPORT')",
                        journal);
            } catch (Exception e) {
                log.error("событие {} уехало в прод, но журнал перелива не записан: {}", eventId, e.toString());
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "Строки созданы в проде, но журнал перелива не записан. НЕ повторяйте перелив — " +
                        "будут дубли. Созданное: " + sent);
            }
            adminLog.logTable("flow.t_event_link", "INSERT",
                    "{\"event_id\":" + eventId + ",\"rows\":" + sent.size() + "}");
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("eventId", eventId);
        out.put("eventName", eventName);
        out.put("sent", sent);
        out.put("skipped", skipped);
        control.noteRun(ProcessControlService.EVENT_EXPORT,
                "«" + eventName + "»: отправлено " + sent.size() + ", пропущено " + skipped.size());
        return out;
    }

    // ------------------------------------------------------------------- кусочки

    /**
     * Строка нашего слоя B как jsonb, без id: в проде он будет свой. Через json, а не
     * через колонки, чтобы массивы и jsonb доехали как есть — {@code java.sql.Array} с
     * нашего соединения к продовому не привяжешь.
     */
    private ObjectNode readOurRow(String table, long id) throws Exception {
        List<String> rows = jdbc.queryForList(
                "SELECT (to_jsonb(t) - 'id')::text FROM " + table + " t WHERE id = ?",
                String.class, id);
        if (rows.isEmpty()) {
            throw new IllegalStateException("строка " + table + "#" + id +
                    " числится в журнале материализации, но в таблице её нет");
        }
        return (ObjectNode) om.readTree(rows.get(0));
    }

    /**
     * Ссылки переставляем с наших id на продовые.
     * <p>
     * Ищем по значению самой ссылки: в колонке лежит НАШ id строки, и продовый ему
     * соответствующий надо найти именно для неё. Раньше поиск шёл по одному имени
     * таблицы, а в карте лежала последняя строка из этой таблицы, — для ссылок внутри
     * пачки это случайно совпадало, а для {@code id_comm_creation} не совпадало никогда.
     * <p>
     * Порядок поиска: сначала пачка (эти строки только что вставлены, записи в журнале
     * связей ещё нет — она пишется после коммита), потом журнал целиком. По журналу ищем
     * БЕЗ фильтра по событию: соответствие «наша строка ↔ продовая» глобальное, и набор
     * параметров доставки, затянутый импортом в составе чужого события, для нас такой же
     * годный ориентир. Уникальность (our_table, our_id) гарантирует, что строка одна.
     * <p>
     * Не нашли — <b>отказываемся переливать</b>. Оставить наш id, как делалось раньше,
     * значит записать в прод ссылку на чужой набор параметров доставки: строка вставится
     * без ошибки, событие будет выглядеть заведённым, а уходить будет не туда. Такое
     * потом находят по жалобе, а не по логу.
     */
    private void remapForeignKeys(String table, ObjectNode values, Map<String, Long> prodIdOf) {
        FK_OF.forEach((col, refTable) -> remapOne(values, col, refTable, prodIdOf));
        /* d_template_mapping_mass называет ссылку на t_get_event просто event_id.
           В общий словарь это имя не положить: слишком легко переставить им что-то
           чужое в таблице, где event_id значит другое. */
        if (MASS_TABLE.equals(table)) {
            remapOne(values, "event_id", "scheduler.t_get_event", prodIdOf);
        }
    }

    private void remapOne(ObjectNode values, String col, String refTable, Map<String, Long> prodIdOf) {
        if (!values.hasNonNull(col)) {
            return;
        }
        long ourRef = values.get(col).asLong();
        Long mapped = prodIdOf.get(refTable + "#" + ourRef);
        if (mapped == null) {
            mapped = linkedProdId(refTable, ourRef);
        }
        if (mapped == null && PROD_READ_ONLY.contains(refTable)) {
            /* Завести недостающую строку в проде тут нельзя — это справочник. Значит
               выбранного набора параметров доставки в боевой базе просто нет, и событие
               ссылается в пустоту. Единственный правильный выход — выбрать существующий. */
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Ссылка " + col + " = " + ourRef + " указывает на строку " + refTable
                    + ", которой нет в проде. Эта таблица — справочник, дописывать её"
                    + " перелив не имеет права. Выберите в форме набор параметров доставки"
                    + " из тех, что уже заведены в crmdb, или затяните справочник импортом."
                    + " Перелив остановлен — в прод ничего не записано.");
        }
        if (mapped == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Не с чем сопоставить ссылку " + col + " = " + ourRef + " (" + refTable + "):"
                    + " этой строки нет в проде и нет в журнале связей. Затяните её импортом"
                    + " («Настройки» → «Перелив событий») или выберите в форме другую."
                    + " Перелив остановлен — в прод ничего не записано.");
        }
        values.put(col, mapped);
    }

    /**
     * Подсказка к чужой ошибке — там, где причина не в том, о чём она говорит.
     * <p>
     * «duplicate key … already exists» после того, как мы перестали назначать id сами,
     * почти всегда означает одно: у колонки есть последовательность, но она отстала от
     * данных. Отстала потому, что прежние переливы вставляли id явно (max+1), а явная
     * вставка последовательность не двигает. Человеку, который видит это впервые,
     * сообщение Postgres не говорит ничего — а лечится всё одним setval.
     */
    private static String hintFor(String msg) {
        String m = msg == null ? "" : msg.toLowerCase();
        if (m.contains("duplicate key") && m.contains("_pkey")) {
            return ". Похоже, последовательность id в прод-таблице отстала от данных:"
                 + " прежние переливы вставляли id явно и её не двигали. Лечится один раз —"
                 + " setval(pg_get_serial_sequence('<схема.таблица>','id'),"
                 + " (SELECT max(id) FROM <схема.таблица>)) для таблиц перелива.";
        }
        return "";
    }

    /** Наш id строки указанной таблицы в слое B события; null — такой строки нет. */
    private static Long ourRowId(List<Map<String, Object>> ours, String table) {
        for (Map<String, Object> r : ours) {
            if (table.equals(String.valueOf(r.get("tbl")))) {
                return Long.parseLong(String.valueOf(r.get("id")));
            }
        }
        return null;
    }

    /** Продовый id нашей строки по журналу связей; null — соответствия нет. */
    private Long linkedProdId(String ourTable, long ourId) {
        List<Long> ids = jdbc.queryForList(
                "SELECT prod_id FROM flow.t_event_link WHERE our_table = ? AND our_id = ?",
                Long.class, ourTable, ourId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /**
     * INSERT в прод. Идентификатор назначает сама база, мы его только забираем.
     * <p>
     * Раньше id считался как {@code max(id)+1} и вставлялся явно. Это плохо двумя
     * способами сразу: гонка с любым другим писателем в ту же таблицу и, если у колонки
     * всё-таки есть последовательность, обход этой последовательности — она не
     * сдвигается, и следующая чужая вставка упирается в занятый номер.
     * <p>
     * Типы приводит {@code jsonb_populate_record} по DDL прод-таблицы, поэтому массивы
     * и jsonb не приходится перекладывать между соединениями руками.
     *
     * @return id, который присвоил прод
     */
    private static long insertIntoProd(Connection c, String table, ObjectNode values)
            throws Exception {
        Set<String> prodCols = prodColumns(c, table);
        List<String> cols = new ArrayList<>();
        values.fieldNames().forEachRemaining(k -> {
            if ("id".equals(k) || !prodCols.contains(k)) return;   // лишнюю колонку прод не примет
            if (!k.matches("[a-z_][a-z0-9_]*")) return;            // имя уходит в текст запроса
            if (values.get(k) == null || values.get(k).isNull()) return;
            cols.add(k);
        });
        if (cols.isEmpty()) {
            /* Раньше в запросе всегда был хотя бы id, и пустой список колонок не
               встречался. Теперь встречается — и «INSERT INTO t () SELECT» это
               синтаксическая ошибка, о которой лучше сказать по-человечески. */
            throw new IllegalStateException(
                    "В строке " + table + " не осталось ни одной колонки для вставки:"
                    + " все либо пустые, либо отсутствуют в прод-таблице");
        }
        StringBuilder colList = new StringBuilder();
        StringBuilder valList = new StringBuilder();
        for (String k : cols) {
            if (colList.length() > 0) {
                colList.append(", ");
                valList.append(", ");
            }
            colList.append(k);
            valList.append("p.").append(k);
        }
        String sql = "INSERT INTO " + table + " (" + colList + ") SELECT " + valList +
                " FROM jsonb_populate_record(NULL::" + table + ", ?::jsonb) p RETURNING id";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, values.toString());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new IllegalStateException(
                            "Прод не вернул id вставленной строки " + table);
                }
                return rs.getLong(1);
            }
        }
    }

    private static Set<String> prodColumns(Connection c, String table) throws Exception {
        Set<String> cols = new LinkedHashSet<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT * FROM " + table + " WHERE false");
             ResultSet rs = ps.executeQuery()) {
            ResultSetMetaData md = rs.getMetaData();
            for (int i = 1; i <= md.getColumnCount(); i++) {
                cols.add(md.getColumnLabel(i));
            }
        }
        return cols;
    }

    /**
     * Расхождение DDL между нами и продом — до перелива, а не во время. Колонка, которой
     * в проде нет, при вставке просто отбрасывается, и об этом лучше знать заранее.
     */
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("configured", eventDb.configured());
        if (!eventDb.configured()) {
            return out;
        }
        Map<String, Object> tables = new LinkedHashMap<>();
        try (Connection c = eventDb.connection()) {
            for (String t : ORDER) {
                tables.put(t, columnDiff(c, t));
            }
        } catch (Exception e) {
            out.put("error", e.getMessage());
        }
        out.put("tables", tables);
        return out;
    }

    private Map<String, Object> columnDiff(Connection c, String table) {
        Map<String, Object> res = new LinkedHashMap<>();
        String[] parts = table.split("\\.", 2);
        try {
            List<String> ourCols = jdbc.queryForList(
                    "SELECT column_name FROM information_schema.columns" +
                    " WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
                    String.class, parts[0], parts[1]);
            Set<String> prodCols = prodColumns(c, table);
            List<String> missing = new ArrayList<>(ourCols);
            missing.removeAll(prodCols);
            res.put("ours", ourCols.size());
            res.put("prod", prodCols.size());
            res.put("missingInProd", missing);
        } catch (Exception e) {
            res.put("error", e.getMessage());
        }
        return res;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
