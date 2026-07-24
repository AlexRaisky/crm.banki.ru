package ru.banki.crm.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * Справочные значения для форм мастера (партнёры, сегменты КЦ, подсказки
 * communication_name). Источник — единый справочник template.d_template;
 * канальные таблицы не читаются.
 */
@Service
public class DictionaryService {

    private final JdbcTemplate jdbc;

    public DictionaryService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<String> partnerNames() {
        return jdbc.queryForList(
                "SELECT DISTINCT partner_name FROM template.d_template" +
                " WHERE partner_name IS NOT NULL AND partner_name <> '' ORDER BY 1",
                String.class);
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
}
