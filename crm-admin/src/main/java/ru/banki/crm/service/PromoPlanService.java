package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.jira.JiraService;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Планирование промо — общая таблица app.promo_plan (раньше localStorage у каждого свой).
 *
 * Правки идут по одному полю (в разделе редактируется ячейка), поэтому конкурентность
 * решается оптимистической блокировкой: клиент присылает timestamp_upd строки, который
 * он видел; если в базе он уже другой — 409, и раздел перечитывает строку. Без этого
 * двое планировщиков молча затирали бы правки друг друга — баг, который замечают неделями.
 */
@Service
public class PromoPlanService {

    /** Поля строки, которые раздел имеет право менять (ключ v1 -> колонка). */
    private static final Map<String, String> COLUMNS = Map.ofEntries(
            Map.entry("d", "plan_date"),
            Map.entry("product", "product"),
            Map.entry("partner", "partner"),
            Map.entry("base", "base"),
            Map.entry("baseExtra", "base_extra"),
            Map.entry("chan", "channel"),
            Map.entry("total", "is_total"),
            Map.entry("uniq", "uniq_name"),
            Map.entry("task", "task_key"),
            Map.entry("owner", "owner_name"),
            Map.entry("status", "status"),
            Map.entry("customer", "customer"),
            Map.entry("link", "link"),
            Map.entry("content", "content"),
            Map.entry("title", "title"));
    /** note вынесен отдельно: Map.of ограничен 10 парами. */
    private static final String NOTE_COLUMN = "note";

    /**
     * Порядок колонок для {@link #toDto} — ОДИН на все выборки строк.
     * toDto читает Object[] по индексам, поэтому список колонок нельзя дублировать
     * в запросах: при добавлении communication_name одна из выборок осталась старой,
     * и правка любой ячейки падала с «Index 13 out of bounds for length 13».
     */
    private static final String ROW_COLUMNS =
            "id, plan_date, product, partner, base, channel, is_total," +
            " uniq_name, task_key, owner_name, status, note, communication_name, base_extra," +
            /* Новые колонки дописываются в КОНЕЦ, даже если по смыслу им место в середине:
               toDto читает Object[] по индексам, и вставка в середину молча сдвинула бы
               всё, что правее. */
            " customer, link, content, timestamp_upd, title";

    private static final String STATUS_PLANNED = "запланировано";
    private static final String STATUS_SENT = "отправлено";

    @PersistenceContext
    private EntityManager em;

    private final AdminLogService adminLog;
    private final JiraService jira;

    public PromoPlanService(AdminLogService adminLog, JiraService jira) {
        this.adminLog = adminLog;
        this.jira = jira;
    }

    // ------------------------------------------------------------------ задача в Jira

    /**
     * Завести задачу по строке плана и запомнить её ключ.
     * <p>
     * Строка плана и задача должны говорить об одном и том же, поэтому поля берём отсюда,
     * а не просим заполнить заново. Source приходит с клиента: его собирает Конструктор
     * source из канала, продукта, партнёра, уникального имени и даты — там же, где он
     * показан человеку, и второй раз ту же логику на сервере повторять незачем.
     * <p>
     * Вторую задачу на ту же строку не заводим: раз ключ уже стоит, значит задача есть, а
     * дубль в Jira потом никто не вычистит.
     */
    @Transactional
    public Map<String, Object> createJiraTask(long id, String source, String productCode) {
        Object[] r = rowById(id);
        String existing = str(r[8]);
        if (!existing.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "По этой строке уже заведена задача " + existing + ". Уберите ключ, если нужна новая.");
        }
        Map<String, Object> data = jiraData(r, source, productCode);

