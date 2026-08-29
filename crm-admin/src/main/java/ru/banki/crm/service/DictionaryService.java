package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Справочные значения для форм мастера (партнёры, сегменты КЦ, подсказки
 * communication_name). Источник — справочники схем {@code reference} (имена коммуникаций,
 * точки касания) и {@code dictionary} (партнёры, продукты) плюс единый справочник
 * template.d_template; канальные таблицы не читаются.
 */
@Service
public class DictionaryService {

    /** varchar(200) в dictionary.d_partner — режем на входе, чтобы не ловить ошибку БД. */
    private static final int PARTNER_NAME_MAX = 200;

    private final JdbcTemplate jdbc;
    private final AdminLogService adminLog;

    public DictionaryService(JdbcTemplate jdbc, AdminLogService adminLog) {
        this.jdbc = jdbc;
        this.adminLog = adminLog;
    }

    /**
     * Партнёры для выпадающего списка — ТОЛЬКО справочник dictionary.d_partner.
     * <p>
     * Раньше значения собирались как {@code DISTINCT partner_name} по заведённым шаблонам:
     * список наполнялся всем, что когда-либо ввели руками, включая опечатки. Как и с
     * communication_name, справочник на то и справочник — что в нём есть, то и предлагаем.
     * Вписать значение вне списка по-прежнему можно (поле редактируемое), а нужное —
     * добавить в справочник прямо из формы ({@link #addPartner(String)}).
     */
    @Transactional(readOnly = true)
    public List<String> partnerNames() {
        return jdbc.queryForList(
                "SELECT name FROM dictionary.d_partner ORDER BY lower(name)", String.class);
    }

