package ru.banki.crm.service.flow;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.dto.EventFormDtos.CreatedRow;
import ru.banki.crm.dto.EventFormDtos.EventCreated;
import ru.banki.crm.dto.EventFormDtos.OfflineEventForm;
import ru.banki.crm.dto.EventFormDtos.OnlineEventForm;
import ru.banki.crm.dto.EventFormDtos.StepForm;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Завод события формой — вторая дорога к тем же таблицам, что и материализация цепочки.
 * <p>
 * Пишем в два слоя одной транзакцией:
 * <ul>
 *   <li><b>слой A</b> ({@code flow.*}) — наша нормализованная модель: событие и его обвязка;</li>
 *   <li><b>слой B</b> ({@code tracker/scheduler/template/commapi}) — то, что читают боевые движки.</li>
 * </ul>
 * Каждая вставка слоя B журналируется в {@code flow.t_materialization} с
 * {@code our_entity = 'flow.d_event'} — в отличие от материализации цепочки, где источник
 * {@code app.journeys}. По этому же журналу видно, чем заведено событие.
 * <p>
 * Почему не переиспользован {@link MaterializationService}: он принимает цепочку и
 * разворачивает её узлы. Здесь цепочки нет — форма задаёт ровно одно событие и один
 * шаблон, и притворяться цепочкой ради общего кода означало бы собирать фиктивный
 * JourneyDto. Общими остаются таблицы и порядок вставок, а не код.
 */
@Service
public class EventFormService {

    /** notify_channel прода → канал единого справочника шаблонов. */
    private static final Map<String, String> CHANNEL_OF = Map.of(
            "SMS", "sms", "EMAIL", "email", "PUSH", "push",
            "CC", "cc", "FA", "fa", "VK", "vk");

    /** Шаг нумерации шагов выборки: в старой форме первый шаг получал 10, второй 20. */
    private static final int ORDER_STEP = 10;

    private final JdbcTemplate jdbc;
    private final AdminLogService adminLog;

    public EventFormService(JdbcTemplate jdbc, AdminLogService adminLog) {
        this.jdbc = jdbc;
        this.adminLog = adminLog;
    }

    // ============================================================== справочники

