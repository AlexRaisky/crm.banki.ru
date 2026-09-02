package ru.banki.crm.service.prod;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ru.banki.crm.service.TemplateStore;
import ru.banki.crm.service.UnifiedTemplateService;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * ETL «прод → мы»: поддерживает нашу копию template.d_template в соответствии с прод-таблицами
 * (notice.* и callcenter для КЦ). Прод — источник истины, пишем только к себе.
 *
 * Два режима:
 *  - ИНКРЕМЕНТ (каждые 5 мин): тянем строки, у которых COALESCE(timestamp_upd, timestamp_cr)
 *    больше водяного знака минус overlap. Ловит и новые шаблоны, и правки.
 *  - ПОЛНЫЙ ПРОГОН (22:00): читаем все строки — закрывает дыры, которые инкремент по времени
 *    пропустить не может не по своей вине (метки завели недавно, апдейт мимо триггера и т.п.),
 *    и заодно показывает «только у нас» (в т.ч. удалённое в проде — иначе его не увидеть,
 *    вешать триггеры на прод нам нельзя).
 *
 * Водяной знак — app.sync_watermark, по каналу, двигается только вперёд.
 * Всё выключено по умолчанию (app.etl.enabled=false) и молчит, если прод не настроен/недоступен.
 */
@Service
public class NoticeEtlService {

    private static final Logger log = LoggerFactory.getLogger(NoticeEtlService.class);
    private static final List<String> CHANNELS = List.of("sms", "push", "email", "cc", "fa", "vk", "la");

    private final ProdDbService prod;
    private final TemplateStore store;
    private final JdbcTemplate jdbc;
    private final ProcessControlService control;

    @Value("${app.etl.enabled:false}")
    private boolean enabled;
    /**
     * Перекрытие окна (минуты) — тянуть чуть раньше знака, чтобы не терять «поздние» коммиты.
     * По умолчанию 0, и это осознанно: метки времени в проде вынесли разом, поэтому у всех
     * старых строк timestamp_cr ОДИНАКОВЫЙ. Знак встаёт ровно на него, и любое перекрытие
     * заставляло бы каждые 5 минут перечитывать всю таблицу целиком.
     * Страховка от пропусков на границе — ночной полный прогон.
     */
    @Value("${app.etl.overlap-minutes:0}")
    private int overlapMinutes;

    /** Один прогон за раз: инкремент и ночной полный не должны топтаться. */
    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile Map<String, Object> lastRun = new LinkedHashMap<>();

    public NoticeEtlService(ProdDbService prod, TemplateStore store, JdbcTemplate jdbc,
                            ProcessControlService control) {
        this.prod = prod;
        this.store = store;
        this.jdbc = jdbc;
        this.control = control;
    }

    // ------------------------------------------------------------------ расписание
    @Scheduled(fixedDelayString = "${app.etl.interval-ms:300000}", initialDelayString = "${app.etl.initial-delay-ms:60000}")
    public void tickIncremental() {
        if (!enabled || !control.canStart(ProcessControlService.ETL_NOTICE)) return;
        try { run(false); } catch (Exception e) { log.warn("ETL инкремент: {}", e.toString()); }
    }

    @Scheduled(cron = "${app.etl.full-cron:0 0 22 * * *}")
    public void tickFull() {
        if (!enabled || !control.canStart(ProcessControlService.ETL_NOTICE)) return;
        try { run(true); } catch (Exception e) { log.warn("ETL полный прогон: {}", e.toString()); }
    }

    // ------------------------------------------------------------------ прогон
    /** Статус последнего прогона — для «Диагностики». */
    public Map<String, Object> status() {
        Map<String, Object> out = new LinkedHashMap<>(lastRun);
        out.put("enabled", enabled);
        out.put("configured", prod.configured());
        out.put("running", running.get());
        out.put("intervalMinutes", 5);
        out.put("watermarks", jdbc.query(
                "SELECT channel, last_prod_ts FROM app.sync_watermark ORDER BY channel",
                (rs, i) -> Map.of("channel", rs.getString(1),
                                  "lastProdTs", String.valueOf(rs.getTimestamp(2)))));
        return out;
    }