    /**
     * Добавить партнёра в справочник из формы мастера.
     * <p>
     * Сравнение с существующими — регистронезависимое: UNIQUE(name) в БД считает «Sber» и
     * «sber» разными, а для списка это дубль. Если такой партнёр уже есть, возвращаем его
     * каноническое написание — форма подставит именно его.
     *
     * @return имя, которое следует подставить в поле
     */
    @Transactional
    public String addPartner(String rawName) {
        String name = rawName == null ? "" : rawName.trim();
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Название партнёра пустое");
        }
        if (name.length() > PARTNER_NAME_MAX) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Название партнёра длиннее " + PARTNER_NAME_MAX + " символов");
        }
        List<String> existing = jdbc.queryForList(
                "SELECT name FROM dictionary.d_partner WHERE lower(name) = lower(?)",
                String.class, name);
        if (!existing.isEmpty()) {
            return existing.get(0);
        }
        jdbc.update("INSERT INTO dictionary.d_partner (name) VALUES (?) ON CONFLICT (name) DO NOTHING", name);
        String row = jdbc.queryForObject(
                "SELECT row_to_json(p)::text FROM dictionary.d_partner p WHERE name = ?",
                String.class, name);
        adminLog.logTable("dictionary.d_partner", "INSERT", row);
        return name;
    }

    /** Сегменты КЦ: бизнес-код + описание. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> ccSegments() {
        return jdbc.queryForList(
                "SELECT code AS segment, communication_name," +
                " channel_props->>'segment_descr' AS segment_descr, active_flag" +
                " FROM template.d_template WHERE channel = 'cc' ORDER BY code");
    }

    /**
     * Значения communication_name для выпадающего списка — ТОЛЬКО справочник
     * reference.d_communication_name.
     * <p>
     * Раньше сюда подмешивались имена, уже встречающиеся в шаблонах канала. На тестовых
     * данных это было незаметно, а на реальных превратило список в свалку исторических
     * имён (warning-internet-block-unknown, with-question-a и подобное) — пользоваться
     * им стало нельзя. Справочник на то и справочник: что в нём есть, то и предлагаем.
     * <p>
     * Вписать значение вне списка по-прежнему можно — поле осталось редактируемым,
     * и у уже заведённых шаблонов их имена никуда не деваются.
     *
     * @param channel не влияет на результат; параметр сохранён ради совместимости
     *                с вызовами вида /api/dictionaries/comm-names?channel=push
     */
    @Transactional(readOnly = true)
    public List<String> communicationNames(String channel) {
        return jdbc.queryForList(
                "SELECT value FROM reference.d_communication_name WHERE is_active ORDER BY sort_order, value",
                String.class);
    }

    /** Точки касания (touch_point) из справочника. */
    @Transactional(readOnly = true)
    public List<String> touchPoints() {
        return jdbc.queryForList(
                "SELECT value FROM reference.d_touch_point WHERE is_active ORDER BY sort_order, value",
                String.class);
    }

    /**
     * Продукты (product_type) из справочника. Порядок задан sort_order — он смысловой
     * (сначала массовые продукты), поэтому по алфавиту не сортируем.
     */
    @Transactional(readOnly = true)
    public List<String> productTypes() {
        return jdbc.queryForList(
                "SELECT value FROM dictionary.d_product_type WHERE is_active ORDER BY sort_order, value",
                String.class);
    }

    // ------------------------------------------------------------------ ведение справочников
    /**
     * Колонка справочника: имя в БД, имя в JSON, подпись и что в неё можно класть.
     * <p>
     * Имена колонок в SQL параметром не подставляются — их приходится склеивать строкой.
     * Поэтому наружу они не выходят вовсе: снаружи приходит ключ справочника и имя поля
     * из этого описания, а что за ними стоит, решает код.
     */
    private record RefCol(String col, String name, String label, String type,
                          boolean required, List<String> options) {
        static RefCol text(String col, String name, String label, boolean required) {
            return new RefCol(col, name, label, "text", required, List.of());
        }
        static RefCol num(String col, String name, String label) {
            return new RefCol(col, name, label, "int", false, List.of());
        }
        static RefCol pick(String col, String name, String label, List<String> options) {
            return new RefCol(col, name, label, "select", true, options);
        }
    }

    /**
     * Справочник целиком.
     *
     * @param uniqueCols по каким колонкам значение считается дублем — не обязательно
     *                   совпадает с UNIQUE в БД: там «Promo» и «promo» разные, а для
     *                   списка это одно и то же
     * @param usageCol   колонка template.d_template, по которой считается использование;
     *                   null — использование не считается и удаление ничем не ограничено
     */
    private record RefTable(String kind, String title, String hint, String table,
                            List<RefCol> cols, List<String> uniqueCols, String usageCol) {}

    /**
     * Справочники, которыми можно управлять из настроек.
     * <p>
     * Добавить сюда таблицу — одна запись: панель строит и список, и форму по этому
     * описанию, отдельного экрана под каждый справочник не заводится.
     */
    private static final List<RefTable> REF_TABLES = List.of(
            new RefTable("comm-names", "Имена коммуникаций",
                    "communication_name — база имени коммуникации. Подставляется в мастере"
                    + " и входит в имя source.",
                    "reference.d_communication_name",
                    List.of(RefCol.text("value", "value", "Значение", true),
                            RefCol.num("sort_order", "sortOrder", "Порядок")),
                    List.of("value"), "communication_name"),

            new RefTable("touch-points", "Точки касания",
                    "touch_point — в какой момент пути человека уходит коммуникация.",
                    "reference.d_touch_point",
                    List.of(RefCol.text("value", "value", "Значение", true),
                            RefCol.num("sort_order", "sortOrder", "Порядок")),
                    List.of("value"), "touch_point"),

            new RefTable("channel-process", "Процессы каналов",
                    "Пары definition_key и business_key_prefix для формы события по расписанию."
                    + " Ключ и префикс лежат одной строкой: по отдельности они не значат ничего,"
                    + " а событие с чужим префиксом заводится без ошибки и молча ничего не"
                    + " отправляет. Канал в той же строке определяет, что вообще предлагается"
                    + " выбрать при этом методе.",
                    "reference.d_channel_process",
                    List.of(RefCol.pick("method", "method", "Метод", List.of("batch", "single")),
                            RefCol.text("notify_channel", "notifyChannel", "Канал", true),
                            RefCol.text("definition_key", "definitionKey", "definition_key", true),
                            RefCol.text("business_key_prefix", "businessKeyPrefix", "business_key_prefix", true),
                            RefCol.num("sort_order", "sortOrder", "Порядок")),
                    List.of("method", "definition_key"), null));

    private static RefTable ref(String kind) {
        for (RefTable r : REF_TABLES) {
            if (r.kind().equals(kind)) {
                return r;
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Неизвестный справочник: " + kind);
    }

    /** Строка справочника как JSON — logTable кладёт текст в jsonb, собирает его база. */
    private String rowJson(String table, long id) {
        return jdbc.queryForObject(
                "SELECT row_to_json(d)::text FROM " + table + " d WHERE d.id = ?", String.class, id);
    }

    /**
     * Список справочников для экрана выбора: что это, сколько значений и из чего состоит
     * строка. Экран настроек начинается со списка таблиц, а не с самих значений: справочники
     * устроены по-разному, и «имя коммуникации» с «парой ключ/префикс» на одной странице
     * читались бы как один список.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> refCatalog() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (RefTable r : REF_TABLES) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", r.kind());
            m.put("title", r.title());
            m.put("hint", r.hint());
            m.put("table", r.table());
            m.put("columns", columns(r));
            Integer total = jdbc.queryForObject("SELECT count(*) FROM " + r.table(), Integer.class);
            Integer off = jdbc.queryForObject(
                    "SELECT count(*) FROM " + r.table() + " WHERE NOT is_active", Integer.class);
            m.put("total", total == null ? 0 : total);
            m.put("inactive", off == null ? 0 : off);
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> columns(RefTable r) {
        List<Map<String, Object>> cols = new ArrayList<>();
        for (RefCol c : r.cols()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", c.name());
            m.put("label", c.label());
            m.put("type", c.type());
            m.put("required", c.required());
            m.put("options", c.options());
            cols.add(m);
        }
        return cols;
    }

    /**
     * Значения справочника целиком — включая выключенные, со счётчиком использования.
     * <p>
     * Выключенные тоже показываем: в выпадашках их нет, но в настройках человек должен
     * видеть, что значение существует, — иначе он заведёт его заново и упрётся в UNIQUE.
     * Счётчик нужен для решения «удалять или выключать»: связи по внешнему ключу тут нет,
     * и удаление из справочника значение из шаблонов не уберёт.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> refRows(String kind) {
        RefTable r = ref(kind);
        StringBuilder sql = new StringBuilder("SELECT d.id, d.is_active AS \"isActive\"");
        for (RefCol c : r.cols()) {
            sql.append(", d.").append(c.col()).append(" AS \"").append(c.name()).append('"');
        }
        if (r.usageCol() != null) {
            sql.append(", (SELECT count(*) FROM template.d_template t WHERE t.")
               .append(r.usageCol()).append(" = d.value) AS used");
        } else {
            sql.append(", 0 AS used");
        }
        sql.append(" FROM ").append(r.table()).append(" d ORDER BY d.sort_order, d.id");
        return jdbc.queryForList(sql.toString());
    }

    /**
     * Добавить строку. Порядок не задан — ставим в конец: числа у заведённых значений
     * смысловые (V10 раскладывал их десятками), и вклиниваться в середину без спроса
     * значило бы менять порядок чужого списка.
     */
    @Transactional
    public Map<String, Object> refAdd(String kind, Map<String, Object> body) {
        RefTable r = ref(kind);
        Map<String, Object> vals = values(r, body, true);
        if (!vals.containsKey("sort_order") || vals.get("sort_order") == null) {
            Integer next = jdbc.queryForObject(
                    "SELECT coalesce(max(sort_order), 0) + 10 FROM " + r.table(), Integer.class);
            vals.put("sort_order", next == null ? 10 : next);
        }
        requireFree(r, vals, null);

        List<String> cols = new ArrayList<>(vals.keySet());
        String names = String.join(", ", cols);
        String marks = String.join(", ", cols.stream().map(c -> "?").toList());
        Object[] args = cols.stream().map(vals::get).toArray();
        Long id = jdbc.queryForObject(
                "INSERT INTO " + r.table() + " (" + names + ") VALUES (" + marks + ") RETURNING id",
                Long.class, args);
        adminLog.logTable(r.table(), "INSERT", rowJson(r.table(), id));
        return one(r, id);
    }

    /**
     * Правка строки: любые колонки описания плюс переключатель активности.
     * <p>
     * Раньше здесь можно было только включить и выключить значение, а опечатку в нём
     * исправляли в psql. Для справочника из одного слова это ещё терпимо, для пары
     * ключ/префикс — нет: опечатку в ней приходится не выключать, а чинить.
     */
    @Transactional
    public Map<String, Object> refUpdate(String kind, long id, Map<String, Object> body) {
        RefTable r = ref(kind);
        Map<String, Object> vals = values(r, body, false);
        boolean touchActive = body != null && body.containsKey("isActive");
        if (vals.isEmpty() && !touchActive) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нечего менять");
        }
        requireFree(r, vals, id);

        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        for (Map.Entry<String, Object> e : vals.entrySet()) {
            sets.add(e.getKey() + " = ?");
            args.add(e.getValue());
        }
        if (touchActive) {
            sets.add("is_active = ?");
            args.add(!Boolean.FALSE.equals(body.get("isActive")));
        }
        sets.add("timestamp_upd = now()");
        args.add(id);
        int n = jdbc.update("UPDATE " + r.table() + " SET " + String.join(", ", sets) + " WHERE id = ?",
                args.toArray());
        if (n == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Значение не найдено");
        }
        adminLog.logTable(r.table(), "UPDATE", rowJson(r.table(), id));
        return one(r, id);
    }

    /**
     * Удалить значение — только если им не пользуется ни один шаблон.
     * <p>
     * Внешнего ключа между справочником и {@code template.d_template} нет: там обычная
     * строка. Поэтому удаление из справочника ничего не чинит и ничего не ломает — оно
     * лишь убирает объяснение тому, что стоит в шаблонах. Занятое значение выключают,
     * и об этом говорим прямо, а не отказом без причины.
     */
    @Transactional
    public void refDelete(String kind, long id) {
        RefTable r = ref(kind);
        List<Map<String, Object>> rows = refRows(kind).stream()
                .filter(m -> String.valueOf(m.get("id")).equals(String.valueOf(id))).toList();
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Значение не найдено");
        }
        long used = ((Number) rows.get(0).getOrDefault("used", 0)).longValue();
        if (used > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Значение «" + rows.get(0).get("value") + "» стоит у " + used
                    + " шаблон(ов). Удаление уберёт его из списка, но в шаблонах оно останется"
                    + " — выключите значение вместо удаления.");
        }
        /* Снимок берём ДО удаления: после него брать будет нечего. */
        adminLog.logTable(r.table(), "DELETE", rowJson(r.table(), id));
        jdbc.update("DELETE FROM " + r.table() + " WHERE id = ?", id);
    }

    // ---------------------------------------------------------------- разбор тела запроса

    /**
     * Значения из тела запроса — только известные колонки и только в своём типе.
     *
     * @param all требовать обязательные (заведение) или нет (правка отдельных полей)
     */
    private static Map<String, Object> values(RefTable r, Map<String, Object> body, boolean all) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (RefCol c : r.cols()) {
            boolean given = body != null && body.containsKey(c.name());
            if (!given) {
                if (all && c.required()) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Не заполнено поле «" + c.label() + "»");
                }
                continue;
            }
            Object raw = body.get(c.name());
            String s = raw == null ? "" : String.valueOf(raw).trim();
            if (s.isEmpty()) {
                if (c.required()) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Не заполнено поле «" + c.label() + "»");
                }
                continue;
            }
            if ("int".equals(c.type())) {
                try {
                    out.put(c.col(), Integer.valueOf(s));
                } catch (NumberFormatException e) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Поле «" + c.label() + "»: «" + s + "» — не число");
                }
                continue;
            }
            if ("select".equals(c.type()) && !c.options().contains(s)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Поле «" + c.label() + "»: допустимо только " + String.join(", ", c.options()));
            }
            if (s.length() > 255) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Поле «" + c.label() + "» длиннее 255 символов");
            }
            out.put(c.col(), s);
        }
        return out;
    }

    /**
     * Дубль? Сравнение регистронезависимое: UNIQUE в базе считает «Promo» и «promo»
     * разными, а для списка это одно значение.
     *
     * @param skipId правим существующую строку — саму себя дублем не считаем
     */
    private void requireFree(RefTable r, Map<String, Object> vals, Long skipId) {
        List<String> where = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        for (String col : r.uniqueCols()) {
            if (!vals.containsKey(col)) {
                return;             // ключ дубля собран не целиком — проверять нечего
            }
            where.add("lower(" + col + "::text) = lower(?)");
            args.add(String.valueOf(vals.get(col)));
        }
        if (where.isEmpty()) {
            return;
        }
        String sql = "SELECT count(*) FROM " + r.table() + " WHERE " + String.join(" AND ", where);
        if (skipId != null) {
            sql += " AND id <> ?";
            args.add(skipId);
        }
        Integer n = jdbc.queryForObject(sql, Integer.class, args.toArray());
        if (n != null && n > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Такое значение в справочнике уже есть"
                    + (r.uniqueCols().size() > 1 ? " (" + String.join(" + ", r.uniqueCols()) + ")" : ""));
        }
    }

    private Map<String, Object> one(RefTable r, long id) {
        for (Map<String, Object> m : refRows(r.kind())) {
            if (String.valueOf(m.get("id")).equals(String.valueOf(id))) {
                return m;
            }
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Значение не найдено");
    }
}
