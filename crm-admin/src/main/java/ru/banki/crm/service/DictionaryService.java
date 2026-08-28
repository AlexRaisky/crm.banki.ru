package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

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
     * Справочники, которыми можно управлять из настроек: код → таблица и колонка шаблона,
     * по которой считается использование значения.
     * <p>
     * Белый список, а не имя таблицы из запроса. Имя таблицы в SQL не подставляется
     * параметром — его пришлось бы склеивать строкой, и любой недосмотр в проверке
     * превратился бы в возможность прочитать чужую таблицу. Здесь же снаружи приходит
     * только ключ, а что за ним стоит, решает код.
     * <p>
     * Добавить третий справочник — одна строка: d_product_type устроен так же.
     */
    private static final Map<String, String[]> REFS = Map.of(
            "comm-names",   new String[]{"reference.d_communication_name", "communication_name"},
            "touch-points", new String[]{"reference.d_touch_point",        "touch_point"});

    /** Строка справочника как JSON — тем же способом, что и у партнёров. */
    private String rowJson(String table, String whereById) {
        return jdbc.queryForObject(
                "SELECT row_to_json(d)::text FROM " + table + " d WHERE d." + whereById, String.class);
    }

    private static String[] ref(String kind) {
        String[] r = REFS.get(kind);
        if (r == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Неизвестный справочник: " + kind);
        }
        return r;
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
        String[] r = ref(kind);
        return jdbc.queryForList(
                "SELECT d.id, d.value, d.sort_order AS \"sortOrder\", d.is_active AS \"isActive\","
                + " (SELECT count(*) FROM template.d_template t WHERE t." + r[1] + " = d.value) AS used"
                + " FROM " + r[0] + " d ORDER BY d.sort_order, d.value");
    }

    /**
     * Добавить значение. Порядок не задан — ставим в конец: числа у заведённых значений
     * смысловые (V10 раскладывал их десятками), и вклиниваться в середину без спроса
     * значило бы менять порядок чужого списка.
     */
    @Transactional
    public Map<String, Object> refAdd(String kind, String rawValue, Integer sortOrder) {
        String[] r = ref(kind);
        String value = rawValue == null ? "" : rawValue.trim();
        if (value.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Значение пустое");
        }
        if (value.length() > 255) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Значение длиннее 255 символов");
        }
        List<Map<String, Object>> same = jdbc.queryForList(
                "SELECT id, value, is_active FROM " + r[0] + " WHERE lower(value) = lower(?)", value);
        if (!same.isEmpty()) {
            /* UNIQUE в базе считает «Promo» и «promo» разными, а для списка это дубль.
               Говорим про существующее значение, а не заводим второе того же смысла. */
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Значение «" + same.get(0).get("value") + "» уже есть в справочнике"
                    + (Boolean.FALSE.equals(same.get(0).get("is_active")) ? " (выключено — включите его)" : ""));
        }
        int order = sortOrder != null ? sortOrder : jdbc.queryForObject(
                "SELECT coalesce(max(sort_order), 0) + 10 FROM " + r[0], Integer.class);
        jdbc.update("INSERT INTO " + r[0] + " (value, sort_order) VALUES (?, ?)", value, order);
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT id, value, sort_order AS \"sortOrder\", is_active AS \"isActive\", 0 AS used"
                + " FROM " + r[0] + " WHERE value = ?", value);
        /* Снимок строки в журнал — настоящим JSON: logTable кладёт текст в jsonb
           через CAST, и Map.toString() там развалился бы на вставке. */
        adminLog.logTable(r[0], "INSERT", rowJson(r[0], "id = " + row.get("id")));
        return row;
    }

    /** Включить или выключить значение: из выпадашек пропадает, у шаблонов остаётся. */
    @Transactional
    public Map<String, Object> refSetActive(String kind, long id, boolean active) {
        String[] r = ref(kind);
        int n = jdbc.update("UPDATE " + r[0] + " SET is_active = ?, timestamp_upd = now() WHERE id = ?",
                active, id);
        if (n == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Значение не найдено");
        }
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT id, value, sort_order AS \"sortOrder\", is_active AS \"isActive\" FROM " + r[0]
                + " WHERE id = ?", id);
        adminLog.logTable(r[0], "UPDATE", rowJson(r[0], "id = " + id));
        return row;
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
        String[] r = ref(kind);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT value, (SELECT count(*) FROM template.d_template t WHERE t." + r[1] + " = d.value) AS used"
                + " FROM " + r[0] + " d WHERE d.id = ?", id);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Значение не найдено");
        }
        long used = ((Number) rows.get(0).get("used")).longValue();
        if (used > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Значение «" + rows.get(0).get("value") + "» стоит у " + used
                    + " шаблон(ов). Удаление уберёт его из списка, но в шаблонах оно останется"
                    + " — выключите значение вместо удаления.");
        }
        /* Снимок берём ДО удаления: после него брать будет нечего. */
        adminLog.logTable(r[0], "DELETE", rowJson(r[0], "id = " + id));
        jdbc.update("DELETE FROM " + r[0] + " WHERE id = ?", id);
    }
}
