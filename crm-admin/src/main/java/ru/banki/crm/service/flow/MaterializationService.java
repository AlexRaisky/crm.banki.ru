package ru.banki.crm.service.flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.dto.JourneyDtos.JourneyNode;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Материализация цепочки: слой A (flow.*) + инсерты в слой B (tracker/scheduler/
 * template/commapi) по образцу DO-скрипта старой Appsmith-админки, но:
 *  - id через sequences (никаких max(id)+1);
 *  - FK между таблицами слоя B подставляются автоматически (в предпросмотре "(auto)");
 *  - каждая вставка журналируется в t_admin_log и flow.t_materialization;
 *  - повторная материализация той же цепочки: старые строки слоя B удаляются
 *    по журналу t_materialization и создаются заново (идемпотентность).
 * Значения бизнес-полей берутся из строк предпросмотра (пользователь мог править).
 */
@Service
public class MaterializationService {

    /** Планируемая вставка слоя B: таблица + значения колонок (редактируются в модалке). */
    public record PlannedRow(String table, Map<String, Object> values) {}

    public record PreviewResult(List<String> problems, List<PlannedRow> rows) {}

    public record CreatedRow(String table, long id) {}

    private static final String AUTO = "(auto)";

    /** Разрешённые целевые таблицы слоя B (защита materialize от произвольных таблиц). */
    private static final Set<String> LAYER_B_TABLES = Set.of(
            "tracker.d_comm_creation", "tracker.t_event_comm",
            "scheduler.t_get_event", "scheduler.t_launch_settings", "scheduler.t_execution_steps",
            "template.d_template_mapping", "template.d_template_mapping_mass",
            "commapi.d_definition_mapping");

    @PersistenceContext
    private EntityManager em;

    private final AdminLogService adminLog;
    private final ObjectMapper json;
    private final ru.banki.crm.service.JourneyService journeys;
    private final ru.banki.crm.service.UnifiedTemplateService unified;

    public MaterializationService(AdminLogService adminLog, ObjectMapper json,
                                  ru.banki.crm.service.JourneyService journeys,
                                  ru.banki.crm.service.UnifiedTemplateService unified) {
        this.adminLog = adminLog;
        this.json = json;
        this.journeys = journeys;
        this.unified = unified;
    }

    // -------------------------------------------------- разворачивание Subflow
    /** comm-ноды цепочки, включая развёрнутые вложенные (Subflow), рекурсивно. */
    private List<JourneyNode> expandedComms(JourneyDto j, List<String> problems) {
        List<JourneyNode> out = new ArrayList<>();
        java.util.Set<String> visited = new java.util.HashSet<>();
        if (!blank(j.id())) visited.add(j.id());
        collectComms(j.nodes(), out, visited, problems);
        return out;
    }

    private void collectComms(List<JourneyNode> nodes, List<JourneyNode> out,
                              java.util.Set<String> visited, List<String> problems) {
        if (nodes == null) return;
        for (JourneyNode n : nodes) {
            if ("comm".equals(n.type()) || n.type() == null) {
                out.add(n);
            } else if ("subflow".equals(n.type())) {
                String subId = prop(n, "journey");
                if (blank(subId)) {
                    if (problems != null) problems.add("У узла Subflow не выбрана вложенная цепочка");
                    continue;
                }
                // цикл или повторное включение той же цепочки — второй раз не разворачиваем
                if (!visited.add(subId)) continue;
                JourneyDto sub = null;
                try { sub = journeys.get(subId); } catch (Exception ignored) { }
                if (sub == null) {
                    if (problems != null) problems.add("Вложенная цепочка Subflow (" + subId + ") не найдена");
                    continue;
                }
                collectComms(sub.nodes(), out, visited, problems);
            }
        }
    }

