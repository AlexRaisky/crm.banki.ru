package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.security.CurrentUser;

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

    /**
     * Запись в журнал по физическому имени таблицы (снимок строки готовит вызывающий).
     * <p>
     * {@code @Transactional} обязателен: пишем через EntityManager, а он на
     * {@code executeUpdate()} без активной транзакции бросает
     * «Executing an update/delete query». Раньше это сходило с рук, потому что все
     * вызывающие были транзакционными сами. Импорт событий из crmdb транзакцию снял
     * намеренно (в Postgres первая же ошибка делает её нерабочей, а импорт обязан
     * продолжаться) — и упёрся сюда в самом конце, уже затянув данные.
     * <p>
     * Распространение по умолчанию (REQUIRED), а не REQUIRES_NEW: у вызывающего с
     * транзакцией ничего не меняется — запись журнала откатывается вместе с операцией,
     * как и должно быть. Своя транзакция открывается только там, где её нет.
     */
    @Transactional
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
