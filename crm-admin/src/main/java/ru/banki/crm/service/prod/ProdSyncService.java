package ru.banki.crm.service.prod;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ru.banki.crm.service.UnifiedTemplateService;

import java.util.List;
import java.util.Map;

/**
 * Обработчик очереди app.prod_sync: доставляет операции мастера во внешнюю прод-БД.
 * PENDING → доставка → OK (+prod_code) | после MAX_ATTEMPTS неудач → ERROR (виден в UI,
 * ручной retry). При присвоении продом нового кода локальный код переписывается
 * (канальная строка, единый справочник и ХВОСТ очереди этого шаблона).
 */
@Service
public class ProdSyncService {

    private static final Logger log = LoggerFactory.getLogger(ProdSyncService.class);
    private static final int MAX_ATTEMPTS = 10;

    private final JdbcTemplate jdbc;
    private final ProdDbService prod;
    private final UnifiedTemplateService unified;
    private final TransactionTemplate tx;

    /** Сколько минут держать доставленные (OK) записи, потом удалять из очереди. */
    @Value("${app.prodsync.ok-ttl-minutes:10}")
    private int okTtlMinutes;

    public ProdSyncService(JdbcTemplate jdbc, ProdDbService prod,
                           UnifiedTemplateService unified, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.prod = prod;
        this.unified = unified;
        this.tx = tx;
    }

    /** Фоновая доставка каждые 20 секунд (только когда прод настроен). */
    @Scheduled(fixedDelay = 20000, initialDelay = 15000)
    public void tick() {
        if (!prod.configured()) return;
        try {
            process(50);
        } catch (Exception e) {
            log.warn("prod-sync tick failed: {}", e.getMessage());
        }
    }

    /**
     * Уборка очереди: доставленные (OK) записи держим коротко, потом удаляем — очередь
     * это список задач, а не журнал (аудит доставок лежит в log.t_admin_log / arch.t_admin_log).
     * ERROR и PENDING НЕ трогаем: ERROR убирается только вручную (кнопки «Повтор»/«Отмена»),
     * иначе несинхронизированное изменение потерялось бы без следа.
     */
    @Scheduled(fixedDelay = 60000, initialDelay = 30000)
    public void cleanup() {
        try {
            int ok = jdbc.update("DELETE FROM app.prod_sync WHERE status = 'OK'" +
                    " AND timestamp_upd < now() - make_interval(mins => ?)", okTtlMinutes);
            if (ok > 0) log.debug("prod-sync cleanup: удалено {} OK (> {} мин)", ok, okTtlMinutes);
        } catch (Exception e) {
            log.warn("prod-sync cleanup failed: {}", e.getMessage());
        }
    }

    /** Обработать до limit записей очереди. Возвращает число успешно доставленных. */
    public int process(int limit) {
        if (!prod.configured()) return 0;
        List<Map<String, Object>> entries = jdbc.queryForList(
                "SELECT id, channel, operation, local_code, payload::text AS payload, created_by" +
                " FROM app.prod_sync WHERE status = 'PENDING' AND attempts < ? ORDER BY id LIMIT ?",
                MAX_ATTEMPTS, limit);
        int ok = 0;
        for (Map<String, Object> e : entries) {
            long id = ((Number) e.get("id")).longValue();
            String channel = String.valueOf(e.get("channel"));
            String operation = String.valueOf(e.get("operation"));
            long localCode = ((Number) e.get("local_code")).longValue();
            String payload = String.valueOf(e.get("payload"));
            String createdBy = e.get("created_by") == null ? null : String.valueOf(e.get("created_by"));
            try {
                long prodCode = prod.apply(channel, operation, localCode, payload, createdBy);
                tx.executeWithoutResult(s -> {
                    jdbc.update("UPDATE app.prod_sync SET status = 'OK', prod_code = ?, attempts = attempts + 1," +
                                    " last_error = NULL, timestamp_upd = now() WHERE id = ?",
                            prodCode, id);
                    if ("INSERT".equals(operation) && prodCode != localCode) {
                        unified.applyProdCode(channel, localCode, prodCode);
                    }
                });
                ok++;
            } catch (Exception ex) {
                String msg = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
                log.warn("prod-sync #{} {} {}/{} failed: {}", id, operation, channel, localCode, msg);
                jdbc.update("UPDATE app.prod_sync SET attempts = attempts + 1," +
                                " status = CASE WHEN attempts + 1 >= ? THEN 'ERROR' ELSE 'PENDING' END," +
                                " last_error = left(?, 2000), timestamp_upd = now() WHERE id = ?",
                        MAX_ATTEMPTS, msg, id);
            }
        }
        return ok;
    }

    /** Счётчики очереди для UI. */
    public Map<String, Object> stats() {
        return jdbc.queryForMap(
                "SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending," +
                "       count(*) FILTER (WHERE status = 'ERROR')   AS error," +
                "       count(*) FILTER (WHERE status = 'OK')      AS ok" +
                " FROM app.prod_sync");
    }
}
