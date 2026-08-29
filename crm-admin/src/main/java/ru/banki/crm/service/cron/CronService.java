package ru.banki.crm.service.cron;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Подключение к планировщику crm-cron.
 * <p>
 * Сейчас здесь только настройки и проверка связи — ни одного действия, меняющего
 * состояние заданий. Так и задумано: сначала убеждаемся, что панель вообще дотягивается
 * до сервиса и чем именно аутентифицируется, и только потом даём ей право что-то там
 * заводить. Обратный порядок означал бы отлаживать боевой Quartz.
 * <p>
 * <b>Зачем всё это.</b> События по расписанию исполняет Quartz, а знает он о них не по
 * строке в {@code scheduler.t_launch_settings}, а по контексту, который создаёт этот
 * сервис. Панель строку пишет, контекст не создаёт — и заведённое ею событие не
 * срабатывает никогда. Миграция V33 это предвидела: {@code flow.t_event_state.cron_state}
 * заведена ровно под расхождение «мы включили, а крон не знает».
 * <p>
 * <b>Выключатель.</b> Настройки лежат на всех трёх контурах, а боевой планировщик один.
 * Пока {@code enabled = false}, наружу не уходит ничего, кроме проверки связи, — и это
 * состояние по умолчанию.
 */
@Service
public class CronService {

    /* Значения приоритета из описания сервиса (/v3/api-docs, CrmCronCreateEventRequest.priority).
       Не «низкий/средний/высокий» по памяти: там NORMAL, а не MEDIUM, и подставленное
       наугад значение сервис не примет. */
    private static final List<String> PRIORITIES = List.of("LOW", "NORMAL", "HIGH");

    /** Базы, которые принимает планировщик (CrmCronCreateEventRequest.database). */
    private static final List<String> DATABASES = List.of("crmdb", "greenplum");

    private final JdbcTemplate jdbc;
    private final AdminLogService adminLog;
    private final ObjectMapper om;

    public CronService(JdbcTemplate jdbc, AdminLogService adminLog, ObjectMapper om) {
        this.jdbc = jdbc;
        this.adminLog = adminLog;
        this.om = om;
    }

    // ------------------------------------------------------------------- настройки

    /**
     * Настройки для экрана. Токен наружу не отдаётся — вместо него признак «задан».
     * Иначе право читать настройки становится правом забрать токен, а это разные вещи.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> settings() {
        Map<String, Object> r = row();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("baseUrl", str(r.get("base_url")));
        out.put("hasToken", !str(r.get("token")).isEmpty());
        out.put("enabled", Boolean.TRUE.equals(r.get("enabled")));
        out.put("jobGroup", str(r.get("job_group")));
        out.put("priority", str(r.get("priority")));
        out.put("probePath", str(r.get("probe_path")));
        out.put("priorities", PRIORITIES);
        out.put("lastStatus", r.get("last_status"));
        out.put("lastError", r.get("last_error"));
        out.put("lastCheckedAt", r.get("last_checked_at"));
        out.put("updatedBy", r.get("updated_by"));
        return out;
    }

    /**
     * Сохранить настройки.
     * <p>
     * Пустой токен в теле означает «не менять», а не «стереть»: экран его не показывает,
     * и сохранение адреса не должно молча обнулять то, чего человек не видел. Для
     * стирания есть отдельный признак {@code clearToken}.
     */
    @Transactional
    public Map<String, Object> save(Map<String, Object> body) {
        String baseUrl = str(body.get("baseUrl")).trim().replaceAll("/+$", "");
        if (!baseUrl.isEmpty() && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
            throw bad("Адрес должен начинаться с http:// или https://");
        }
        String priority = str(body.get("priority")).trim().toUpperCase();
        if (priority.isEmpty()) {
            priority = "LOW";
        }
        if (!PRIORITIES.contains(priority)) {
            throw bad("Приоритет может быть только " + String.join(", ", PRIORITIES));
        }
        String jobGroup = str(body.get("jobGroup")).trim();
        if (jobGroup.isEmpty()) {
            jobGroup = "CRM";
        }
        String probe = str(body.get("probePath")).trim();
        if (probe.isEmpty()) {
            probe = "/v3/api-docs";
        }
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        if (enabled && baseUrl.isEmpty()) {
            /* Включённая интеграция без адреса — это не «включено», это отложенная
               ошибка в момент первого заведения события. */
            throw bad("Нельзя включить интеграцию без адреса планировщика");
        }

        String token = str(body.get("token")).trim();
        boolean clear = Boolean.TRUE.equals(body.get("clearToken"));

        jdbc.update("UPDATE app.cron_connection SET base_url = ?, enabled = ?, job_group = ?,"
                        + " priority = ?, probe_path = ?, timestamp_upd = now(), updated_by = ?"
                        + " WHERE id = 1",
                baseUrl, enabled, jobGroup, priority, probe, CurrentUser.email());
        if (clear) {
            jdbc.update("UPDATE app.cron_connection SET token = NULL WHERE id = 1");
        } else if (!token.isEmpty()) {
            jdbc.update("UPDATE app.cron_connection SET token = ? WHERE id = 1", token);
        }
        /* В журнал — без токена: журнал читают шире, чем настройки. */
        adminLog.logTable("app.cron_connection", "UPDATE",
                jdbc.queryForObject("SELECT to_jsonb(c) - 'token' FROM app.cron_connection c"
                        + " WHERE c.id = 1", String.class));
        return settings();
    }

