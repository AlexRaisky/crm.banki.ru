package ru.banki.crm.service.flow;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import ru.banki.crm.service.AdminLogService;
import ru.banki.crm.service.cron.CronService;

import java.util.ArrayList;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Правка заведённого события: шаги выборки и маппинг шаблонов.
 * <p>
 * До этого события можно было только завести. Добавить шаблон на двадцать девятый
 * день или поправить опечатку в SQL было нельзя — люди шли в psql, и панель переставала
 * знать, что на самом деле исполняется.
 * <p>
 * <b>Правка меняет НАШУ модель ({@code flow.*}), а не боевые таблицы.</b> У перелитого
 * события в crmdb лежит своя копия, и связь между ними записана в
 * {@code flow.t_event_link}. Дописывать прод отсюда мы намеренно не начинаем: перелив —
 * отдельное действие с отдельным правом (ev-export), и делать его побочным эффектом
 * сохранения формы значило бы менять боевую выборку нажатием «Сохранить». Вместо этого
 * возвращаем признак {@code exported}: панель показывает, что событие разошлось с продом.
 * <p>
 * Шаги и шаблоны переписываются целиком, а не построчно. Порядок шагов значим, и
 * «обновить третий» при удалённом втором — операция, у которой нет однозначного смысла.
 * Целиком — ровно то, что человек видит на экране.
 */
@Service
public class EventEditService {

    private static final int MAX_STEPS = 20;

    private final JdbcTemplate jdbc;
    private final AdminLogService adminLog;
    private final CronService cron;

    public EventEditService(JdbcTemplate jdbc, AdminLogService adminLog, CronService cron) {
        this.jdbc = jdbc;
        this.adminLog = adminLog;
        this.cron = cron;
    }

