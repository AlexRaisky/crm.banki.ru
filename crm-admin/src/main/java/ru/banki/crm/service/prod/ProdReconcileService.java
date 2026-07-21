package ru.banki.crm.service.prod;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ru.banki.crm.service.AdminLogService;
import ru.banki.crm.service.TemplateStore;
import ru.banki.crm.service.UnifiedTemplateService;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Сверка нашего template.d_template с внешней прод-БД (источник истины) и обратный импорт.
 * Читаем прод через ProdDbService, сравниваем в прод-виде (наш ряд → prodPayload) по ключу
 * (channel, code). Импорт пишет ПРЯМО в d_template (upsert), минуя очередь синка (тянем ИЗ прода),
 * в одной транзакции + запись в аудит. Прод не удаляем и наши-только строки не трогаем.
 */
@Service
public class ProdReconcileService {

    private static final Logger log = LoggerFactory.getLogger(ProdReconcileService.class);
    private static final List<String> CHANNELS = List.of("sms", "push", "email", "cc", "fa", "vk", "la");

    private final ProdDbService prod;
    private final TemplateStore store;
    private final JdbcTemplate jdbc;
    private final AdminLogService adminLog;
    private final ObjectMapper om;
    private final TransactionTemplate tx;

    public ProdReconcileService(ProdDbService prod, TemplateStore store, JdbcTemplate jdbc,
                                AdminLogService adminLog, ObjectMapper om, TransactionTemplate tx) {
        this.prod = prod;
        this.store = store;
        this.jdbc = jdbc;
        this.adminLog = adminLog;
        this.om = om;
        this.tx = tx;
    }