    /**
     * @param full true — читаем всё (ночной прогон), false — только изменения с водяного знака.
     */
    public Map<String, Object> run(boolean full) {
        Map<String, Object> res = new LinkedHashMap<>();
        if (!prod.configured()) {
            res.put("skipped", "Прод-приёмник не настроен");
            return res;
        }
        /* Свойство app.etl.enabled — верхняя граница («разрешён ли ETL на этой среде»),
           выключатель в «Процессах переливов» — оперативный рычаг внутри неё. Проверяем
           именно рычаг: свойство уже проверено в планировщике, а ручную кнопку он
           закрывать не должен. */
        if (!control.canStart(ProcessControlService.ETL_NOTICE)) {
            res.put("skipped", "Процесс остановлен: «Переливы» → «Процессы переливов»");
            return res;
        }
        if (!running.compareAndSet(false, true)) {
            res.put("skipped", "Прогон уже идёт");
            return res;
        }
        long t0 = System.currentTimeMillis();
        int applied = 0, skippedQueued = 0;
        List<String> failed = new ArrayList<>();
        Map<String, Integer> perChannel = new LinkedHashMap<>();
        // (channel:code) с неотправленной локальной правкой — их прод не должен затирать
        Set<String> queued = pendingKeys();
        // при полном прогоне собираем ключи прода, чтобы показать «только у нас»
        Map<String, Set<Long>> prodKeys = new LinkedHashMap<>();

        try {
            for (String ch : CHANNELS) {
                /* Безопасная граница остановки — между каналами. Внутри канала идёт
                   чтение прода потоком со сдвигом водяного знака в конце: оборвать его
                   посередине значит либо потерять знак, либо поставить его на неполные
                   данные. Дочитываем канал и выходим. */
                if (control.stopRequested(ProcessControlService.ETL_NOTICE)) {
                    res.put("stopped", "Остановлен по запросу; каналы после " + ch + " не читались");
                    log.info("ETL: остановлен по запросу перед каналом {}", ch);
                    break;
                }
                Timestamp since = full ? null : sinceFor(ch);
                Set<Long> seen = new HashSet<>();
                int[] cnt = { 0, 0 };   // [0] применено, [1] пропущено из-за очереди
                Timestamp max;
                try {
                    max = prod.readChangedSince(ch, since, row -> {
                        Long code = codeOf(ch, row);
                        if (code == null) return;
                        if (full) seen.add(code);
                        if (queued.contains(ch + ":" + code)) { cnt[1]++; return; }
                        store.upsertFromProdRow(ch, row);
                        cnt[0]++;
                    });
                } catch (Exception e) {
                    // нет таблицы/колонок времени в этом канале — пропускаем канал, остальные идут
                    failed.add(ch + ": " + rootMessage(e));
                    continue;
                }
                applied += cnt[0];
                skippedQueued += cnt[1];
                perChannel.put(ch, cnt[0]);
                if (full) prodKeys.put(ch, seen);
                // знак двигаем только вперёд и только если что-то прочитали
                if (max != null) advanceWatermark(ch, max);
            }

            res.put("mode", full ? "full" : "incremental");
            res.put("applied", applied);
            res.put("skippedQueued", skippedQueued);
            res.put("perChannel", perChannel);
            if (!failed.isEmpty()) res.put("failed", failed);
            if (full) res.put("onlyInOurs", onlyInOurs(prodKeys));
            res.put("tookMs", System.currentTimeMillis() - t0);
            res.put("finishedAt", Instant.now().toString());
            lastRun = res;
            control.noteRun(ProcessControlService.ETL_NOTICE,
                    (full ? "полный" : "инкремент") + ": применено " + applied
                    + (res.containsKey("stopped") ? ", остановлен по запросу" : ""));
            log.info("ETL {}: применено {}, пропущено (в очереди) {}, за {} мс",
                    full ? "полный" : "инкремент", applied, skippedQueued, System.currentTimeMillis() - t0);
            return res;
        } finally {
            running.set(false);
        }
    }

    // ------------------------------------------------------------------ helpers
    /** Строки с неотправленной локальной правкой: их прод-версией не перетираем. */
    private Set<String> pendingKeys() {
        Set<String> out = new HashSet<>();
        try {
            jdbc.query("SELECT channel, local_code FROM app.prod_sync WHERE status IN ('PENDING','ERROR')",
                    rs -> { out.add(rs.getString(1) + ":" + rs.getLong(2)); });
        } catch (Exception e) {
            log.warn("ETL: не удалось прочитать очередь синка: {}", e.toString());
        }
        return out;
    }

    /** Водяной знак канала минус overlap; null — канал ещё не синхронизирован (тянем всё). */
    private Timestamp sinceFor(String channel) {
        Timestamp wm;
        try {
            wm = jdbc.query("SELECT last_prod_ts FROM app.sync_watermark WHERE channel = ?",
                    rs -> rs.next() ? rs.getTimestamp(1) : null, channel);
        } catch (Exception e) {
            return null;
        }
        if (wm == null) return null;
        return Timestamp.from(wm.toInstant().minus(overlapMinutes, ChronoUnit.MINUTES));
    }

    private void advanceWatermark(String channel, Timestamp max) {
        jdbc.update(
                "INSERT INTO app.sync_watermark (channel, last_prod_ts, timestamp_upd) VALUES (?, ?, now()) " +
                "ON CONFLICT (channel) DO UPDATE SET last_prod_ts = GREATEST(" +
                "   COALESCE(app.sync_watermark.last_prod_ts, EXCLUDED.last_prod_ts), EXCLUDED.last_prod_ts), " +
                "   timestamp_upd = now()",
                channel, max);
    }

    /** Бизнес-код строки прода для этого канала (code/id/segment). */
    private static Long codeOf(String channel, JsonNode row) {
        var ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) return null;
        JsonNode n = row.get(ct.codeCol());
        return (n == null || n.isNull()) ? null : n.asLong();
    }

    /**
     * Что есть у нас, но отсутствует в проде. Сюда попадает и удалённое в проде (иначе мы это
     * никак не увидим — триггеров на проде нет), и наше локальное, ещё не доехавшее.
     * Ничего не удаляем — только показываем.
     */
    private Map<String, Object> onlyInOurs(Map<String, Set<Long>> prodKeys) {
        List<Map<String, Object>> rows = new ArrayList<>();
        Set<String> queued = pendingKeys();
        for (var e : prodKeys.entrySet()) {
            String ch = e.getKey();
            Set<Long> inProd = e.getValue();
            List<Long> ours = jdbc.queryForList(
                    "SELECT code FROM template.d_template WHERE channel = ?", Long.class, ch);
            for (Long code : ours) {
                if (inProd.contains(code)) continue;
                rows.add(Map.of(
                        "channel", ch,
                        "code", code,
                        // косвенный признак: если в очереди нет — скорее всего удалили в проде
                        "reason", queued.contains(ch + ":" + code) ? "ещё в очереди" : "нет в проде"));
                if (rows.size() >= 500) break;
            }
            if (rows.size() >= 500) break;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("count", rows.size());
        out.put("rows", rows);
        return out;
    }

    private static String rootMessage(Throwable e) {
        Throwable r = e;
        while (r.getCause() != null && r.getCause() != r) r = r.getCause();
        return r.getMessage() == null ? e.toString() : r.getMessage();
    }
}