    /** Событие есть? */
    private Map<String, Object> event(long eventId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, event_name, kind, description FROM flow.d_event WHERE id = ?", eventId);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "События " + eventId + " нет");
        }
        return rows.get(0);
    }

    /** Перелито ли событие в crmdb — от этого зависит предупреждение о расхождении. */
    private boolean exported(long eventId) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM flow.t_event_link WHERE event_id = ? AND direction <> 'IMPORT'",
                Integer.class, eventId);
        return n != null && n > 0;
    }

    /**
     * Правка отдельных полей события — из карточки, по одному полю за раз.
     * <p>
     * Меняем только нашу модель ({@code flow.*}). В боевые таблицы это само не уедет:
     * там уже лежит копия, сделанная переливом, и трогать её отсюда нельзя — рассылка
     * читает её прямо сейчас. Поэтому в ответе возвращаем признак {@code exported}:
     * карточка по нему говорит, что правку нужно довезти переливом или обновлением
     * задания планировщика.
     * <p>
     * Список полей закрытый. Имени события в нём нет намеренно: оно же {@code selection},
     * по нему в проде связаны три таблицы, и переименование здесь означало бы тихий
     * разрыв этой связи. Имя меняют заведением нового события.
     *
     * @param field поле из {@link #EDITABLE}
     * @param value новое значение; для флагов — {@code true}/{@code false}
     */
    @Transactional
    public Map<String, Object> updateField(long eventId, String field, Object value) {
        Map<String, Object> ev = event(eventId);
        Editable col = EDITABLE.get(field);
        if (col == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Поле «" + field + "» в карточке не правится. Доступны: "
                    + String.join(", ", EDITABLE.keySet()));
        }
        Object val = col.parse(value);
        if (col.schedule()) {
            /* Расписание живёт отдельной строкой, и у онлайн-события её нет вовсе:
               предлагать там кронтаб было бы обещанием, которого мы не сдержим. */
            Integer has = jdbc.queryForObject(
                    "SELECT count(*) FROM flow.d_event_schedule WHERE event_id = ?",
                    Integer.class, eventId);
            if (has == null || has == 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "У этого события нет расписания: поле «" + field + "» к нему не относится");
            }
            jdbc.update("UPDATE flow.d_event_schedule SET " + col.column() + " = ?"
                    + " WHERE event_id = ?", val, eventId);
        } else {
            jdbc.update("UPDATE flow.d_event SET " + col.column() + " = ? WHERE id = ?", val, eventId);
        }
        adminLog.logTable(col.schedule() ? "flow.d_event_schedule" : "flow.d_event", "UPDATE",
                "{\"event_id\":" + eventId + ",\"field\":\"" + field + "\"}");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "ok");
        out.put("field", field);
        out.put("value", val);
        out.put("exported", exported(eventId));
        out.put("eventName", ev.get("event_name"));
        out.putAll(pushToScheduler(eventId, field));
        return out;
    }

    /**
     * Довезти правку до планировщика: {@code PATCH /api/v1/event/{id}} с ЕГО id задания.
     * <p>
     * Расписание исполняет не наша строка, а задание Quartz, и правка кронтаба или
     * активности, оставшаяся только у нас, не меняет ровно ничего: событие продолжает
     * ходить по-старому, а панель показывает новое. Поэтому поля, из которых собран
     * запрос к планировщику, после сохранения отправляются ему же.
     * <p>
     * Не падаем вместе с ним: наша правка уже сохранена и откату не подлежит — чужой
     * сервис может быть выключен, недоступен или не знать про это событие. Тогда
     * возвращаем предупреждение, в котором сказано, что делать: обновить задание руками
     * кнопкой в карточке.
     *
     * @return {@code cron} — что вышло; пусто, если задания нет и обновлять нечего
     */
    private Map<String, Object> pushToScheduler(long eventId, String field) {
        if (!CRON_FIELDS.contains(field)) {
            return Map.of();
        }
        Long cronId = cron.registeredId(eventId);
        if (cronId == null) {
            /* Задания нет — событие в планировщике не заведено, и обновлять нечего.
               Это не ошибка: онлайн-события заданий не имеют вовсе. */
            return Map.of();
        }
        try {
            cron.update(eventId);
            return Map.of("cron", "Задание " + cronId + " обновлено в планировщике");
        } catch (RuntimeException e) {
            String why = e instanceof ResponseStatusException rse && rse.getReason() != null
                    ? rse.getReason() : String.valueOf(e.getMessage());
            return Map.of("cronWarning",
                    "Сохранено у нас, но задание " + cronId + " в планировщике не обновилось: "
                    + why + ". Обновите его кнопкой в блоке «Планировщик».");
        }
    }

    /**
     * Поля, из которых собран запрос к планировщику.
     * <p>
     * Ровно те, что уходят в теле {@code PATCH /api/v1/event/{id}}: расписание, база
     * выборки, метод отправки и активность. Остальное (source, описание, система) на
     * задание не влияет, и дёргать ради него чужой сервис незачем.
     */
    private static final Set<String> CRON_FIELDS =
            Set.of("crontab", "database", "is_batch", "is_active");

    /** Поле карточки: куда пишем и как приводим значение. */
    private record Editable(String column, boolean schedule, String type) {
        Object parse(Object v) {
            String s = v == null ? "" : String.valueOf(v).trim();
            return switch (type) {
                case "bool" -> Boolean.parseBoolean(s) || "on".equalsIgnoreCase(s);
                /* Пустая строка и null — разные вещи только для NOT NULL-колонок; здесь
                   их нет, поэтому пустое значение чистит поле, а не пишет пустую строку. */
                default -> s.isEmpty() ? null : s;
            };
        }
    }

    /**
     * Что можно править в карточке.
     * <p>
     * Ровно то, что относится к нашей модели и не ломает связей: пометки, флаг
     * активности и параметры расписания. Канал, ключи определения и шаблоны правятся
     * своими ручками — у них другая цена ошибки.
     */
    private static final Map<String, Editable> EDITABLE = Map.of(
            "source",      new Editable("source", false, "text"),
            "description", new Editable("description", false, "text"),
            "system",      new Editable("system", false, "text"),
            "is_active",   new Editable("is_active", false, "bool"),
            "crontab",     new Editable("crontab", true, "text"),
            "database",    new Editable("database", true, "text"),
            "is_batch",    new Editable("is_batch", true, "bool"));

    /**
     * Переписать шаги выборки.
     *
     * @param steps по порядку: {@code sql}, {@code active}, {@code returnsResultSet}
     */
    @Transactional
    public Map<String, Object> updateSteps(long eventId, List<Map<String, Object>> steps) {
        Map<String, Object> ev = event(eventId);
        if (steps == null || steps.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ни одного шага не задано");
        }
        if (steps.size() > MAX_STEPS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Шагов больше " + MAX_STEPS + " — столько движок не исполняет");
        }
        for (int i = 0; i < steps.size(); i++) {
            if (str(steps.get(i).get("sql")).isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Шаг " + (i + 1) + " пустой. Пустой шаг не «ничего не делает», он ломает нумерацию"
                        + " остальных — выключите его вместо очистки.");
            }
        }

        /* Имя процесса выборки берём у самих шагов, а не из формы: правка шагов не
           должна переименовывать процесс — по этому имени движок их и находит
           (scheduler.t_execution_steps.process_name). Своей колонки у события под него
           нет: при заведении оно кладётся в description. */
        String selection = firstNotBlank(
                jdbc.query("SELECT process_name FROM flow.d_event_step WHERE event_id = ?"
                           + " ORDER BY order_num LIMIT 1",
                        (rs, i) -> rs.getString(1), eventId).stream().findFirst().orElse(null),
                str(ev.get("description")), str(ev.get("event_name")));
        String before = jsonSteps(eventId);
        jdbc.update("DELETE FROM flow.d_event_step WHERE event_id = ?", eventId);
        for (int i = 0; i < steps.size(); i++) {
            Map<String, Object> s = steps.get(i);
            /* «Возвращает результат» — только у последнего шага: промежуточные готовят
               выборку, а отдаёт её движку последний. Не доверяем галке из формы: там её
               могли проставить всем, и тогда движок получил бы выборку трижды. */
            boolean returns = i == steps.size() - 1;
            jdbc.update("INSERT INTO flow.d_event_step" +
                    " (event_id, order_num, process_name, sql_text, returns_result_set, is_active)" +
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    eventId, i + 1, selection, str(s.get("sql")), returns,
                    !Boolean.FALSE.equals(s.get("active")));
        }
        adminLog.logTable("flow.d_event_step", "UPDATE", before);
        return result(eventId, "Шагов сохранено: " + steps.size());
    }

    /**
     * Переписать маппинг шаблонов.
     *
     * @param items {@code channel} + {@code code} шаблона и необязательный {@code stepNo}
     *              (день или позиция в цепочке; пусто — одиночный шаблон)
     */
    @Transactional
    public Map<String, Object> updateTemplates(long eventId, List<Map<String, Object>> items) {
        event(eventId);
        List<Object[]> resolved = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (Map<String, Object> it : items == null ? List.<Map<String, Object>>of() : items) {
            String channel = str(it.get("channel")).trim().toLowerCase();
            String code = str(it.get("code")).trim();
            if (channel.isEmpty() || code.isEmpty()) {
                continue;   // пустая строка формы — просто не сохраняем
            }
            List<Long> found = jdbc.queryForList(
                    "SELECT id FROM template.d_template WHERE channel = ? AND code = ?",
                    Long.class, channel, code);
            if (found.isEmpty()) {
                /* Молча записать null значило бы получить в карточке «шаблон не найден»
                   без объяснения. Лучше отказать целиком и назвать, чего нет. */
                missing.add(channel + ":" + code);
                continue;
            }
            resolved.add(new Object[]{found.get(0), intOrNull(it.get("stepNo"))});
        }
        if (!missing.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Нет таких шаблонов в справочнике: " + String.join(", ", missing)
                    + ". Заведите их в «Мастере коммуникаций» или поправьте код.");
        }

        String before = jsonTemplates(eventId);
        jdbc.update("DELETE FROM flow.d_event_template WHERE event_id = ?", eventId);
        for (Object[] r : resolved) {
            jdbc.update("INSERT INTO flow.d_event_template (event_id, template_id, step_no)" +
                    " VALUES (?, ?, ?)", eventId, r[0], r[1]);
        }
        adminLog.logTable("flow.d_event_template", "UPDATE", before);
        return result(eventId, "Шаблонов сохранено: " + resolved.size());
    }

    /** Ответ формы: что сохранено и разошлось ли событие с продом. */
    private Map<String, Object> result(long eventId, String message) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("message", message);
        boolean exported = exported(eventId);
        out.put("exported", exported);
        if (exported) {
            out.put("warning", "Событие уже перелито в crmdb. Здесь изменена наша модель —"
                    + " в боевых таблицах осталось прежнее. Чтобы правка доехала, событие нужно"
                    + " перелить заново («Настройки» → «Перелив событий в прод»).");
        }
        return out;
    }

    /* Снимок до правки — в журнал. logTable кладёт текст в jsonb, поэтому JSON собирает
       сама база: склеивать его строками в Java значит однажды не экранировать кавычку
       в SQL-тексте шага и уронить запись журнала. */
    private String jsonSteps(long eventId) {
        return jdbc.queryForObject(
                "SELECT coalesce(json_agg(s ORDER BY s.order_num)::text, '[]')"
                + " FROM flow.d_event_step s WHERE s.event_id = ?", String.class, eventId);
    }

    private String jsonTemplates(long eventId) {
        return jdbc.queryForObject(
                "SELECT coalesce(json_agg(t ORDER BY t.id)::text, '[]')"
                + " FROM flow.d_event_template t WHERE t.event_id = ?", String.class, eventId);
    }

    private static String firstNotBlank(String... vals) {
        for (String v : vals) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return "";
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private static Integer intOrNull(Object v) {
        String s = str(v).trim();
        if (s.isEmpty()) {
            return null;
        }
        try {
            return Integer.valueOf(s);
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Шаг/день «" + s + "» — не число");
        }
    }
}