    // ------------------------------------------------------------------- связь

    /**
     * Проверка связи: один GET по заданному пути.
     * <p>
     * Путь настраиваемый, а не зашитый: какой адрес у сервиса безопасно дёргать «просто
     * посмотреть», знает тот, кто его настраивает, а не панель. По умолчанию — описание
     * OpenAPI, оно только читает.
     * <p>
     * Работает и при выключенной интеграции: проверка ничего не меняет, а запретить её
     * до включения значит требовать включить вслепую.
     */
    @Transactional
    public Map<String, Object> check() {
        Map<String, Object> r = row();
        String baseUrl = str(r.get("base_url"));
        if (baseUrl.isEmpty()) {
            throw bad("Адрес планировщика не задан");
        }
        CronClient.Reply reply = new CronClient(baseUrl, str(r.get("token")))
                .get(str(r.get("probe_path")));

        String status = reply.ok() ? "OK" : "ERROR";
        String error = reply.ok() ? null
                : (reply.status() == 0 ? reply.body() : "HTTP " + reply.status() + ": " + brief(reply.body()));
        jdbc.update("UPDATE app.cron_connection SET last_status = ?, last_error = ?,"
                + " last_checked_at = now() WHERE id = 1", status, error);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", reply.ok());
        out.put("status", reply.status());
        out.put("error", error);
        /* Кусочек ответа показываем и при успехе: по нему видно, что ответил именно
           планировщик, а не страница входа корпоративного прокси с кодом 200. */
        out.put("sample", brief(reply.body()));
        return out;
    }

    // ------------------------------------------------------------------- задания

    /**
     * Зарегистрировать событие в планировщике: {@code POST /api/v1/event}.
     * <p>
     * <b>Задание всегда создаётся остановленным</b>, каким бы активным ни было событие у
     * нас. Между «задание зарегистрировано» и «человек убедился, что оно правильное»
     * проходит время, а Quartz тикает по расписанию и ждать не станет. Запуск — отдельное
     * действие отдельной кнопкой, и это единственный момент, когда рассылка может уйти.
     * <p>
     * Повторную регистрацию не делаем: уже зарегистрированное событие получило бы второе
     * задание с тем же кронтабом, и рассылка ушла бы дважды. Нужно поменять расписание —
     * есть {@link #update(long)}.
     */
    @Transactional
    public Map<String, Object> register(long eventId) {
        Map<String, Object> conf = enabledRow();
        Long known = cronIdOrNull(eventId);
        if (known != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Событие уже зарегистрировано в планировщике под id " + known
                    + ". Второе задание с тем же кронтабом отправило бы рассылку дважды."
                    + " Чтобы поменять расписание, используйте «Обновить в планировщике».");
        }
        Map<String, Object> ev = eventRow(eventId);
        String json = createBody(conf, ev);