        Map<String, Object> res = jira.createIssue(data);
        String key = String.valueOf(res.get("key"));
        em.createNativeQuery("UPDATE app.promo_plan SET task_key = :k, timestamp_upd = now(),"
                        + " updated_by = :u WHERE id = :id")
                .setParameter("k", key)
                .setParameter("u", CurrentUser.email())
                .setParameter("id", id)
                .executeUpdate();
        writeLog(operationSnapshot(id), "JIRA");
        return res;
    }

    /**
     * Что уйдёт в Jira, без создания задачи.
     * <p>
     * Нужно окну подтверждения: человек видит заголовок и поля до того, как задача
     * появится в трекере. Собираем тем же кодом, что и заведение, — превью, посчитанное
     * отдельно, разошлось бы с настоящим запросом на первой же правке формулы.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> jiraPreview(long id, String source, String productCode) {
        Object[] r = rowById(id);
        Map<String, Object> data = jiraData(r, source, productCode);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("existingTask", str(r[8]));
        out.put("summary", jira.summaryFor(data));
        out.put("fields", data);
        return out;
    }

    /** Поля задачи из строки плана. Общее для предпросмотра и заведения. */
    private Map<String, Object> jiraData(Object[] r, String source, String productCode) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("channel", str(r[5]));
        data.put("customer", str(r[14]));
        /* В Jira тип продукта — код латиницей (General, Debitcards), в плане он записан
           по-русски. Код приходит с клиента из того же справочника, что и source; нет
           кода — отправим как есть и получим внятный отказ со списком допустимых. */
        data.put("product", firstNonEmpty(text(productCode), str(r[2])));
        /* «Вид рассылки» в Jira — Total или Mono, и это ровно наш флаг «тотал»: рассылка
           либо на всю базу, либо на сегмент. Отдельного поля в плане нет, поэтому берём
           флаг; не совпадёт со справочником Jira — придёт понятный отказ со списком. */
        data.put("kind", Boolean.TRUE.equals(r[6]) ? "Total" : "Mono");
        data.put("name", firstNonEmpty(str(r[12]), str(r[7])));   // название коммуникации, иначе уникальное имя
        data.put("sendDate", String.valueOf(r[1]));
        data.put("meaning", str(r[11]));                          // примечание строки = бизнес-смысл
        data.put("link", str(r[15]));
        data.put("content", str(r[16]));
        data.put("segment", firstNonEmpty(joinNonEmpty(str(r[4]), str(r[13])), ""));
        data.put("analyst", str(r[9]));
        data.put("source", text(source));
        /* Заголовок задачи. Написан человеком — уходит как есть; не написан — JiraService
           соберёт его из полей строки, как делал до появления этого поля. */
        data.put("summary", str(r[18]));
        data.put("reporterEmail", CurrentUser.email());
        return data;
    }

    private Object[] rowById(long id) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + ROW_COLUMNS + " FROM app.promo_plan WHERE id = :id")
                .setParameter("id", id)
                .getResultList();
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Строка плана не найдена");
        }
        return rows.get(0);
    }

    private static String firstNonEmpty(String a, String b) {
        return a == null || a.isBlank() ? (b == null ? "" : b) : a;
    }

    /** База и дополнительные условия к ней — в Jira это одно поле «Сегмент». */
    /**
     * Склейка базы и дополнительного условия в поле «Сегмент».
     * <p>
     * Через пробел, а не запятую: в Jira это одна фраза («вклады новые клиенты»), и
     * запятая читалась там как перечисление двух разных сегментов.
     */
    private static String joinNonEmpty(String a, String b) {
        if (a == null || a.isBlank()) return b == null ? "" : b;
        if (b == null || b.isBlank()) return a;
        return a + " " + b;
    }

    /**
     * Кого можно поставить ответственным: включённые пользователи панели плюс имена,
     * которые уже стоят в плане.
     * <p>
     * Вторая половина обязательна. План вели до появления учёток, и там стоят «Саша»,
     * «Таня», «Юля» — людей, которых в app.users под такими именами нет. Оставь список
     * только из таблицы — и у половины строк ответственный оказался бы вне списка:
     * при первой же правке соседней ячейки его молча подменило бы первым попавшимся.
     */
    @Transactional(readOnly = true)
    public List<String> ownerCandidates() {
        @SuppressWarnings("unchecked")
        List<String> out = em.createNativeQuery(
                        "SELECT name FROM (" +
                        "   SELECT DISTINCT trim(display_name) AS name FROM app.users" +
                        "    WHERE enabled AND coalesce(trim(display_name), '') <> ''" +
                        "   UNION" +
                        "   SELECT DISTINCT trim(owner_name) FROM app.promo_plan" +
                        "    WHERE coalesce(trim(owner_name), '') <> ''" +
                        " ) s ORDER BY name")
                .getResultList();
        return out;
    }

    /**
     * Кого можно поставить заказчиком: имена из справочников направлений — chain.chain и
     * gorizontal.gorizontal — плюс те, что уже проставлены в плане.
     * <p>
     * Таблиц может не быть: пока они заведены только на тестовом контуре. Существование
     * проверяем через to_regclass, а НЕ через try/catch вокруг запроса: в Postgres
     * упавший запрос помечает всю транзакцию на откат, и «мягкая» обработка ошибки
     * уронила бы весь вызов. Нет таблицы — просто нет её половины списка.
     * <p>
     * Имена из плана добавлены по той же причине, что и у ответственных: значение,
     * выбранное когда-то, не должно исчезнуть из списка из-за правки справочника.
     */
    @Transactional(readOnly = true)
    public List<String> customerCandidates() {
        List<String> parts = new ArrayList<>();
        for (String table : List.of("chain.chain", "gorizontal.gorizontal")) {
            Object reg = em.createNativeQuery("SELECT to_regclass(:t)")
                    .setParameter("t", table).getSingleResult();
            if (reg != null) {
                parts.add("SELECT DISTINCT trim(name) AS name FROM " + table);
            }
        }
        parts.add("SELECT DISTINCT trim(customer) AS name FROM app.promo_plan");
        @SuppressWarnings("unchecked")
        List<String> out = em.createNativeQuery(
                        "SELECT name FROM (" + String.join(" UNION ", parts) + ") s" +
                        " WHERE name IS NOT NULL AND name <> '' ORDER BY name")
                .getResultList();
        return out;
    }

    // ------------------------------------------------------------------ чтение
    /**
     * Весь план. Строк тут порядок сотен (план на месяцы вперёд плюс архив),
     * поэтому отдаём целиком: фильтры, вкладки и правила считаются на клиенте
     * по всему набору — постранично их не посчитать.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + ROW_COLUMNS + " FROM app.promo_plan ORDER BY plan_date, id")
                .getResultList();
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(toDto(r));
        }
        return out;
    }

    private static Map<String, Object> toDto(Object[] r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", ((Number) r[0]).longValue());
        m.put("d", String.valueOf(r[1]));                       // ISO yyyy-MM-dd
        m.put("product", str(r[2]));
        m.put("partner", str(r[3]));
        m.put("base", str(r[4]));
        // на клиенте канал — массив (исторически, из мультивыбора); у строки он всегда один
        m.put("chan", str(r[5]).isEmpty() ? List.of() : List.of(str(r[5])));
        m.put("total", Boolean.TRUE.equals(r[6]));
        m.put("uniq", str(r[7]));
        m.put("task", str(r[8]));
        m.put("owner", str(r[9]));
        m.put("status", str(r[10]));
        m.put("note", str(r[11]));
        m.put("commName", str(r[12]));   // сохранённое «Название коммуникации» (обычно из импорта)
        m.put("baseExtra", str(r[13]));  // доп. условия для базы, словами
        m.put("customer", str(r[14]));   // заказчик — он же обязательное поле задачи в Jira
        m.put("link", str(r[15]));       // основная ссылка, куда ведём получателя
        m.put("content", str(r[16]));    // что учесть в тексте или визуале
        m.put("ver", instant(r[17]));
        m.put("title", str(r[18]));      // название задачи словами — заголовок в Jira
        return m;
    }

    /**
     * Версия строки (timestamp_upd) в ISO-8601. Драйвер отдаёт timestamptz то как Instant,
     * то как Timestamp/OffsetDateTime — приводим единообразно, иначе клиент получал бы
     * разные форматы и сравнение версий ломалось бы.
     */
    private static String instant(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Timestamp ts) {
            return ts.toInstant().toString();
        }
        if (v instanceof java.time.Instant i) {
            return i.toString();
        }
        if (v instanceof java.time.OffsetDateTime odt) {
            return odt.toInstant().toString();
        }
        return String.valueOf(v);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    // ------------------------------------------------------------------ запись
    /**
     * Заведение записи. Каналов может быть несколько — создаём по строке на канал
     * (правило «одна запись = один канал»), возвращаем все созданные строки.
     */
    @Transactional
    public List<Map<String, Object>> create(Map<String, Object> body) {
        List<String> channels = channels(body.get("chan"));
        if (channels.isEmpty()) {
            channels = List.of("");     // канал можно не указывать — строка «требует заполнения»
        }
        LocalDate date = parseDate(body.get("d"));
        List<Long> ids = new ArrayList<>();
        for (String ch : channels) {
            // id берём из последовательности заранее: Hibernate считает нативный INSERT
            // изменяющим запросом и результат RETURNING отдать не даст
            long id = ((Number) em.createNativeQuery("SELECT nextval('app.promo_plan_id_seq')")
                    .getSingleResult()).longValue();
            em.createNativeQuery(
                            "INSERT INTO app.promo_plan (id, plan_date, product, partner, base, base_extra," +
                            " channel, is_total, uniq_name, task_key, owner_name, status, note," +
                            " customer, link, content, title, created_by, updated_by)" +
                            " VALUES (:id, :d, :product, :partner, :base, :baseExtra, :ch, :total, :uniq," +
                            " :task, :owner, :status, :note, :customer, :link, :content, :title, :u, :u)")
                    .setParameter("id", id)
                    .setParameter("d", date)
                    .setParameter("product", text(body.get("product")))
                    .setParameter("partner", text(body.get("partner")))
                    .setParameter("base", text(body.get("base")))
                    .setParameter("baseExtra", text(body.get("baseExtra")))
                    .setParameter("ch", ch)
                    .setParameter("total", bool(body.get("total")))
                    .setParameter("uniq", text(body.get("uniq")))
                    .setParameter("task", text(body.get("task")))
                    .setParameter("owner", text(body.get("owner")))
                    .setParameter("status", text(body.get("status")))
                    .setParameter("note", text(body.get("note")))
                    .setParameter("customer", text(body.get("customer")))
                    .setParameter("link", text(body.get("link")))
                    .setParameter("content", text(body.get("content")))
                    .setParameter("title", text(body.get("title")))
                    .setParameter("u", CurrentUser.email())
                    .executeUpdate();
            ids.add(id);
            writeLog(operationSnapshot(id), "INSERT");
        }
        return byIds(ids);
    }

    /**
     * Правка одного поля. body: {field, value, ver}. ver — timestamp_upd, который видел клиент.
     *
     * @return строка после правки
     */
    @Transactional
    public Map<String, Object> updateField(long id, Map<String, Object> body) {
        String field = text(body.get("field"));
        String column = NOTE_COLUMN.equals(field) ? NOTE_COLUMN : COLUMNS.get(field);
        if (column == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Поле нельзя менять: " + field);
        }
        Object value = body.get("value");
        // снимок ДО правки — как в остальном журнале админки; в лог пишем только
        // если правка прошла, иначе конфликт версий оставлял бы ложные записи
        String before = operationSnapshot(id);

        // Смена канала на несколько значений разворачивается в копии строки (как при заведении).
        if ("chan".equals(field)) {
            Map<String, Object> res = updateChannels(id, channels(value), body.get("ver"));
            writeLog(before, "UPDATE");
            return res;
        }

        String set = switch (column) {
            case "plan_date" -> "plan_date = CAST(:v AS date)";
            case "is_total" -> "is_total = CAST(:v AS boolean)";
            default -> column + " = :v";
        };
        Object param = switch (column) {
            case "plan_date" -> String.valueOf(parseDate(value));
            case "is_total" -> String.valueOf(bool(value));
            default -> text(value);
        };
        int n = em.createNativeQuery(
                        "UPDATE app.promo_plan SET " + set + ", timestamp_upd = now(), updated_by = :u" +
                        " WHERE id = :id AND (CAST(:ver AS timestamptz) IS NULL OR timestamp_upd = CAST(:ver AS timestamptz))")
                .setParameter("v", param)
                .setParameter("u", CurrentUser.email())
                .setParameter("id", id)
                .setParameter("ver", verParam(body.get("ver")))
                .executeUpdate();
        if (n == 0) {
            throw conflictOrGone(id);
        }
        writeLog(before, "UPDATE");
        return byId(id);
    }

    /** Смена набора каналов: текущая строка берёт первый, остальные уезжают в копии. */
    private Map<String, Object> updateChannels(long id, List<String> channels, Object ver) {
        String first = channels.isEmpty() ? "" : channels.get(0);
        int n = em.createNativeQuery(
                        "UPDATE app.promo_plan SET channel = :ch, timestamp_upd = now(), updated_by = :u" +
                        " WHERE id = :id AND (CAST(:ver AS timestamptz) IS NULL OR timestamp_upd = CAST(:ver AS timestamptz))")
                .setParameter("ch", first)
                .setParameter("u", CurrentUser.email())
                .setParameter("id", id)
                .setParameter("ver", verParam(ver))
                .executeUpdate();
        if (n == 0) {
            throw conflictOrGone(id);
        }
        for (String ch : channels.subList(Math.min(1, channels.size()), channels.size())) {
            em.createNativeQuery(
                            "INSERT INTO app.promo_plan (plan_date, product, partner, base, base_extra," +
                            " channel, is_total, uniq_name, task_key, owner_name, status, note," +
                            " communication_name, customer, link, content, title, created_by, updated_by)" +
                            /* task_key копируем намеренно: у копии свой канал, но задача пока
                               общая — до тех пор, пока для нового канала не заведут свою. */
                            " SELECT plan_date, product, partner, base, base_extra, :ch, is_total, uniq_name," +
                            " task_key, owner_name, status, note, communication_name, customer, link, content," +
                            " title, :u, :u" +
                            " FROM app.promo_plan WHERE id = :id")
                    .setParameter("ch", ch)
                    .setParameter("u", CurrentUser.email())
                    .setParameter("id", id)
                    .executeUpdate();
        }
        return byId(id);
    }

    @Transactional
    public void delete(long id) {
        String before = operationSnapshot(id);
        int n = em.createNativeQuery("DELETE FROM app.promo_plan WHERE id = :id")
                .setParameter("id", id)
                .executeUpdate();
        if (n > 0) {
            writeLog(before, "DELETE");
        }
    }

    /**
     * Прошедшие даты со статусом «запланировано» переводим в «отправлено».
     * Раньше это делал каждый клиент при открытии раздела и тут же сохранял —
     * на общей таблице это значило бы запись в базу с каждого открытия страницы.
     * Теперь один проход при чтении списка, и только если есть что менять.
     *
     * @return сколько строк перевели
     */
    @Transactional
    public int archiveSync() {
        return em.createNativeQuery(
                        "UPDATE app.promo_plan SET status = :sent, timestamp_upd = now()" +
                        " WHERE plan_date < CURRENT_DATE AND status = :planned")
                .setParameter("sent", STATUS_SENT)
                .setParameter("planned", STATUS_PLANNED)
                .executeUpdate();
    }

    // ------------------------------------------------------------------ helpers
    private Map<String, Object> byId(long id) {
        List<Map<String, Object>> rows = byIds(List.of(id));
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Строка не найдена");
        }
        return rows.get(0);
    }

    private List<Map<String, Object>> byIds(List<Long> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + ROW_COLUMNS + " FROM app.promo_plan WHERE id IN (:ids) ORDER BY plan_date, id")
                .setParameter("ids", ids)
                .getResultList();
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(toDto(r));
        }
        return out;
    }

    /** 0 обновлённых строк — либо версия разошлась (кто-то опередил), либо строки уже нет. */
    private ResponseStatusException conflictOrGone(long id) {
        Number cnt = (Number) em.createNativeQuery("SELECT count(*) FROM app.promo_plan WHERE id = :id")
                .setParameter("id", id)
                .getSingleResult();
        if (cnt.longValue() == 0) {
            return new ResponseStatusException(HttpStatus.NOT_FOUND, "Строку уже удалили");
        }
        return new ResponseStatusException(HttpStatus.CONFLICT, "Строку изменил другой пользователь");
    }

    /** null/пусто — правка без проверки версии (для случаев, когда клиент версии не знает). */
    private static String verParam(Object ver) {
        String s = text(ver);
        return s.isEmpty() ? null : s;
    }

    private static List<String> channels(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> list) {
            for (Object o : list) {
                String s = text(o);
                if (!s.isEmpty() && !out.contains(s)) {
                    out.add(s);
                }
            }
        } else {
            String s = text(v);
            if (!s.isEmpty()) {
                out.add(s);
            }
        }
        return out;
    }

    private static LocalDate parseDate(Object v) {
        String s = text(v);
        if (s.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Не указана дата");
        }
        try {
            return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректная дата: " + s);
        }
    }

    private static boolean bool(Object v) {
        return v instanceof Boolean b ? b : Set.of("true", "1", "on").contains(text(v).toLowerCase());
    }

    private static String text(Object v) {
        return v == null ? "" : String.valueOf(v).trim();
    }

    /** Снимок строки для журнала: для UPDATE/DELETE снимается ДО операции. */
    private String operationSnapshot(long id) {
        try {
            Object json = em.createNativeQuery(
                            "SELECT to_jsonb(t)::text FROM app.promo_plan t WHERE id = :id")
                    .setParameter("id", id)
                    .getResultList().stream().findFirst().orElse(null);
            return json == null ? "{}" : String.valueOf(json);
        } catch (Exception e) {
            return "{}";
        }
    }

    private void writeLog(String rowJson, String operation) {
        try {
            adminLog.logTable("app.promo_plan", operation, rowJson);
        } catch (Exception e) {
            // журнал не должен ронять саму операцию
        }
    }
}