    // ================================================================ VALIDATE
    public List<String> validate(JourneyDto j) {
        List<String> problems = new ArrayList<>();
        List<JourneyNode> starts = j.nodes().stream()
                .filter(n -> "startIncome".equals(n.type()) || "startTime".equals(n.type()))
                .toList();
        if (starts.isEmpty()) {
            // цепочку без старта сохранять можно (это subflow), но материализуется она только в составе родителя
            problems.add("Нет стартового узла (Income event или Time event). " +
                    "Цепочка без старта — вложенная (Subflow): сохранить её можно, " +
                    "а материализуется она в составе родительской цепочки");
        } else if (starts.size() > 1) {
            problems.add("Стартовый узел должен быть один, найдено: " + starts.size());
        } else {
            JourneyNode s = starts.get(0);
            String kind = "offline".equals(j.kind()) ? "offline" : "online";
            if ("online".equals(kind) && !"startIncome".equals(s.type())) {
                problems.add("Онлайн-цепочка должна начинаться с Income event");
            }
            if ("offline".equals(kind) && !"startTime".equals(s.type())) {
                problems.add("Оффлайн-цепочка должна начинаться с Time event");
            }
            if (blank(prop(s, "event_name"))) {
                problems.add("У стартового узла не заполнено имя события (event_name)");
            }
            if ("startTime".equals(s.type()) && sqlSteps(s).isEmpty()) {
                problems.add("У Time event не заполнен ни один SQL-шаг выборки");
            }
        }
        // comm-ноды с учётом вложенных цепочек (Subflow разворачивается в шаблоны родителя)
        List<JourneyNode> comms = expandedComms(j, problems);
        if (comms.isEmpty()) {
            problems.add("Нет ни одного узла Communication Alert — нечего материализовать");
        }
        for (JourneyNode c : comms) {
            if (blank(c.channel())) {
                problems.add("У Communication Alert «" + nz(c.title(), c.id()) + "» не выбран канал");
            } else if (blank(c.templateCode())) {
                problems.add("У Communication Alert (" + c.channel() + ") не указан код шаблона");
            } else if (!templateExists(c.channel(), c.templateCode())) {
                problems.add("Шаблон " + c.channel() + ":" + c.templateCode() +
                        " не найден — сначала заведи его в «Мастере коммуникаций»");
            }
        }
        return problems;
    }

    // ================================================================= PREVIEW
    public PreviewResult preview(JourneyDto j) {
        List<String> problems = validate(j);
        if (!problems.isEmpty()) {
            return new PreviewResult(problems, List.of());
        }
        JourneyNode start = startNode(j);
        List<JourneyNode> comms = expandedComms(j, null);
        boolean chain = comms.size() > 1;
        List<PlannedRow> rows = new ArrayList<>();

        if ("startIncome".equals(start.type())) {
            rows.add(row("tracker.d_comm_creation", m -> {
                m.put("allow_ml", boolProp(start, "allow_ml"));
                m.put("send_delay", intProp(start, "send_delay", 2));
                m.put("lifetime", intProp(start, "life_time", 1000));
                m.put("notify_channel", prop(start, "notify_channel"));
            }));
            rows.add(row("tracker.t_event_comm", m -> {
                m.put("event_name", prop(start, "event_name"));
                m.put("system", prop(start, "system"));
                m.put("id_comm_creation", AUTO);
                m.put("is_active", true);
                m.put("sub_channel", prop(start, "sub_channel"));
                m.put("platform", prop(start, "platform"));
                m.put("group_event_descr", prop(start, "group_event_descr"));
                m.put("is_chain", chain);
            }));
        } else { // startTime
            // selection == process_name (одно и то же имя процесса выборки)
            String selection = nz(prop(start, "process_name"), prop(start, "event_name"));
            rows.add(row("scheduler.t_get_event", m -> {
                m.put("selection", selection);
                m.put("event_name", prop(start, "event_name"));
                m.put("system", prop(start, "system"));
                m.put("send_delay", intProp(start, "send_delay", 2));
                m.put("is_deferred", false);
                m.put("source", resolveSource(j)); // source — из шаблона первой comm-ноды
                m.put("allow_ml", boolProp(start, "allow_ml"));
                m.put("notify_channel", prop(start, "notify_channel"));
                m.put("is_active", true);
                m.put("life_time", intProp(start, "life_time", 1000));
            }));
            rows.add(row("scheduler.t_launch_settings", m -> {
                m.put("selection", selection);
                m.put("time_start", "now()");
                m.put("crontab", prop(start, "crontab"));
                m.put("database", nz(prop(start, "database"), "crmdb"));
                m.put("description", j.name());
                m.put("is_active", true);
                m.put("status", "NEW");
                m.put("is_batch", true);
                m.put("max_retry_attempts", 1);
                m.put("job_group", "CRM");
            }));
            List<String> steps = sqlSteps(start);
            for (int i = 0; i < steps.size(); i++) {
                final int orderNum = i + 1;
                final String sqlText = steps.get(i);
                rows.add(row("scheduler.t_execution_steps", m -> {
                    m.put("t_launch_settings_id", AUTO);
                    m.put("process_name", selection);
                    m.put("order_num", orderNum);
                    m.put("is_active", true);
                    m.put("returns_result_set", true);
                    m.put("sql_text", sqlText);
                }));
            }
        }

        // Маппинг шаблонов: одиночный → d_template_mapping; цепочка → d_template_mapping_mass построчно
        if (!chain) {
            JourneyNode c = comms.get(0);
            rows.add(row("template.d_template_mapping", m -> {
                m.put("get_event_id", "startTime".equals(start.type()) ? AUTO : null);
                m.put("event_name", prop(start, "event_name"));
                m.put("system", prop(start, "system"));
                m.put("notify_channel", c.channel());
                m.put("template_id", parseIntOrNull(c.templateCode()));
            }));
        } else {
            comms.stream().sorted(Comparator.comparingInt(JourneyNode::day)).forEach(c ->
                    rows.add(row("template.d_template_mapping_mass", m -> {
                        m.put("event_id", "startTime".equals(start.type()) ? AUTO : null);
                        m.put("event_name", prop(start, "event_name"));
                        m.put("template_id", parseIntOrNull(c.templateCode()));
                        m.put("channel", c.channel());
                    })));
        }

        rows.add(row("commapi.d_definition_mapping", m -> {
            m.put("get_event_id", "startTime".equals(start.type()) ? AUTO : null);
            m.put("event_name", prop(start, "event_name"));
            m.put("system", prop(start, "system"));
            m.put("notify_channel", prop(start, "notify_channel"));
            m.put("definition_key", prop(start, "definition_key"));
            m.put("business_key_prefix", prop(start, "business_key_prefix"));
            m.put("is_correlation", false);
        }));

        return new PreviewResult(List.of(), rows);
    }