        CronClient.Reply reply = client(conf).createEvent(json);
        JsonNode dto = requireOk(reply, "создать задание");
        long cronId = dto.path("id").asLong(0);
        if (cronId <= 0) {
            /* Задание, скорее всего, создалось, но адресовать его нам нечем: без id
               нельзя ни остановить, ни обновить. Молчать об этом нельзя. */
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Планировщик ответил без id задания. Ответ: " + brief(reply.body())
                    + ". Задание могло быть создано — проверьте в планировщике, прежде чем"
                    + " повторять.");
        }
        jdbc.update("INSERT INTO flow.t_event_cron"
                + " (event_id, cron_event_id, last_status, last_action, last_actor)"
                + " VALUES (?, ?, ?, 'create', ?)",
                eventId, cronId, dto.path("cronStatus").asText(null), CurrentUser.email());
        adminLog.logTable("flow.t_event_cron", "INSERT",
                "{\"event_id\":" + eventId + ",\"cron_event_id\":" + cronId + "}");
        return done(eventId, "Задание " + cronId + " создано остановленным."
                + " Проверьте расписание и нажмите «Запустить».", dto);
    }

    /**
     * Обновить задание: {@code PATCH /api/v1/event/{id}}.
     * <p>
     * По описанию сервиса он деактивирует и пересоздаёт контекст, то есть на время правки
     * задание останавливается. Поэтому «сохранить расписание» и «обновить в планировщике»
     * — разные действия, и второе делают осознанно.
     */
    @Transactional
    public Map<String, Object> update(long eventId) {
        Map<String, Object> conf = enabledRow();
        long cronId = cronId(eventId);
        Map<String, Object> ev = eventRow(eventId);
        CronClient.Reply reply = client(conf).updateEvent(cronId, createBody(conf, ev));
        JsonNode dto = requireOk(reply, "обновить задание");
        note(eventId, dto.path("cronStatus").asText(null), null, "update");
        return done(eventId, "Задание " + cronId + " обновлено.", dto);
    }

    /** Остановить: {@code GET /api/v1/event/{id}/stop}. */
    @Transactional
    public Map<String, Object> stop(long eventId) {
        Map<String, Object> conf = enabledRow();
        long cronId = cronId(eventId);
        CronClient.Reply reply = client(conf).stopEvent(cronId);
        JsonNode dto = requireOk(reply, "остановить задание");
        note(eventId, status(dto, "STOPPED"), dto.path("errorMessage").asText(null), "stop");
        return done(eventId, "Задание " + cronId + " остановлено.", dto);
    }

    /** Запустить: {@code GET /api/v1/event/{id}/start}. Единственное место, откуда пойдёт рассылка. */
    @Transactional
    public Map<String, Object> start(long eventId) {
        Map<String, Object> conf = enabledRow();
        long cronId = cronId(eventId);
        CronClient.Reply reply = client(conf).startEvent(cronId);
        JsonNode dto = requireOk(reply, "запустить задание");
        note(eventId, status(dto, "STARTED"), dto.path("errorMessage").asText(null), "start");
        return done(eventId, "Задание " + cronId + " запущено.", dto);
    }

    /** Что панель знает про задание этого события. */
    @Transactional(readOnly = true)
    public Map<String, Object> state(long eventId) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM flow.t_event_cron WHERE event_id = ?", eventId);
        Map<String, Object> conf = row();
        out.put("enabled", Boolean.TRUE.equals(conf.get("enabled")));
        out.put("registered", !rows.isEmpty());
        if (!rows.isEmpty()) {
            Map<String, Object> r = rows.get(0);
            out.put("cronEventId", r.get("cron_event_id"));
            out.put("lastStatus", r.get("last_status"));
            out.put("lastError", r.get("last_error"));
            out.put("lastAction", r.get("last_action"));
            out.put("lastActor", r.get("last_actor"));
            out.put("syncedAt", r.get("synced_at"));
        }
        return out;
    }

    // ------------------------------------------------------------------- сборка запроса

    /**
     * Тело CrmCronCreateEventRequest по нашему событию.
     * <p>
     * Обязательные поля сервиса — selection, crontab, database, timeStart. Проверяем их
     * здесь, а не ждём отказа: сообщение «поле database обязательно» от чужого сервиса
     * человек прочитает как поломку панели.
     */
    private String createBody(Map<String, Object> conf, Map<String, Object> ev) {
        String selection = str(ev.get("selection"));
        String crontab = str(ev.get("crontab"));
        String database = str(ev.get("database"));
        if (selection.isEmpty()) {
            throw bad("У события пустое имя выборки (selection) — планировщику нечего запускать");
        }
        if (crontab.isEmpty()) {
            throw bad("У события не задан кронтаб");
        }
        if (!DATABASES.contains(database)) {
            /* Наш справочник flow.d_database шире, чем enum планировщика. */
            throw bad("Планировщик принимает только базы " + String.join(", ", DATABASES)
                    + ", а у события указана «" + database + "»");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("selection", selection);
        body.put("jobGroup", str(conf.get("job_group")));
        /* Время в UTC с Z — так объявлен формат date-time. У нас всё живёт в
           Europe/Moscow, и отправить локальное время значило бы промахнуться на три часа
           в первый же запуск. */
        body.put("timeStart", Instant.now().toString());
        body.put("database", database);
        /* Всегда false: задание создаётся остановленным, запускают его отдельно. */
        body.put("isActive", false);
        body.put("isBatch", Boolean.TRUE.equals(ev.get("is_batch")));
        body.put("maxRetryAttempts", 1);
        body.put("crontab", crontab);
        body.put("priority", str(conf.get("priority")));
        try {
            return om.writeValueAsString(body);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Не собрали запрос к планировщику: " + e);
        }
    }

    /**
     * Событие и его расписание одной строкой.
     * <p>
     * selection берём у шагов выборки: по этому имени планировщик их и находит
     * (scheduler.t_execution_steps.process_name). Своей колонки у события под него нет —
     * при заведении оно кладётся в description.
     */
    private Map<String, Object> eventRow(long eventId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT e.event_name, e.description, e.is_active,"
                + " s.crontab, s.database, s.is_batch,"
                + " (SELECT st.process_name FROM flow.d_event_step st WHERE st.event_id = e.id"
                + "   ORDER BY st.order_num LIMIT 1) AS step_name"
                + " FROM flow.d_event e"
                + " LEFT JOIN flow.d_event_schedule s ON s.event_id = e.id"
                + " WHERE e.id = ?", eventId);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "События " + eventId + " нет");
        }
        Map<String, Object> r = new LinkedHashMap<>(rows.get(0));
        r.put("selection", firstNotBlank(str(r.get("step_name")), str(r.get("description")),
                str(r.get("event_name"))));
        return r;
    }

    // ------------------------------------------------------------------- общее

    /** Настройки с проверкой выключателя: без него наружу не уходит ничего. */
    private Map<String, Object> enabledRow() {
        Map<String, Object> r = row();
        if (!Boolean.TRUE.equals(r.get("enabled"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Интеграция с планировщиком выключена. Включается в «Настройки» →"
                    + " «Планировщик (Quartz)» — и только на том контуре, где это осмысленно.");
        }
        if (str(r.get("base_url")).isEmpty()) {
            throw bad("Адрес планировщика не задан");
        }
        return r;
    }

    private CronClient client(Map<String, Object> conf) {
        return new CronClient(str(conf.get("base_url")), str(conf.get("token")));
    }

    private long cronId(long eventId) {
        Long id = cronIdOrNull(eventId);
        if (id == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Событие не зарегистрировано в планировщике — адресовать задание нечем."
                    + " Сначала «Зарегистрировать в планировщике».");
        }
        return id;
    }

    private Long cronIdOrNull(long eventId) {
        List<Long> ids = jdbc.queryForList(
                "SELECT cron_event_id FROM flow.t_event_cron WHERE event_id = ?", Long.class, eventId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /**
     * Ответ планировщика: разбираем или отказываем с его же словами.
     * <p>
     * Текст чужой ошибки показываем целиком. Своими словами его не пересказать, а
     * потерять — значит отправить человека угадывать.
     */
    private JsonNode requireOk(CronClient.Reply reply, String what) {
        if (!reply.ok()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Планировщик не смог " + what + ": "
                    + (reply.status() == 0 ? reply.body() : "HTTP " + reply.status() + " " + brief(reply.body())));
        }
        try {
            JsonNode n = om.readTree(reply.body() == null || reply.body().isBlank() ? "{}" : reply.body());
            /* Ответы обёрнуты по-разному: где-то объект целиком, где-то в result/data.
               Разворачиваем известные обёртки, не гадая дальше. */
            if (n.has("result") && n.get("result").isObject()) {
                return n.get("result");
            }
            if (n.has("data") && n.get("data").isObject()) {
                return n.get("data");
            }
            return n;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Планировщик ответил не JSON на «" + what + "»: " + brief(reply.body()));
        }
    }

    /** Статус из ответа; сервис может его не прислать — тогда берём ожидаемый. */
    private static String status(JsonNode dto, String fallback) {
        String s = dto.path("status").asText(null);
        return s == null || s.isBlank() ? fallback : s;
    }

    private void note(long eventId, String status, String error, String action) {
        jdbc.update("UPDATE flow.t_event_cron SET last_status = ?, last_error = ?,"
                + " last_action = ?, last_actor = ?, synced_at = now() WHERE event_id = ?",
                status, blank(error) ? null : error, action, CurrentUser.email(), eventId);
        /* Состояние крона зеркалим и в flow.t_event_state — экран событий читает его
           оттуда, и держать два источника правды об одном и том же незачем. */
        if (status != null && !status.isBlank()) {
            jdbc.update("INSERT INTO flow.t_event_state (event_id, cron_state, synced_at)"
                    + " VALUES (?, ?, now())"
                    + " ON CONFLICT (event_id) DO UPDATE SET cron_state = EXCLUDED.cron_state,"
                    + " synced_at = now()", eventId, status);
        }
    }

    private Map<String, Object> done(long eventId, String message, JsonNode dto) {
        Map<String, Object> out = new LinkedHashMap<>(state(eventId));
        out.put("ok", true);
        out.put("message", message);
        out.put("reply", dto == null ? null : dto.toString());
        return out;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank() || "null".equals(s);
    }

    private static String firstNotBlank(String... vals) {
        for (String v : vals) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return "";
    }

    // ------------------------------------------------------------------- мелочи

    private Map<String, Object> row() {
        List<Map<String, Object>> rows =
                jdbc.queryForList("SELECT * FROM app.cron_connection WHERE id = 1");
        if (rows.isEmpty()) {
            /* Строку заводит миграция. Пусто — значит её кто-то удалил руками; чинить
               молчаливой вставкой не будем, лучше сказать. */
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "В app.cron_connection нет строки с id = 1");
        }
        return rows.get(0);
    }

    private static String brief(String body) {
        String s = body == null ? "" : body.trim().replaceAll("\\s+", " ");
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
