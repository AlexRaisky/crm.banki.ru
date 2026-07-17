package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ru.banki.crm.security.CurrentUser;

import java.util.List;

/**
 * Журнал действий админки над шаблонами → t_admin_log (структура как в проде:
 * table_name, operation, old_row jsonb, action_user, timestamp_cr).
 * Семантика old_row: для UPDATE/DELETE — строка ДО изменения; для INSERT —
 * созданная строка (иначе о заведении не остаётся данных).
 * Вызывается из {@link TemplateService} в той же транзакции, что и сама операция.
 */
@Service
public class AdminLogService {

    @PersistenceContext
    private EntityManager em;

    /** Физическое имя таблицы лога (в проде может отличаться — меняется env-переменной). */
    @Value("${app.tables.admin-log:arch.t_admin_log}")
    private String logTable;

    /** Физические имена таблиц шаблонов по каналам (совпадают с app.tables.*). */
    @Value("${app.tables.push:notice.push_template}")
    private String pushTable;
    @Value("${app.tables.email:notice.email_template}")
    private String emailTable;
    @Value("${app.tables.sms:notice.d_com_sms_template}")
    private String smsTable;
    @Value("${app.tables.cc:callcenter.d_segment_properties}")
    private String ccTable;

    public String tableFor(String channel) {
        return switch (channel == null ? "" : channel) {
            case "push" -> pushTable;
            case "email" -> emailTable;
            case "sms" -> smsTable;
            case "cc" -> ccTable;
            default -> channel;
        };
    }

    /** Строка таблицы как jsonb (точные имена колонок БД) — по суррогатному id. */
    public String rowJson(String channel, Object id) {
        em.flush(); // чтобы native-запрос видел только что сохранённую/изменённую строку
        List<?> r = em.createNativeQuery(
                        "SELECT to_jsonb(t)::text FROM " + tableFor(channel) + " t WHERE t.id = :id")
                .setParameter("id", id)
                .getResultList();
        return r.isEmpty() ? null : String.valueOf(r.get(0));
    }

    public void log(String channel, String operation, String rowJsonText) {
        logTable(tableFor(channel), operation, rowJsonText);
    }

    /** Запись в журнал по физическому имени таблицы (для материализации слоя B и пр.). */
    public void logTable(String physicalTable, String operation, String rowJsonText) {
        em.createNativeQuery(
                        "INSERT INTO " + logTable +
                        " (table_name, operation, old_row, action_user, timestamp_cr)" +
                        " VALUES (:t, :o, CAST(:r AS jsonb), :u, now())")
                .setParameter("t", physicalTable)
                .setParameter("o", operation)
                .setParameter("r", rowJsonText)
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
    }
}