    /** Значения выпадающих списков формы. */
    @Transactional(readOnly = true)
    public Map<String, Object> dictionaries() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("notifyChannels", List.of("SMS", "EMAIL", "PUSH", "CC", "FA", "VK", "WA", "WEBPUSH", "ROBOT"));
        /* definition_key и business_key_prefix: известный список плюс всё, что уже
           встречается в проде — иначе форма не даст завести событие с ключом, который
           кто-то завёл руками мимо панели. */
        out.put("definitionKeys", merge(
                List.of("smsChannelProcessV2", "pushChannelProcessV2", "smsChannelProccessV2",
                        "emailChannelProcessV2", "vkChannelProcessV2", "waChannelProcessV2"),
                strings("SELECT DISTINCT definition_key FROM commapi.d_definition_mapping" +
                        " WHERE definition_key IS NOT NULL AND definition_key <> ''")));
        out.put("businessKeyPrefixes", merge(
                List.of("smsChannel", "emailChannel", "pushChannel", "webPushChannel",
                        "VkChannel", "WaChannel"),
                strings("SELECT DISTINCT business_key_prefix FROM commapi.d_definition_mapping" +
                        " WHERE business_key_prefix IS NOT NULL AND business_key_prefix <> ''")));
        /* Системы справочника не имеют — собираем те, что уже заведены. Поле остаётся
           редактируемым: первая система в новом контуре иначе была бы недоступна. */
        out.put("systems", strings(
                "SELECT DISTINCT system FROM flow.d_event WHERE system IS NOT NULL AND system <> ''" +
                " UNION SELECT DISTINCT system FROM scheduler.t_get_event WHERE system IS NOT NULL AND system <> ''" +
                " UNION SELECT DISTINCT system FROM tracker.t_event_comm WHERE system IS NOT NULL AND system <> ''" +
                " ORDER BY 1"));
        // базы — из справочника V33, а не из списка в коде: там же на них висит внешний ключ
        out.put("databases", strings("SELECT code FROM flow.d_database ORDER BY code"));
        out.put("variables", jdbc.queryForList(
                "SELECT id, name FROM template.d_variables ORDER BY lower(name)"));
        out.put("commCreations", jdbc.queryForList(
                "SELECT id, notify_channel, send_delay, lifetime, allow_ml" +
                " FROM tracker.d_comm_creation ORDER BY id DESC"));
        return out;
    }

    private List<String> strings(String sql) {
        return jdbc.queryForList(sql, String.class);
    }

    private static List<String> merge(List<String> known, List<String> fromDb) {
        List<String> out = new ArrayList<>(known);
        fromDb.stream().filter(v -> !out.contains(v)).forEach(out::add);
        return out;
    }

    // ================================================================== оффлайн

    /**
     * Событие по расписанию: t_get_event + t_launch_settings + N шагов, плюс маппинги
     * шаблона и метода отправки.
     */
    @Transactional
    public EventCreated createOffline(OfflineEventForm f) {
        List<StepForm> steps = f.steps() == null ? List.of() : f.steps();
        if (steps.isEmpty()) {
            throw bad("Не задан ни один SQL-шаг выборки");
        }
        for (int i = 0; i < steps.size(); i++) {
            if (nz(steps.get(i).sql()).isEmpty()) {
                throw bad("У шага " + (i + 1) + " не заполнен SQL");
            }
        }
        String eventName = req(f.eventName(), "имя события");
        String selection = req(f.selection(), "имя процесса (selection)");
        String system = nz(f.system());
        requireFreeName(eventName, system);

        List<String> warnings = new ArrayList<>();
        boolean active = bool(f.isActive(), false);
        boolean batch = bool(f.isBatch(), true);

        // ---- слой A
        long eventId = insertEvent("time", eventName, system, f.source(), active, selection);
        insertDelivery(eventId, f.notifyChannel());
        jdbc.update("INSERT INTO flow.d_event_schedule (event_id, crontab, database, is_batch)" +
                        " VALUES (?, ?, ?, ?)",
                eventId, nz(f.crontab()), f.database(), batch);
        for (int i = 0; i < steps.size(); i++) {
            StepForm s = steps.get(i);
            jdbc.update("INSERT INTO flow.d_event_step" +
                            " (event_id, order_num, process_name, sql_text, returns_result_set, is_active)" +
                            " VALUES (?, ?, ?, ?, ?, true)",
                    eventId, orderNum(s, i), selection, s.sql(), bool(s.returnsResultSet(), true));
        }
        Long localTemplateId = linkTemplate(eventId, f.notifyChannel(), f.templateId(), f.variableId(), warnings);

        insertDefinition(eventId, f.notifyChannel(), f.definitionKey(), f.businessKeyPrefix());

        // ---- слой B
        List<CreatedRow> rows = new ArrayList<>();
        long getEventId = insertB(rows, eventId, "scheduler.t_get_event", m -> {
            m.put("selection", selection);
            m.put("event_name", eventName);
            m.put("system", nn(system));
            m.put("source", nn(f.source()));
            m.put("notify_channel", f.notifyChannel());
            m.put("is_active", active);
            m.put("is_deferred", false);
            m.put("allow_ml", false);
        });
        long launchId = insertB(rows, eventId, "scheduler.t_launch_settings", m -> {
            m.put("selection", selection);
            m.put("time_start", timestamp(f.dateStart()));
            m.put("database", f.database());
            m.put("description", eventName);
            m.put("is_active", active);
            m.put("status", "NEW");
            m.put("is_batch", batch);
            m.put("max_retry_attempts", 1);
            m.put("crontab", nn(f.crontab()));
            m.put("job_group", "CRM");
        });
        for (int i = 0; i < steps.size(); i++) {
            StepForm s = steps.get(i);
            int order = orderNum(s, i);
            insertB(rows, eventId, "scheduler.t_execution_steps", m -> {
                m.put("t_launch_settings_id", launchId);
                m.put("process_name", selection);
                m.put("order_num", order);
                m.put("is_active", true);
                m.put("returns_result_set", bool(s.returnsResultSet(), true));
                m.put("sql_text", s.sql());
            });
        }
        insertTemplateMapping(rows, eventId, getEventId, eventName, system,
                f.notifyChannel(), f.templateId(), bool(f.isChain(), false));
        insertB(rows, eventId, "commapi.d_definition_mapping", m -> {
            m.put("get_event_id", getEventId);
            m.put("event_name", eventName);
            m.put("system", nn(system));
            m.put("notify_channel", f.notifyChannel());
            m.put("definition_key", nz(f.definitionKey()));
            m.put("business_key_prefix", nz(f.businessKeyPrefix()));
            m.put("is_correlation", false);
        });

        if (localTemplateId == null && f.templateId() != null) {
            warnings.add("Шаблон " + f.templateId() + " не найден в едином справочнике — " +
                    "в прод-таблицы код записан, но связи в слое A нет");
        }
        return new EventCreated(eventId, eventName, rows, warnings);
    }

    // =================================================================== онлайн

    /** Событие извне: t_event_comm поверх уже существующего d_comm_creation. */
    @Transactional
    public EventCreated createOnline(OnlineEventForm f) {
        String eventName = req(f.eventName(), "имя события");
        String system = nz(f.system());
        requireFreeName(eventName, system);
        requireCommCreation(f.idCommCreation());

        List<String> warnings = new ArrayList<>();
        boolean active = bool(f.isActive(), false);

        // ---- слой A
        long eventId = insertEvent("income", eventName, system, f.source(), active, null);
        insertDelivery(eventId, f.notifyChannel());
        Long localTemplateId = linkTemplate(eventId, f.notifyChannel(), f.templateId(), f.variableId(), warnings);
        insertDefinition(eventId, f.notifyChannel(), f.definitionKey(), f.businessKeyPrefix());

        // ---- слой B
        List<CreatedRow> rows = new ArrayList<>();
        insertB(rows, eventId, "tracker.t_event_comm", m -> {
            m.put("event_name", eventName);
            m.put("system", nn(system));
            m.put("id_comm_creation", f.idCommCreation());
            m.put("is_active", active);
            m.put("is_chain", false);
        });
        /* get_event_id у онлайн-события нет: он ссылается на scheduler.t_get_event,
           которого здесь не существует. Связь идёт парой event_name + system. */
        insertTemplateMapping(rows, eventId, null, eventName, system,
                f.notifyChannel(), f.templateId(), false);
        insertB(rows, eventId, "commapi.d_definition_mapping", m -> {
            m.put("event_name", eventName);
            m.put("system", nn(system));
            m.put("notify_channel", f.notifyChannel());
            m.put("definition_key", nz(f.definitionKey()));
            m.put("business_key_prefix", nz(f.businessKeyPrefix()));
            m.put("is_correlation", false);
        });

        if (localTemplateId == null && f.templateId() != null) {
            warnings.add("Шаблон " + f.templateId() + " не найден в едином справочнике — " +
                    "в прод-таблицы код записан, но связи в слое A нет");
        }
        return new EventCreated(eventId, eventName, rows, warnings);
    }

    // ============================================================ общие кусочки

    /**
     * У d_event стоит UNIQUE (event_name, system). Материализация цепочки на конфликт
     * делает UPDATE — там это осознанно, цепочку перематериализовывают. Форма заводит
     * НОВОЕ событие, и молча переписать чужое она не должна.
     */
    private void requireFreeName(String eventName, String system) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM flow.d_event WHERE event_name = ? AND coalesce(system,'') = ?",
                Integer.class, eventName, system);
        if (n != null && n > 0) {
            throw bad("Событие «" + eventName + "»" +
                    (system.isEmpty() ? "" : " в системе «" + system + "»") + " уже заведено");
        }
    }

    private void requireCommCreation(Long id) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM tracker.d_comm_creation WHERE id = ?", Integer.class, id);
        if (n == null || n == 0) {
            throw bad("Набор параметров доставки (id_comm_creation) " + id + " не найден");
        }
    }

    private long insertEvent(String kind, String eventName, String system, String source,
                             boolean active, String description) {
        Long id = jdbc.queryForObject(
                "INSERT INTO flow.d_event (kind, event_name, system, source, description, is_active)" +
                " VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
                Long.class, kind, eventName, system, nz(source), description, active);
        adminLog.logTable("flow.d_event", "INSERT", "{\"id\":" + id + ",\"event_name\":\"" + eventName + "\"}");
        return id;
    }

    private void insertDelivery(long eventId, String notifyChannel) {
        jdbc.update("INSERT INTO flow.d_event_delivery (event_id, notify_channel) VALUES (?, ?)",
                eventId, notifyChannel);
    }

    private void insertDefinition(long eventId, String notifyChannel, String definitionKey, String prefix) {
        jdbc.update("INSERT INTO flow.d_event_definition" +
                        " (event_id, notify_channel, definition_key, business_key_prefix)" +
                        " VALUES (?, ?, ?, ?)",
                eventId, notifyChannel, nz(definitionKey), nz(prefix));
    }

    /**
     * Связь события с шаблоном в слое A. В форме вводится ПРОДОВЫЙ код шаблона, а
     * d_event_template ссылается на суррогатный id единого справочника — это разные числа,
     * поэтому код сначала ищем по паре (канал, code).
     *
     * @return id шаблона в едином справочнике либо null, если такого шаблона у нас нет
     */
    private Long linkTemplate(long eventId, String notifyChannel, Long prodCode,
                              Integer variableId, List<String> warnings) {
        if (prodCode == null) {
            return null;
        }
        String channel = CHANNEL_OF.get(notifyChannel == null ? "" : notifyChannel.toUpperCase());
        Long localId = null;
        if (channel != null) {
            List<Long> found = jdbc.queryForList(
                    "SELECT id FROM template.d_template WHERE channel = ? AND code = ?",
                    Long.class, channel, prodCode);
            localId = found.isEmpty() ? null : found.get(0);
        } else {
            warnings.add("Каналу " + notifyChannel + " не соответствует ни один канал справочника" +
                    " шаблонов — связь события с шаблоном не записана");
        }
        jdbc.update("INSERT INTO flow.d_event_template (event_id, template_id) VALUES (?, ?)",
                eventId, localId);
        if (localId != null && variableId != null) {
            jdbc.update("INSERT INTO template.d_template_variable (template_id, variable_id)" +
                            " VALUES (?, ?) ON CONFLICT (template_id, variable_id) DO NOTHING",
                    localId, variableId);
        } else if (variableId != null) {
            warnings.add("Переменная не привязана: шаблон не найден в едином справочнике");
        }
        return localId;
    }

    /** Маппинг «событие → шаблон»: цепочка живёт в отдельной прод-таблице. */
    private void insertTemplateMapping(List<CreatedRow> rows, long eventId, Long getEventId,
                                       String eventName, String system, String notifyChannel,
                                       Long templateId, boolean chain) {
        if (chain) {
            insertB(rows, eventId, "template.d_template_mapping_mass", m -> {
                m.put("event_id", getEventId);
                m.put("event_name", eventName);
                m.put("template_id", templateId);
                m.put("channel", notifyChannel);
            });
        } else {
            insertB(rows, eventId, "template.d_template_mapping", m -> {
                m.put("get_event_id", getEventId);
                m.put("event_name", eventName);
                m.put("system", nn(system));
                m.put("notify_channel", notifyChannel);
                m.put("template_id", templateId);
            });
        }
    }

    /** Вставка строки слоя B + журнал действий + журнал соответствий слоёв. */
    private long insertB(List<CreatedRow> rows, long eventId, String table,
                         java.util.function.Consumer<Map<String, Object>> filler) {
        Map<String, Object> values = new LinkedHashMap<>();
        filler.accept(values);
        /* Убираем ТОЛЬКО null — колонку с ним просто не перечисляем, и она получит NULL
           или свой DEFAULT. Пустую строку не трогаем: definition_key и
           business_key_prefix объявлены NOT NULL без DEFAULT, и «выкинуть пустое»
           означало бы падение вставки на незаполненном поле формы. */
        values.values().removeIf(java.util.Objects::isNull);

        String cols = String.join(", ", values.keySet().stream().map(c -> "\"" + c + "\"").toList());
        String params = String.join(", ", values.keySet().stream().map(c -> "?").toList());
        Long id = jdbc.queryForObject(
                "INSERT INTO " + table + " (" + cols + ") VALUES (" + params + ") RETURNING id",
                Long.class, values.values().toArray());

        rows.add(new CreatedRow(table, id));
        adminLog.logTable(table, "INSERT", "{\"id\":" + id + "}");
        jdbc.update("INSERT INTO flow.t_materialization" +
                        " (our_entity, our_id, prod_table, prod_id, materialized_by)" +
                        " VALUES ('flow.d_event', ?, ?, ?, ?)",
                String.valueOf(eventId), table, String.valueOf(id), CurrentUser.email());
        return id;
    }

    // ------------------------------------------------------------------ утилиты

    private static int orderNum(StepForm s, int index) {
        return s.orderNum() != null && s.orderNum() > 0 ? s.orderNum() : (index + 1) * ORDER_STEP;
    }

    /** Пустая дата = «сейчас»: в старой форме поле было предзаполнено и недоступно для правки. */
    private static Timestamp timestamp(String raw) {
        String v = raw == null ? "" : raw.trim();
        if (v.isEmpty()) {
            return Timestamp.valueOf(LocalDateTime.now());
        }
        String s = v.replace('T', ' ');
        if (s.length() == 16) {
            s = s + ":00";
        }
        try {
            return Timestamp.valueOf(s);
        } catch (IllegalArgumentException e) {
            throw bad("Не разобрана дата запуска: " + raw);
        }
    }

    private static boolean bool(Boolean v, boolean def) {
        return v == null ? def : v;
    }

    private static String nz(String v) {
        return v == null ? "" : v.trim();
    }

    /**
     * Пустое значение → NULL. Нужно ТОЛЬКО для слоя B: там колонки необязательные, и в
     * проде на их месте лежит NULL, а не пустая строка. В слое A наоборот — там
     * system хранится пустой строкой, иначе UNIQUE (event_name, system) перестал бы
     * ловить дубли: два NULL в Postgres не равны друг другу.
     */
    private static String nn(String v) {
        String s = nz(v);
        return s.isEmpty() ? null : s;
    }

    private static String req(String v, String what) {
        String s = nz(v);
        if (s.isEmpty()) {
            throw bad("Не заполнено: " + what);
        }
        return s;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
