package ru.banki.crm.service.prod;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import ru.banki.crm.security.CurrentUser;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Очередь перелива событий в crmdb — то же, что {@link ProdSyncService} для шаблонов.
 * <p>
 * <b>Зачем.</b> Событие уезжало в прод одним способом: попыткой сразу после заведения
 * формой. Не вышло — crmdb недоступна, процесс остановлен, у человека нет права
 * ev-export — и повторять некому: фонового тика у экспорта не было, была только кнопка,
 * которую надо вспомнить нажать. Событие при этом выглядит заведённым.
 * <p>
 * <b>Как теперь.</b> Заведение ставит событие в очередь и тут же пробует доставить само —
 * чтобы форма показала продовые id сразу, а не через двадцать секунд. Получилось —
 * строка закрывается как OK. Нет — остаётся PENDING, и её подбирает тик.
 * <p>
 * <b>Чего здесь нет по сравнению с очередью шаблонов.</b> Состояния SENDING и хранения
 * payload. У шаблонов очередь помнит, ЧТО отправить: правку можно потерять, и повторная
 * доставка обязана послать ровно её. Здесь отправлять нечего — событие целиком лежит в
 * нашем слое B, перелив собирает пачку сам, а уже уехавшие строки пропускает по
 * flow.t_event_link. Поэтому повтор безопасен, а второй экземпляр приложения в худшем
 * случае сделает лишний холостой заход.
 */
@Service
public class EventExportQueueService {

    private static final Logger log = LoggerFactory.getLogger(EventExportQueueService.class);

    /** После скольких неудач перестаём пробовать и ждём человека. */
    private static final int MAX_ATTEMPTS = 10;

    private final JdbcTemplate jdbc;
    private final EventExportService export;
    private final EventDbService eventDb;
    private final ProcessControlService control;

    /** Сколько минут держать доставленные (OK) строки, потом удалять: очередь — не журнал. */
    @Value("${app.event-export.ok-ttl-minutes:60}")
    private int okTtlMinutes;

    @Value("${app.event-export.batch:5}")
    private int batch;

    public EventExportQueueService(JdbcTemplate jdbc, EventExportService export,
                                   EventDbService eventDb, ProcessControlService control) {
        this.jdbc = jdbc;
        this.export = export;
        this.eventDb = eventDb;
        this.control = control;
    }

    // ------------------------------------------------------------------ постановка

    /**
     * Поставить событие в очередь.
     * <p>
     * Повторная постановка того же события не плодит строк: одна строка на событие, и
     * при повторе счётчик попыток обнуляется — это новая просьба доставить, а не
     * продолжение прошлой. Уже закрытую строку (OK) не трогаем: событие уехало, и
     * возвращать его в очередь значило бы гонять перелив вхолостую.
     */
    public void enqueue(long eventId) {
        jdbc.update("INSERT INTO app.event_export_queue (event_id, created_by)"
                + " VALUES (?, ?)"
                + " ON CONFLICT (event_id) DO UPDATE SET"
                + "   status = CASE WHEN app.event_export_queue.status = 'OK' THEN 'OK' ELSE 'PENDING' END,"
                + "   attempts = CASE WHEN app.event_export_queue.status = 'OK' THEN app.event_export_queue.attempts ELSE 0 END,"
                + "   last_error = NULL, timestamp_upd = now()",
                eventId, CurrentUser.email());
    }

    /** Событие доставлено (например, синхронной попыткой сразу после заведения). */
    public void markDone(long eventId) {
        jdbc.update("UPDATE app.event_export_queue SET status = 'OK', last_error = NULL,"
                + " timestamp_upd = now() WHERE event_id = ?", eventId);
    }

    /** Доставить не вышло, но человек об этом уже знает — пишем причину и оставляем в очереди. */
    public void markFailed(long eventId, String reason) {
        jdbc.update("UPDATE app.event_export_queue SET status = 'PENDING', last_error = ?,"
                + " timestamp_upd = now() WHERE event_id = ? AND status <> 'OK'",
                cut(reason), eventId);
    }

    // ------------------------------------------------------------------ фон

    /**
     * Разбор очереди. Двадцать секунд — как у шаблонов: столько же ждёт человек,
     * заведший событие и увидевший «в прод не уехало».
     */
    @Scheduled(fixedDelayString = "${app.event-export.interval-ms:20000}",
               initialDelayString = "${app.event-export.initial-delay-ms:25000}")
    public void tick() {
        if (!eventDb.configured() || !control.canStart(ProcessControlService.EVENT_EXPORT)) {
            /* Остановлен в «Процессах переливов» — тик выходит, очередь копится дальше.
               Остановка перекрывает доставку, а не приём: иначе события терялись бы. */
            return;
        }
        try {
            process(batch);
        } catch (Exception e) {
            log.warn("event-export tick: {}", e.toString());
        }
    }

