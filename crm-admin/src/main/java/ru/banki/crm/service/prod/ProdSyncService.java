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
 * <p>
 * Состояния: PENDING → SENDING (запись занята, отправляем) → OK (+prod_code);
 * неудача доставки возвращает в PENDING, после MAX_ATTEMPTS — ERROR (виден в UI,
 * ручной retry). При присвоении продом нового кода локальный код переписывается
 * (единый справочник и ХВОСТ очереди этого шаблона).
 * <p>
 * Два правила, ради которых всё и переделано — оба про то, чтобы в проде не появился
 * дубль:
 * <ol>
 *   <li>запись занимается ДО обращения к проду, поэтому её не подхватит ни следующий
 *       тик, ни второй экземпляр приложения;</li>
 *   <li>факт доставки записывается сразу и отдельно от всего остального. Раньше отметка
 *       «доставлено» лежала в одной транзакции с переименованием локального кода: оно
 *       падало на UNIQUE (channel, code), откат уносил и отметку, и запись уезжала в
 *       прод второй раз.</li>
 * </ol>
 * Из того же правила следует, что зависшие SENDING мы НЕ переотправляем сами: доехала
 * строка или нет — снаружи не различить, и решение остаётся за человеком.
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

    /** Через сколько минут считать зависшей запись, застрявшую в SENDING. */
    @Value("${app.prodsync.stuck-minutes:5}")
    private int stuckMinutes;

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

            /* Зависшие SENDING: приложение упало или потеряло связь между отправкой и
               отметкой. Что именно случилось — доехала строка или нет — отсюда не видно,
               поэтому НЕ переотправляем сами: автоматический повтор ровно в этом месте и
               плодит дубли. Переводим в ERROR, дальше решает человек кнопкой «Повтор». */
            int stuck = jdbc.update("UPDATE app.prod_sync SET status = 'ERROR'," +
                    " last_error = 'Доставка прервана: статус SENDING висел дольше " + stuckMinutes + " мин." +
                    " Проверьте в прод-БД, доехала ли строка, и повторите вручную.'," +
                    " timestamp_upd = now()" +
                    " WHERE status = 'SENDING' AND timestamp_upd < now() - make_interval(mins => ?)",
                    stuckMinutes);
            if (stuck > 0) log.warn("prod-sync: {} записей зависли в SENDING, переведены в ERROR", stuck);
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
            /* Занимаем запись ДО обращения к проду: пока она SENDING, её не подхватит
               ни следующий тик, ни второй экземпляр приложения. Условие status='PENDING'
               в самом UPDATE — это и есть захват: кто первым обновил, тот и владеет. */
            int claimed = jdbc.update(
                    "UPDATE app.prod_sync SET status = 'SENDING', attempts = attempts + 1," +
                    " timestamp_upd = now() WHERE id = ? AND status = 'PENDING'", id);
            if (claimed == 0) continue;

            long prodCode;
            try {
                prodCode = prod.apply(channel, operation, localCode, payload, createdBy);
            } catch (Exception ex) {
                String msg = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
                log.warn("prod-sync #{} {} {}/{} failed: {}", id, operation, channel, localCode, msg);
                jdbc.update("UPDATE app.prod_sync SET" +
                                " status = CASE WHEN attempts >= ? THEN 'ERROR' ELSE 'PENDING' END," +
                                " last_error = left(?, 2000), timestamp_upd = now() WHERE id = ?",
                        MAX_ATTEMPTS, msg, id);
                continue;
            }

            /* Доставка состоялась — записываем это НЕМЕДЛЕННО и отдельной транзакцией.
               Раньше отметка «доставлено» лежала в одной транзакции с переименованием
               локального кода: переименование падало на UNIQUE (channel, code), откат
               уносил и отметку, запись оставалась PENDING и через 20 секунд уезжала в
               прод второй раз. Так в проде появлялись два шаблона на одну заявку. */
            jdbc.update("UPDATE app.prod_sync SET status = 'OK', prod_code = ?," +
                            " last_error = NULL, timestamp_upd = now() WHERE id = ?",
                    prodCode, id);
            ok++;

            /* Локальная бухгалтерия — после и отдельно. Её падение больше не может
               привести к повторной отправке: доставка уже зафиксирована. */
            if ("INSERT".equals(operation) && prodCode != localCode) {
                try {
                    tx.executeWithoutResult(s -> unified.applyProdCode(channel, localCode, prodCode));
                } catch (Exception ex) {
                    String msg = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
                    log.warn("prod-sync #{}: доставлено (код прода {}), но локальный код {} не переименован: {}",
                            id, prodCode, localCode, msg);
                    /* пишем в ту же запись: она уже OK, но человек должен увидеть, что
                       локальный код разошёлся с продовым */
                    jdbc.update("UPDATE app.prod_sync SET last_error = left(?, 2000)," +
                                    " timestamp_upd = now() WHERE id = ?",
                            "Доставлено, но локальный код не переименован в " + prodCode + ": " + msg, id);
                }
            }
        }
        return ok;
    }

    /** Счётчики очереди для UI. */
    public Map<String, Object> stats() {
        return jdbc.queryForMap(
                "SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending," +
                "       count(*) FILTER (WHERE status = 'SENDING') AS sending," +
                "       count(*) FILTER (WHERE status = 'ERROR')   AS error," +
                "       count(*) FILTER (WHERE status = 'OK')      AS ok" +
                " FROM app.prod_sync");
    }
}