    // ============================================================= MATERIALIZE
    /** Слой A + слой B одной транзакцией. Возвращает созданные строки слоя B. */
    @Transactional
    public List<CreatedRow> materialize(JourneyDto j, List<PlannedRow> rows) {
        List<String> problems = validate(j);
        if (!problems.isEmpty()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, String.join("; ", problems));
        }
        for (PlannedRow r : rows) {
            if (!LAYER_B_TABLES.contains(r.table())) {
                throw new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.BAD_REQUEST, "Недопустимая таблица: " + r.table());
            }
        }

        // 0) повторная материализация: убираем прежние строки слоя B этой цепочки
        deletePreviousMaterialization(j.id());

        // 1) слой A: событие и его обвязка
        long eventId = upsertLayerA(j);

        // 2) слой B: вставки в правильном порядке с автоподстановкой FK
        Map<String, Long> autoIds = new LinkedHashMap<>(); // table -> созданный id
        List<CreatedRow> created = new ArrayList<>();
        for (PlannedRow r : orderForInsert(rows)) {
            Map<String, Object> values = new LinkedHashMap<>(r.values());
            resolveAuto(r.table(), values, autoIds);
            long id = insertReturningId(r.table(), values);
            autoIds.put(r.table(), id);
            created.add(new CreatedRow(r.table(), id));
            values.put("id", id);
            String rowJson = writeJson(values);
            adminLog.logTable(r.table(), "INSERT", rowJson);
            em.createNativeQuery("INSERT INTO flow.t_materialization" +
                            " (our_entity, our_id, prod_table, prod_id, materialized_by)" +
                            " VALUES ('app.journeys', :jid, :tbl, :pid, :usr)")
                    .setParameter("jid", j.id())
                    .setParameter("tbl", r.table())
                    .setParameter("pid", String.valueOf(id))
                    .setParameter("usr", CurrentUser.email())
                    .executeUpdate();
        }

        // 3) слой A: маппинги события (шаблоны цепочки), после того как известен eventId
        insertLayerAMappings(j, eventId);
        return created;
    }

    // ---------------------------------------------------------------- слой A
    private long upsertLayerA(JourneyDto j) {
        JourneyNode s = startNode(j);
        String kind = "startTime".equals(s.type()) ? "time" : "income";
        Object idObj = em.createNativeQuery(
                        "INSERT INTO flow.d_event (kind, event_name, system, source, group_event_descr, description, journey_id, is_active)" +
                        " VALUES (:k, :n, :sys, :src, :grp, :d, :jid, true)" +
                        " ON CONFLICT (event_name, system) DO UPDATE SET kind = EXCLUDED.kind," +
                        "   source = EXCLUDED.source, group_event_descr = EXCLUDED.group_event_descr," +
                        "   description = EXCLUDED.description, journey_id = EXCLUDED.journey_id," +
                        "   is_active = true, timestamp_upd = now()" +
                        " RETURNING id")
                .setParameter("k", kind)
                .setParameter("n", prop(s, "event_name"))
                .setParameter("sys", prop(s, "system"))
                .setParameter("src", resolveSource(j)) // source — из шаблона первой comm-ноды
                .setParameter("grp", prop(s, "group_event_descr"))
                .setParameter("d", j.name())
                .setParameter("jid", j.id())
                .getSingleResult();
        long eventId = ((Number) idObj).longValue();

        // обвязка события: пересоздаём (идемпотентно)
        em.createNativeQuery("DELETE FROM flow.d_event_delivery WHERE event_id = :e").setParameter("e", eventId).executeUpdate();
        em.createNativeQuery("DELETE FROM flow.d_event_schedule WHERE event_id = :e").setParameter("e", eventId).executeUpdate();
        em.createNativeQuery("DELETE FROM flow.d_event_step WHERE event_id = :e").setParameter("e", eventId).executeUpdate();
        em.createNativeQuery("DELETE FROM flow.d_event_template WHERE event_id = :e").setParameter("e", eventId).executeUpdate();
        em.createNativeQuery("DELETE FROM flow.d_event_definition WHERE event_id = :e").setParameter("e", eventId).executeUpdate();

        em.createNativeQuery("INSERT INTO flow.d_event_delivery" +
                        " (event_id, notify_channel, sub_channel, platform, send_delay, life_time, allow_ml)" +
                        " VALUES (:e, :nc, :sc, :pl, :sd, :lt, :ml)")
                .setParameter("e", eventId)
                .setParameter("nc", prop(s, "notify_channel"))
                .setParameter("sc", prop(s, "sub_channel"))
                .setParameter("pl", prop(s, "platform"))
                .setParameter("sd", intProp(s, "send_delay", 2))
                .setParameter("lt", intProp(s, "life_time", 1000))
                .setParameter("ml", boolProp(s, "allow_ml"))
                .executeUpdate();

        if ("time".equals(kind)) {
            em.createNativeQuery("INSERT INTO flow.d_event_schedule" +
                            " (event_id, crontab, database, is_batch)" +
                            " VALUES (:e, :c, :db, true)")
                    .setParameter("e", eventId)
                    .setParameter("c", prop(s, "crontab"))
                    .setParameter("db", nz(prop(s, "database"), "crmdb"))
                    .executeUpdate();
            String processName = nz(prop(s, "process_name"), prop(s, "event_name"));
            List<String> steps = sqlSteps(s);
            for (int i = 0; i < steps.size(); i++) {
                em.createNativeQuery("INSERT INTO flow.d_event_step" +
                                " (event_id, order_num, process_name, sql_text, returns_result_set)" +
                                " VALUES (:e, :on, :pn, :sql, true)")
                        .setParameter("e", eventId)
                        .setParameter("on", i + 1)
                        .setParameter("pn", processName)
                        .setParameter("sql", steps.get(i))
                        .executeUpdate();
            }
        }

        em.createNativeQuery("INSERT INTO flow.d_event_definition" +
                        " (event_id, notify_channel, definition_key, business_key_prefix)" +
                        " VALUES (:e, :nc, :dk, :bp)")
                .setParameter("e", eventId)
                .setParameter("nc", prop(s, "notify_channel"))
                .setParameter("dk", prop(s, "definition_key"))
                .setParameter("bp", prop(s, "business_key_prefix"))
                .executeUpdate();
        return eventId;
    }

    private void insertLayerAMappings(JourneyDto j, long eventId) {
        List<JourneyNode> comms = expandedComms(j, null);
        boolean chain = comms.size() > 1;
        int stepNo = 1;
        for (JourneyNode c : comms.stream().sorted(Comparator.comparingInt(JourneyNode::day)).toList()) {
            em.createNativeQuery("INSERT INTO flow.d_event_template (event_id, template_id, step_no)" +
                            " VALUES (:e, :t, :s)")
                    .setParameter("e", eventId)
                    .setParameter("t", resolveUnifiedTemplateId(c))
                    .setParameter("s", chain ? stepNo++ : null)
                    .executeUpdate();
        }
    }

    // ------------------------------------------------- канальные таблицы шаблонов
    /** (таблица, колонка бизнес-кода, есть ли столбцы night_send/source) по каналу. */
    private record ChannelTable(String table, String codeCol, boolean hasNight, boolean hasSource) {}

    private static ChannelTable channelTable(String channel) {
        return switch (channel == null ? "" : channel) {
            case "sms" -> new ChannelTable("notice.d_com_sms_template", "code", true, true);
            case "push" -> new ChannelTable("notice.push_template", "code", true, true);
            case "email" -> new ChannelTable("notice.email_template", "id", false, true);
            case "cc" -> new ChannelTable("callcenter.d_segment_properties", "segment", false, false);
            default -> null;
        };
    }

    /** Есть ли шаблон в канальном справочнике (гейт: без шаблона цепочку не материализовать). */
    private boolean templateExists(String channel, String code) {
        ChannelTable ct = channelTable(channel);
        Integer c = parseIntOrNull(code);
        if (ct == null || c == null) return false;
        Number cnt = (Number) em.createNativeQuery(
                        "SELECT count(*) FROM " + ct.table() + " WHERE " + ct.codeCol() + " = :c")
                .setParameter("c", c)
                .getSingleResult();
        return cnt.longValue() > 0;
    }

    /** source события подтягивается из шаблона ПЕРВОЙ comm-ноды (по дню шаблона), включая subflow. */
    private String resolveSource(JourneyDto j) {
        List<JourneyNode> comms = expandedComms(j, null).stream()
                .sorted(Comparator.comparingInt(JourneyNode::day)).toList();
        for (JourneyNode c : comms) {
            ChannelTable ct = channelTable(c.channel());
            Integer code = parseIntOrNull(c.templateCode());
            if (ct == null || code == null || !ct.hasSource()) continue;
            List<?> r = em.createNativeQuery(
                            "SELECT source FROM " + ct.table() + " WHERE " + ct.codeCol() + " = :c")
                    .setParameter("c", code)
                    .getResultList();
            if (!r.isEmpty() && r.get(0) != null && !String.valueOf(r.get(0)).isBlank()) {
                return String.valueOf(r.get(0));
            }
        }
        return null;
    }

    /**
     * id в едином справочнике template.d_template по (channel, code).
     * Если записи нет — синхронизируем её из канальной прод-таблицы (upsert:
     * ядро в типизированные колонки, канальные поля в channel_props jsonb).
     */
    private Long resolveUnifiedTemplateId(JourneyNode c) {
        Integer code = parseIntOrNull(c.templateCode());
        if (code == null || blank(c.channel())) return null;
        syncUnifiedTemplate(c.channel(), code);
        List<?> r = em.createNativeQuery("SELECT id FROM template.d_template WHERE channel = :ch AND code = :c")
                .setParameter("ch", c.channel())
                .setParameter("c", code)
                .getResultList();
        return r.isEmpty() ? null : ((Number) r.get(0)).longValue();
    }

    /** Свёртка строки канальной таблицы в единый справочник — общая логика в UnifiedTemplateService. */
    private void syncUnifiedTemplate(String channel, Integer code) {
        unified.upsertFromChannel(channel, code.longValue());
    }

    // ---------------------------------------------------------------- слой B
    private void deletePreviousMaterialization(String journeyId) {
        if (journeyId == null) return;
        List<?> prev = em.createNativeQuery(
                        "SELECT prod_table, prod_id FROM flow.t_materialization" +
                        " WHERE our_entity = 'app.journeys' AND our_id = :jid ORDER BY id DESC")
                .setParameter("jid", journeyId)
                .getResultList();
        for (Object o : prev) {
            Object[] r = (Object[]) o;
            String table = String.valueOf(r[0]);
            if (!LAYER_B_TABLES.contains(table)) continue;
            em.createNativeQuery("DELETE FROM " + table + " WHERE id = :id")
                    .setParameter("id", Long.valueOf(String.valueOf(r[1])))
                    .executeUpdate();
        }
        em.createNativeQuery("DELETE FROM flow.t_materialization" +
                        " WHERE our_entity = 'app.journeys' AND our_id = :jid")
                .setParameter("jid", journeyId)
                .executeUpdate();
    }

    /** Порядок вставки: родители до детей (FK). */
    private static List<PlannedRow> orderForInsert(List<PlannedRow> rows) {
        List<String> order = List.of(
                "tracker.d_comm_creation", "tracker.t_event_comm",
                "scheduler.t_get_event", "scheduler.t_launch_settings", "scheduler.t_execution_steps",
                "template.d_template_mapping", "template.d_template_mapping_mass",
                "commapi.d_definition_mapping");
        return rows.stream()
                .sorted(Comparator.comparingInt(r -> order.indexOf(r.table())))
                .toList();
    }

    /** "(auto)" → id уже вставленного родителя. */
    private static void resolveAuto(String table, Map<String, Object> values, Map<String, Long> autoIds) {
        values.replaceAll((col, v) -> {
            if (!AUTO.equals(v)) return v;
            return switch (col) {
                case "id_comm_creation" -> autoIds.get("tracker.d_comm_creation");
                case "t_launch_settings_id" -> autoIds.get("scheduler.t_launch_settings");
                case "get_event_id", "event_id" -> autoIds.get("scheduler.t_get_event");
                default -> null;
            };
        });
    }

    private long insertReturningId(String table, Map<String, Object> values) {
        Map<String, Object> cols = new LinkedHashMap<>();
        values.forEach((k, v) -> {
            if (!"id".equals(k) && v != null && !"".equals(v)) cols.put(k, v);
        });
        // имена колонок валидируем жёстко (значения — только параметрами)
        cols.keySet().forEach(c -> {
            if (!c.matches("[a-z_][a-z0-9_]*")) {
                throw new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.BAD_REQUEST, "Недопустимая колонка: " + c);
            }
        });
        String colList = String.join(", ", cols.keySet().stream().map(c -> "\"" + c + "\"").toList());
        StringBuilder params = new StringBuilder();
        List<String> keys = new ArrayList<>(cols.keySet());
        for (int i = 0; i < keys.size(); i++) {
            if (i > 0) params.append(", ");
            Object v = cols.get(keys.get(i));
            if ("time_start".equals(keys.get(i)) && "now()".equals(v)) {
                params.append("now()");           // спецзначение из предпросмотра
            } else {
                params.append(":p").append(i);
            }
        }
        var q = em.createNativeQuery(
                "INSERT INTO " + table + " (" + colList + ") VALUES (" + params + ") RETURNING id");
        for (int i = 0; i < keys.size(); i++) {
            Object v = cols.get(keys.get(i));
            if ("time_start".equals(keys.get(i)) && "now()".equals(v)) continue;
            if ("time_start".equals(keys.get(i)) && v instanceof String sv) {
                v = java.sql.Timestamp.valueOf(sv.replace("T", " ") + (sv.length() == 16 ? ":00" : ""));
            }
            q.setParameter("p" + i, v);
        }
        return ((Number) q.getSingleResult()).longValue();
    }

    // ------------------------------------------------------------------ utils
    private static JourneyNode startNode(JourneyDto j) {
        return j.nodes().stream()
                .filter(n -> "startIncome".equals(n.type()) || "startTime".equals(n.type()))
                .findFirst().orElseThrow();
    }

    private static PlannedRow row(String table, java.util.function.Consumer<Map<String, Object>> filler) {
        Map<String, Object> m = new LinkedHashMap<>();
        filler.accept(m);
        return new PlannedRow(table, m);
    }

    private static String prop(JourneyNode n, String key) {
        return n.props() == null ? null : n.props().get(key);
    }

    /** SQL-шаги Time event: props.sql_steps — JSON-массив строк; старые схемы — одиночный props.sql. */
    private List<String> sqlSteps(JourneyNode n) {
        List<String> out = new ArrayList<>();
        String raw = prop(n, "sql_steps");
        if (!blank(raw)) {
            try {
                for (Object o : json.readValue(raw, List.class)) {
                    String v = o == null ? null : String.valueOf(o);
                    if (!blank(v)) out.add(v);
                }
            } catch (Exception ignored) { /* битый JSON — считаем, что шагов нет */ }
        }
        if (out.isEmpty() && !blank(prop(n, "sql"))) out.add(prop(n, "sql"));
        return out;
    }

    private static boolean boolProp(JourneyNode n, String key) {
        return "true".equalsIgnoreCase(prop(n, key));
    }

    private static Integer intProp(JourneyNode n, String key, Integer def) {
        String v = prop(n, key);
        if (blank(v)) return def;
        try { return Integer.valueOf(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    private static Integer parseIntOrNull(String v) {
        if (blank(v)) return null;
        try { return Integer.valueOf(v.trim()); } catch (NumberFormatException e) { return null; }
    }

    private static boolean blank(String s) { return s == null || s.isBlank(); }

    private static String nz(String v, String def) { return blank(v) ? def : v; }

    private String writeJson(Map<String, Object> values) {
        try { return json.writeValueAsString(values); } catch (Exception e) { return "{}"; }
    }
}
