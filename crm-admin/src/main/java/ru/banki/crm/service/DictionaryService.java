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
 * communication_name). Источник — справочники схемы {@code dictionary} и единый
 * справочник template.d_template; канальные таблицы не читаются.
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
     * dictionary.d_communication_name.
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
                "SELECT value FROM dictionary.d_communication_name WHERE is_active ORDER BY sort_order, value",
                String.class);
    }

    /** Точки касания (touch_point) из справочника. */
    @Transactional(readOnly = true)
    public List<String> touchPoints() {
        return jdbc.queryForList(
                "SELECT value FROM dictionary.d_touch_point WHERE is_active ORDER BY sort_order, value",
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
}