    /**
     * Забрать порцию и попробовать доставить.
     *
     * @return сколько событий уехало
     */
    public int process(int limit) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, event_id, attempts FROM app.event_export_queue"
                + " WHERE status = 'PENDING' AND attempts < ? ORDER BY id LIMIT ?",
                MAX_ATTEMPTS, limit);
        int done = 0;
        for (Map<String, Object> r : rows) {
            long id = num(r.get("id"));
            long eventId = num(r.get("event_id"));
            /* Счётчик увеличиваем ДО попытки: упади приложение посреди перелива, строка
               не останется вечно свежей и не будет пробоваться бесконечно. */
            jdbc.update("UPDATE app.event_export_queue SET attempts = attempts + 1,"
                    + " timestamp_upd = now() WHERE id = ?", id);
            try {
                Map<String, Object> res = export.export(eventId);
                jdbc.update("UPDATE app.event_export_queue SET status = 'OK', last_error = NULL,"
                        + " timestamp_upd = now() WHERE id = ?", id);
                done++;
                log.info("event-export: событие {} уехало, строк {}", eventId,
                        res.get("sent") instanceof List<?> l ? l.size() : "?");
            } catch (Exception e) {
                String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                /* Исчерпали попытки — переводим в ERROR: дальше решает человек кнопкой
                   «Повтор». Молча пробовать десятый раз подряд одну и ту же ошибку
                   бессмысленно, а тихо забыть — тем более. */
                jdbc.update("UPDATE app.event_export_queue SET"
                        + " status = CASE WHEN attempts >= ? THEN 'ERROR' ELSE 'PENDING' END,"
                        + " last_error = ?, timestamp_upd = now() WHERE id = ?",
                        MAX_ATTEMPTS, cut(msg), id);
                log.warn("event-export: событие {} не уехало ({} попытка): {}",
                        eventId, num(r.get("attempts")) + 1, msg);
            }
        }
        if (done > 0) {
            control.noteRun(ProcessControlService.EVENT_EXPORT, "очередь: доставлено " + done);
        }
        return done;
    }

    /** Уборка: доставленные держим недолго — очередь это список задач, а не журнал. */
    @Scheduled(fixedDelay = 600000, initialDelay = 120000)
    public void cleanup() {
        try {
            int n = jdbc.update("DELETE FROM app.event_export_queue WHERE status = 'OK'"
                    + " AND timestamp_upd < now() - make_interval(mins => ?)", okTtlMinutes);
            if (n > 0) {
                log.debug("event-export cleanup: удалено {} доставленных", n);
            }
        } catch (Exception e) {
            log.warn("event-export cleanup: {}", e.toString());
        }
    }

    // ------------------------------------------------------------------ экран

    /** Очередь для экрана «Перелив событий в прод»: строки плюс счётчики по статусам. */
    public Map<String, Object> board() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", jdbc.queryForList(
                "SELECT q.id, q.event_id AS \"eventId\", e.event_name AS \"eventName\","
                + " e.system, q.status, q.attempts, q.last_error AS \"lastError\","
                + " q.created_by AS \"createdBy\", q.timestamp_cr AS \"createdAt\","
                + " q.timestamp_upd AS \"updatedAt\""
                + " FROM app.event_export_queue q"
                + " LEFT JOIN flow.d_event e ON e.id = q.event_id"
                + " ORDER BY CASE q.status WHEN 'ERROR' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,"
                + "          q.id DESC LIMIT 200"));
        out.putAll(jdbc.queryForMap(
                "SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending,"
                + " count(*) FILTER (WHERE status = 'ERROR')   AS error,"
                + " count(*) FILTER (WHERE status = 'OK')      AS ok"
                + " FROM app.event_export_queue"));
        out.put("running", control.canStart(ProcessControlService.EVENT_EXPORT));
        out.put("configured", eventDb.configured());
        return out;
    }

    /** Повторить: сбрасываем счётчик, дальше подберёт тик. */
    public void retry(long id) {
        jdbc.update("UPDATE app.event_export_queue SET status = 'PENDING', attempts = 0,"
                + " last_error = NULL, timestamp_upd = now() WHERE id = ?", id);
    }

    /**
     * Убрать из очереди.
     * <p>
     * Именно убрать, а не «отменить перелив»: событие останется у нас незалитым, и это
     * осознанное решение человека. Вернуть его обратно можно кнопкой «Перелить» в
     * карточке — она ставит в очередь заново.
     */
    public void drop(long id) {
        jdbc.update("DELETE FROM app.event_export_queue WHERE id = ?", id);
    }

    private static long num(Object v) {
        return ((Number) v).longValue();
    }

    /** Текст чужой ошибки бывает на несколько экранов — в очереди держим начало. */
    private static String cut(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.length() > 2000 ? t.substring(0, 2000) + "…" : t;
    }
}
