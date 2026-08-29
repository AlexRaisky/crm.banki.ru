package ru.banki.crm.service.cron;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;

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

    /** Значения приоритета, которые принимает планировщик. */
    private static final List<String> PRIORITIES = List.of("LOW", "MEDIUM", "HIGH");

    private final JdbcTemplate jdbc;
    private final AdminLogService adminLog;

    public CronService(JdbcTemplate jdbc, AdminLogService adminLog) {
        this.jdbc = jdbc;
        this.adminLog = adminLog;
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
