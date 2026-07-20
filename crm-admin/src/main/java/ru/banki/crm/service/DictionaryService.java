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

    /** Значения communication_name для подсказок редактируемого combobox. */
    @Transactional(readOnly = true)
    public List<String> communicationNames(String channel) {
        boolean all = channel == null || channel.isBlank();
        String sql = "SELECT DISTINCT communication_name FROM template.d_template" +
                " WHERE communication_name IS NOT NULL AND communication_name <> ''" +
                (all ? "" : " AND channel = ?") + " ORDER BY 1";
        return all ? jdbc.queryForList(sql, String.class)
                   : jdbc.queryForList(sql, String.class, channel);
    }
}