    // ---- фоновый импорт «всё из прода» (одна задача за раз, прогресс — поллингом) ----
    private static final int BATCH = 500;
    private final ExecutorService bulkExec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "prod-import-all");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean bulkRunning = new AtomicBoolean(false);
    private final AtomicInteger bulkImported = new AtomicInteger(0);
    private volatile boolean bulkDone = false;
    private volatile String bulkError = null;
    private volatile String bulkPhase = null;

    /** Запустить фоновый импорт всей прод-базы в d_template. Возвращает started=true/false. */
    public Map<String, Object> startBulkImport() {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!prod.configured()) { out.put("started", false); out.put("hint", "Прод-БД не настроена."); return out; }
        if (!bulkRunning.compareAndSet(false, true)) { out.put("started", false); out.put("message", "Импорт уже идёт."); return out; }
        bulkImported.set(0); bulkDone = false; bulkError = null; bulkPhase = null;
        bulkExec.submit(this::runBulkImport);
        out.put("started", true);
        return out;
    }

    /** Статус фонового импорта — для поллинга из UI. */
    public Map<String, Object> bulkStatus() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("running", bulkRunning.get());
        m.put("done", bulkDone);
        m.put("imported", bulkImported.get());
        m.put("phase", bulkPhase);
        if (bulkError != null) m.put("error", bulkError);
        return m;
    }

    private void runBulkImport() {
        try {
            for (String ch : CHANNELS) {
                bulkPhase = ch;
                final List<JsonNode> buf = new ArrayList<>();
                try {
                    prod.readEach(ch, row -> {
                        buf.add(row);
                        if (buf.size() >= BATCH) flushBatch(ch, buf);
                    });
                } catch (Exception e) {
                    // нет прод-таблицы канала — пропускаем
                    log.warn("bulk import: канал {} пропущен: {}", ch, e.getMessage());
                    buf.clear();
                    continue;
                }
                flushBatch(ch, buf);
            }
            try {
                tx.executeWithoutResult(s -> adminLog.logTable(
                        "template.d_template", "IMPORT_ALL", "{\"imported\":" + bulkImported.get() + "}"));
            } catch (Exception e) {
                log.warn("bulk import audit failed: {}", e.getMessage());
            }
        } catch (Exception e) {
            bulkError = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            log.warn("bulk import failed: {}", bulkError);
        } finally {
            bulkPhase = null;
            bulkDone = true;
            bulkRunning.set(false);
        }
    }

    /** Батч upsert в d_template (одна транзакция), затем очистка буфера и инкремент счётчика. */
    private void flushBatch(String ch, List<JsonNode> buf) {
        if (buf.isEmpty()) return;
        final List<JsonNode> batch = new ArrayList<>(buf);
        buf.clear();
        tx.executeWithoutResult(s -> { for (JsonNode row : batch) store.upsertFromProdRow(ch, row); });
        bulkImported.addAndGet(batch.size());
    }

    /** Отчёт-сверка по всем каналам: корзины «только в проде / разошлись / только у нас» + счётчик совпадений. */
    public Map<String, Object> report() throws Exception {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!prod.configured()) {
            out.put("configured", false);
            out.put("hint", "Прод-БД не настроена (PROD_DB_URL пуст) — сверять не с чем.");
            return out;
        }
        out.put("configured", true);
        List<Map<String, Object>> onlyInProd = new ArrayList<>();
        List<Map<String, Object>> diverged = new ArrayList<>();
        List<Map<String, Object>> onlyInOurs = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        int[] inSync = {0};

        for (String ch : CHANNELS) {
            String codeCol = UnifiedTemplateService.channelTable(ch).codeCol();
            // наша сторона (сотни строк) в прод-виде: code -> нормализованный ряд
            Map<Long, JsonNode> ourView = new HashMap<>();
            for (Long code : jdbc.queryForList(
                    "SELECT code FROM template.d_template WHERE channel = ?", Long.class, ch)) {
                try {
                    String pj = store.prodPayload(ch, String.valueOf(code));
                    if (pj != null) ourView.put(code, om.readTree(pj));
                } catch (Exception ignore) { /* пропускаем битую строку */ }
            }
            Set<Long> seen = new HashSet<>();
            try {
                // прод — потоково, строки в памяти не держим, копим только компактные сводки
                prod.readEach(ch, row -> {
                    JsonNode cn = row.get(codeCol);
                    if (cn == null || cn.isNull()) return;
                    long code = cn.asLong();
                    JsonNode our = ourView.get(code);
                    if (our == null) { onlyInProd.add(entry(ch, code, srcType(row))); return; }
                    seen.add(code);
                    List<Map<String, Object>> diffs = diffNodes(our, row, codeCol);
                    if (diffs.isEmpty()) inSync[0]++;
                    else { Map<String, Object> e = entry(ch, code, srcType(row)); e.put("diffs", diffs); diverged.add(e); }
                });
            } catch (Exception e) {
                // нет прод-таблицы канала или ошибка чтения — канал пропускаем, отчёт не роняем
                skipped.add(ch);
                log.warn("reconcile: канал {} пропущен: {}", ch, e.getMessage());
                continue;
            }
            for (Long code : ourView.keySet()) {
                if (!seen.contains(code)) onlyInOurs.add(entry(ch, code, null));
            }
        }
        out.put("onlyInProd", onlyInProd);
        out.put("diverged", diverged);
        out.put("onlyInOurs", onlyInOurs);
        out.put("inSync", inSync[0]);
        out.put("skipped", skipped);
        return out;
    }

    /** Пофайловый дифф двух рядов в прод-виде (наш vs прод), по управляемым нами полям. */
    private static List<Map<String, Object>> diffNodes(JsonNode our, JsonNode prodRow, String codeCol) {
        List<Map<String, Object>> diffs = new ArrayList<>();
        our.fieldNames().forEachRemaining(k -> {
            if (k.equals(codeCol) || k.equals("id")) return;
            String os = asStr(our.get(k)), ps = asStr(prodRow.get(k));
            if (os.equals(ps)) return;
            // прод-NULL и наш дефолт — по смыслу одно и то же: пусто/false/0 взаимозаменяемы, не расхождение
            if (emptyish(os) && emptyish(ps)) return;
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("field", k); d.put("ours", os); d.put("prod", ps);
            diffs.add(d);
        });
        return diffs;
    }

    /** «Пустышные» значения: NULL/пусто, false, 0 — считаем эквивалентными при сверке. */
    private static boolean emptyish(String s) {
        return s.isEmpty() || s.equals("false") || s.equals("0");
    }

    /** Импорт выбранных строк из прода в d_template (upsert, без очереди), в одной транзакции + аудит. */
    public int importRows(List<Map<String, Object>> rows) {
        if (rows == null) return 0;
        int ok = 0;
        for (Map<String, Object> r : rows) {
            String ch = String.valueOf(r.get("channel"));
            Object codeObj = r.get("code");
            if (codeObj == null) continue;
            long code = ((Number) codeObj).longValue();
            try {
                String rowJson = prod.readOne(ch, code);
                if (rowJson == null) continue;
                JsonNode prodRow = om.readTree(rowJson);
                tx.executeWithoutResult(s -> {
                    store.upsertFromProdRow(ch, prodRow);
                    adminLog.logTable("template.d_template", "IMPORT", prodRow.toString());
                });
                ok++;
            } catch (Exception e) {
                log.warn("reconcile import {}/{} failed: {}", ch, code, e.getMessage());
            }
        }
        return ok;
    }

    private static String asStr(JsonNode v) { return v == null || v.isNull() ? "" : v.asText(); }

    private static String srcType(JsonNode prodRow) {
        JsonNode s = prodRow.get("source_type");
        return s == null || s.isNull() ? "" : s.asText();
    }

    private static Map<String, Object> entry(String ch, long code, String src) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("channel", ch);
        m.put("code", code);
        if (src != null) m.put("source", src);
        return m;
    }
}
