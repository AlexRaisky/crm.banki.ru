package ru.banki.crm.service;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Отчёт «ЧЕК СМС траффик» — выгрузка в Excel.
 * <p>
 * Книга состоит из 31 листа сырья по дням месяца («1»…«31») и 17 листов-представлений
 * (анкета, каталог, …, свод, карта), которые агрегируют сырьё формулами {@code SUMIFS}.
 * Мы НЕ переписываем аналитику: панель заполняет только сырые листы результатом SQL,
 * а Excel досчитывает представления при открытии.
 * <p>
 * Наполнение сделано «хирургией по zip»: .xlsx — это zip, и мы переписываем лишь
 * XML листов-дней, копируя все прочие части (тяжёлые листы-представления с десятками
 * тысяч формул, стили, sharedStrings, внешние связи) байт-в-байт. Полноценная загрузка
 * книги в POI на таком файле уходила в минуты (обслуживание calcChain при правке ячеек —
 * фактически O(n²)); здесь генерация занимает доли секунды. Пересчёт включаем флагом
 * {@code calcPr fullCalcOnLoad="1"} и удаляем {@code calcChain.xml}, чтобы Excel
 * пересобрал цепочку и посчитал все представления при открытии.
 * <p>
 * Ключ связки {@code V = source_type+template_id} пишем в лист значением — по нему
 * представления матчат метрики. Один SQL за месяц (группировка по дню + разрезам)
 * исполняется на выбранной админом внешней БД (DWH) из {@code app.db_connection}.
 * Источник задаёт только ADMIN (хранится в {@code app.panel_settings}); скачивать
 * может любой с правом READ на раздел «Отчёты», сам коннект наружу не отдаётся.
 */
@Service
public class SmsCheckReportService {

    private static final String SETTINGS_KEY = "smsCheckReport";
    private static final String TEMPLATE = "reports/sms-check-template.xlsx";
    private static final int QUERY_TIMEOUT_S = 120;

    private static final String SQL =
            "select report_date, communication_name, event_name, source_type, template_id, template_text," +
            "  SUM(unique_sent) as unique_sent," +
            "  SUM(unique_delivered) as unique_delivered," +
            "  SUM(ho_clicks_line) as ho_clicks_line," +
            "  COALESCE(SUM(ho_clicks_line)::float / NULLIF(SUM(unique_delivered), 0) * 100, 0) as cr," +
            "  SUM(ho_conversions_line) as ho_conversions_line," +
            "  SUM(ho_issued_line) as ho_issued_line," +
            "  SUM(cost) as cost," +
            "  SUM(revenue_fact) as revenue_fact," +
            "  SUM(revenue_base) as revenue_base," +
            "  SUM(revenue_fact) - SUM(cost) as margin," +
            "  COALESCE((SUM(revenue_fact) - SUM(cost))::float / NULLIF(SUM(revenue_fact), 0), 0) as margin_rate," +
            "  COALESCE(SUM(revenue_fact)::float / NULLIF(SUM(ho_clicks_line), 0), 0) as epc," +
            "  COALESCE(SUM(revenue_fact)::float / NULLIF(SUM(ho_conversions_line), 0), 0) as epl," +
            "  COALESCE(SUM(revenue_fact)::float / NULLIF(SUM(ho_issued_line), 0), 0) as epi," +
            "  COALESCE(SUM(revenue_fact)::float / NULLIF(SUM(unique_delivered), 0) * 1000, 0) as epm" +
            " from crm.v_crm_matrix_report" +
            " where report_date >= ? and report_date < ? and channel_name ilike ?" +
            " group by report_date, communication_name, event_name, source_type, template_id, template_text" +
            " order by report_date";

    private static final Map<String, String> CHANNELS = Map.of("sms", "sms", "push", "push", "email", "email");

    /** Заголовки колонок A–T листа-дня (5 разрезов + 15 метрик). */
    private static final String[] HEADERS = {
            "Row gr 1", "Row gr 2", "Row gr 3", "Row gr 4", "Row gr 5",
            "Отправлено", "Доставлено", "Клик HO", "CR от базы (клик) (клик ho/доставлено)",
            "Заявка HO", "Выдача HO", "Cost", "Revenue fact", "Revenue base", "Margin", "Marginal Rate",
            "EPC (revenue_fact/ho_clicks_line)", "EPL (revenue/ho_conversions_line)",
            "EPI (revenue_fact/ho_issued_line)", "EPM (revenue/delivered *1000)"
    };
    private static final int METRIC_COUNT = 15;   // F..T
    private static final int COL_KEY = 21;        // V (0-based) — ключ связки
    private static final int COL_TEXT_COPY = 25;  // Z — копия текста (лукап «текст» в представлениях)

    private final JdbcTemplate jdbc;
    private volatile byte[] templateBytes;   // кэш шаблона (4 МБ) — читаем один раз

    public SmsCheckReportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ конфиг
    public Map<String, Object> configGet() {
        Long id = configuredConnectionId();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connectionId", id);
        out.put("connectionName", id == null ? null : connectionName(id));
        out.put("canEdit", isAdmin());
        out.put("channels", new ArrayList<>(List.of("sms", "push", "email")));
        return out;
    }

    public void configSet(Long connectionId) {
        if (!isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Менять источник может только администратор.");
        if (connectionId != null) {
            Integer ok = jdbc.queryForObject("SELECT count(*) FROM app.db_connection WHERE id = ?", Integer.class, connectionId);
            if (ok == null || ok == 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нет такого подключения.");
        }
        String value = connectionId == null ? "{}" : "{\"connectionId\": " + connectionId + "}";
        jdbc.update(
                "INSERT INTO app.panel_settings (key, value, timestamp_upd) VALUES (?, CAST(? AS jsonb), now()) " +
                "ON CONFLICT (key) DO UPDATE SET value = CAST(? AS jsonb), timestamp_upd = now()",
                SETTINGS_KEY, value, value);
    }

    private Long configuredConnectionId() {
        List<Long> ids = jdbc.query(
                "SELECT (value->>'connectionId')::bigint AS id FROM app.panel_settings WHERE key = ?",
                (rs, i) -> { long v = rs.getLong("id"); return rs.wasNull() ? null : v; }, SETTINGS_KEY);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private String connectionName(long id) {
        try { return jdbc.queryForObject("SELECT name FROM app.db_connection WHERE id = ?", String.class, id); }
        catch (Exception e) { return null; }
    }

    // ------------------------------------------------------------- построение
    /** Собрать .xlsx за месяц по каналу. */
    public byte[] build(YearMonth month, String channelKey) {
        String channel = CHANNELS.get(channelKey == null ? "" : channelKey.toLowerCase());
        if (channel == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный канал. Ожидается sms, push или email.");
        Long connId = configuredConnectionId();
        if (connId == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Источник данных (DWH) не выбран. Администратор задаёт его в разделе «Отчёты».");
        }
        Map<Integer, List<DayRow>> byDay = query(connId, month, channel);
        try {
            return patchTemplate(byDay, month.lengthOfMonth());
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Не удалось сформировать Excel: " + rootMessage(e), e);
        }
    }

    /** Zip-хирургия: перезаписать XML листов-дней, остальное скопировать байт-в-байт. */
    private byte[] patchTemplate(Map<Integer, List<DayRow>> byDay, int daysInMonth) throws Exception {
        Map<String, byte[]> parts = new LinkedHashMap<>();
        byte[] tpl = template();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(tpl))) {
            ZipEntry e;
            byte[] buf = new byte[8192];
            while ((e = zis.getNextEntry()) != null) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                int n;
                while ((n = zis.read(buf)) > 0) bos.write(buf, 0, n);
                parts.put(e.getName(), bos.toByteArray());
            }
        }

        // сопоставление имени листа-дня → путь XML-части
        String workbookXml = text(parts.get("xl/workbook.xml"));
        String relsXml = text(parts.get("xl/_rels/workbook.xml.rels"));
        Map<String, String> nameToRid = sheetNameToRid(workbookXml);
        Map<String, String> ridToTarget = ridToTarget(relsXml);

        for (int d = 1; d <= 31; d++) {
            String rid = nameToRid.get(String.valueOf(d));
            if (rid == null) continue;
            String target = ridToTarget.get(rid);
            if (target == null) continue;
            String path = "xl/" + target.replaceFirst("^/?", "");
            List<DayRow> rows = (d <= daysInMonth) ? byDay.getOrDefault(d, List.of()) : List.of();
            parts.put(path, daySheetXml(rows).getBytes(StandardCharsets.UTF_8));
        }

        // пересчёт при открытии + снос calcChain (Excel пересоберёт)
        parts.put("xl/workbook.xml", forceRecalc(workbookXml).getBytes(StandardCharsets.UTF_8));
        parts.remove("xl/calcChain.xml");
        parts.put("[Content_Types].xml", dropCalcChain(text(parts.get("[Content_Types].xml"))).getBytes(StandardCharsets.UTF_8));
        parts.put("xl/_rels/workbook.xml.rels", dropCalcChainRel(relsXml).getBytes(StandardCharsets.UTF_8));

        ByteArrayOutputStream out = new ByteArrayOutputStream(tpl.length);
        try (ZipOutputStream zos = new ZipOutputStream(out)) {
            for (Map.Entry<String, byte[]> p : parts.entrySet()) {
                zos.putNextEntry(new ZipEntry(p.getKey()));
                zos.write(p.getValue());
                zos.closeEntry();
            }
        }
        return out.toByteArray();
    }

    private byte[] template() {
        byte[] b = templateBytes;
        if (b != null) return b;
        try (InputStream in = new ClassPathResource(TEMPLATE).getInputStream()) {
            b = in.readAllBytes();
            templateBytes = b;
            return b;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Шаблон отчёта недоступен: " + rootMessage(e), e);
        }
    }

    // -------------------------------------------------------- генерация листа
    /** XML одного листа-дня: шапка (строка 1), Grand Total (строка 2), затем данные. */
    private String daySheetXml(List<DayRow> rows) {
        StringBuilder sb = new StringBuilder(4096);
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
        sb.append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
        int lastRow = 2 + rows.size();
        sb.append("<dimension ref=\"A1:AA").append(Math.max(lastRow, 1)).append("\"/>");
        sb.append("<sheetData>");

        // строка 1 — шапка
        sb.append("<row r=\"1\">");
        for (int i = 0; i < HEADERS.length; i++) cellStr(sb, i, 1, HEADERS[i]);
        sb.append("</row>");

        // строка 2 — Grand Total
        double[] tot = grandTotal(rows);
        sb.append("<row r=\"2\">");
        cellStr(sb, 0, 2, "Grand Total");
        for (int i = 0; i < METRIC_COUNT; i++) cellNum(sb, 5 + i, 2, tot[i]);
        sb.append("</row>");

        // данные
        int r = 3;
        for (DayRow dr : rows) {
            sb.append("<row r=\"").append(r).append("\">");
            cellStr(sb, 0, r, dr.eventName);
            cellStr(sb, 1, r, dr.commName);
            cellStr(sb, 2, r, dr.source);
            cellTemplateId(sb, 3, r, dr.templateId);
            cellStr(sb, 4, r, dr.text);
            for (int i = 0; i < METRIC_COUNT; i++) cellNum(sb, 5 + i, r, dr.m[i]);
            cellStr(sb, COL_KEY, r, key(dr.source, dr.templateId));   // V — ключ связки
            cellStr(sb, COL_TEXT_COPY, r, dr.text);                    // Z — копия текста
            sb.append("</row>");
            r++;
        }
        sb.append("</sheetData></worksheet>");
        return sb.toString();
    }

    private double[] grandTotal(List<DayRow> rows) {
        double sent = 0, deliv = 0, clicks = 0, conv = 0, issued = 0, cost = 0, revF = 0, revB = 0;
        for (DayRow dr : rows) {
            sent += dr.m[0]; deliv += dr.m[1]; clicks += dr.m[2]; conv += dr.m[4];
            issued += dr.m[5]; cost += dr.m[6]; revF += dr.m[7]; revB += dr.m[8];
        }
        double[] t = new double[METRIC_COUNT];
        t[0] = sent; t[1] = deliv; t[2] = clicks; t[4] = conv; t[5] = issued;
        t[6] = cost; t[7] = revF; t[8] = revB;
        t[9] = revF - cost;                                  // margin
        t[3] = deliv == 0 ? 0 : clicks / deliv * 100;        // cr
        t[10] = revF == 0 ? 0 : (revF - cost) / revF;        // margin_rate
        t[11] = clicks == 0 ? 0 : revF / clicks;             // epc
        t[12] = conv == 0 ? 0 : revF / conv;                 // epl
        t[13] = issued == 0 ? 0 : revF / issued;             // epi
        t[14] = deliv == 0 ? 0 : revF / deliv * 1000;        // epm
        return t;
    }

    private static void cellStr(StringBuilder sb, int col0, int row, String v) {
        if (v == null || v.isEmpty()) return;
        sb.append("<c r=\"").append(colLetter(col0)).append(row).append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
          .append(xmlEsc(v)).append("</t></is></c>");
    }

    private static void cellNum(StringBuilder sb, int col0, int row, double v) {
        sb.append("<c r=\"").append(colLetter(col0)).append(row).append("\"><v>").append(numStr(v)).append("</v></c>");
    }

    /** template_id: число — числовой ячейкой (как в исходнике), иначе строкой. */
    private static void cellTemplateId(StringBuilder sb, int col0, int row, String v) {
        if (v == null || v.isEmpty()) return;
        if (v.matches("-?\\d+")) sb.append("<c r=\"").append(colLetter(col0)).append(row).append("\"><v>").append(v).append("</v></c>");
        else cellStr(sb, col0, row, v);
    }

    private static String key(String source, String templateId) {
        return (source == null ? "" : source) + (templateId == null ? "" : templateId);
    }

    // ---------------------------------------------------- правка служебных XML
    private static final Pattern SHEET = Pattern.compile("<sheet\\b[^>]*/>");
    private static final Pattern REL = Pattern.compile("<Relationship\\b[^>]*/>");

    private static Map<String, String> sheetNameToRid(String workbookXml) {
        Map<String, String> m = new HashMap<>();
        Matcher mt = SHEET.matcher(workbookXml);
        while (mt.find()) {
            String el = mt.group();
            String name = attr(el, "name"), rid = attr(el, "r:id");
            if (name != null && rid != null) m.put(name, rid);
        }
        return m;
    }

    private static Map<String, String> ridToTarget(String relsXml) {
        Map<String, String> m = new HashMap<>();
        Matcher mt = REL.matcher(relsXml);
        while (mt.find()) {
            String el = mt.group();
            String id = attr(el, "Id"), target = attr(el, "Target");
            if (id != null && target != null) m.put(id, target);
        }
        return m;
    }

    /** Включить полный пересчёт при открытии. */
    private static String forceRecalc(String workbookXml) {
        Matcher m = Pattern.compile("<calcPr\\b([^>]*)/>").matcher(workbookXml);
        if (m.find()) {
            String attrs = m.group(1).replaceAll("\\s*fullCalcOnLoad=\"[^\"]*\"", "");
            return workbookXml.substring(0, m.start()) + "<calcPr" + attrs + " fullCalcOnLoad=\"1\"/>" + workbookXml.substring(m.end());
        }
        // calcPr нет — добавим перед </workbook>
        return workbookXml.replace("</workbook>", "<calcPr calcId=\"0\" fullCalcOnLoad=\"1\"/></workbook>");
    }

    private static String dropCalcChain(String contentTypes) {
        return contentTypes.replaceAll("<Override[^>]*PartName=\"/xl/calcChain\\.xml\"[^>]*/>", "");
    }

    private static String dropCalcChainRel(String relsXml) {
        Matcher m = REL.matcher(relsXml);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String el = m.group();
            String target = attr(el, "Target");
            if (target != null && target.endsWith("calcChain.xml")) {
                sb.append(relsXml, last, m.start());
                last = m.end();
            }
        }
        sb.append(relsXml.substring(last));
        return sb.toString();
    }

    private static String attr(String element, String name) {
        Matcher m = Pattern.compile("\\b" + Pattern.quote(name) + "=\"([^\"]*)\"").matcher(element);
        return m.find() ? m.group(1) : null;
    }

    private static String colLetter(int idx0) {
        StringBuilder s = new StringBuilder();
        int n = idx0;
        do { s.insert(0, (char) ('A' + n % 26)); n = n / 26 - 1; } while (n >= 0);
        return s.toString();
    }

    private static String numStr(double v) {
        if (v == 0) return "0";
        if (v == Math.rint(v) && !Double.isInfinite(v) && Math.abs(v) < 1e15) return String.valueOf((long) v);
        return BigDecimal.valueOf(v).toPlainString();
    }

    private static String xmlEsc(String s) {
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '"' -> b.append("&quot;");
                case '\'' -> b.append("&apos;");
                default -> { if (c >= 0x20 || c == '\t' || c == '\n' || c == '\r') b.append(c); }
            }
        }
        return b.toString();
    }

    // ------------------------------------------------------------------ SQL
    private Map<Integer, List<DayRow>> query(long connId, YearMonth month, String channel) {
        Map<String, Object> c;
        try {
            c = jdbc.queryForMap("SELECT jdbc_url, username, password FROM app.db_connection WHERE id = ?", connId);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Подключение-источник удалено. Задайте его заново.");
        }
        LocalDate from = month.atDay(1), to = month.plusMonths(1).atDay(1);
        Map<Integer, List<DayRow>> byDay = new HashMap<>();
        Properties props = new Properties();
        String user = str(c.get("username")), pass = str(c.get("password"));
        if (!user.isEmpty()) props.setProperty("user", user);
        if (!pass.isEmpty()) props.setProperty("password", pass);
        props.setProperty("connectTimeout", "20");
        props.setProperty("socketTimeout", String.valueOf(QUERY_TIMEOUT_S + 10));

        try (Connection conn = DriverManager.getConnection(str(c.get("jdbc_url")), props)) {
            try { conn.setReadOnly(true); } catch (Exception ignore) {}
            try (PreparedStatement ps = conn.prepareStatement(SQL)) {
                ps.setQueryTimeout(QUERY_TIMEOUT_S);
                ps.setObject(1, from);
                ps.setObject(2, to);
                ps.setString(3, channel);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        LocalDate d = rs.getObject("report_date", LocalDate.class);
                        int day = d == null ? 0 : d.getDayOfMonth();
                        DayRow dr = new DayRow();
                        dr.eventName = rs.getString("event_name");
                        dr.commName = rs.getString("communication_name");
                        dr.source = rs.getString("source_type");
                        Object tid = rs.getObject("template_id");
                        dr.templateId = tid == null ? null : templateIdStr(tid);
                        dr.text = rs.getString("template_text");
                        dr.m[0] = rs.getDouble("unique_sent");
                        dr.m[1] = rs.getDouble("unique_delivered");
                        dr.m[2] = rs.getDouble("ho_clicks_line");
                        dr.m[3] = rs.getDouble("cr");
                        dr.m[4] = rs.getDouble("ho_conversions_line");
                        dr.m[5] = rs.getDouble("ho_issued_line");
                        dr.m[6] = rs.getDouble("cost");
                        dr.m[7] = rs.getDouble("revenue_fact");
                        dr.m[8] = rs.getDouble("revenue_base");
                        dr.m[9] = rs.getDouble("margin");
                        dr.m[10] = rs.getDouble("margin_rate");
                        dr.m[11] = rs.getDouble("epc");
                        dr.m[12] = rs.getDouble("epl");
                        dr.m[13] = rs.getDouble("epi");
                        dr.m[14] = rs.getDouble("epm");
                        if (day >= 1 && day <= 31) byDay.computeIfAbsent(day, k -> new ArrayList<>()).add(dr);
                    }
                }
            }
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Ошибка запроса к источнику: " + rootMessage(e), e);
        }
        return byDay;
    }

    private static String templateIdStr(Object v) {
        if (v instanceof Number n) {
            double d = n.doubleValue();
            if (d == Math.rint(d) && !Double.isInfinite(d)) return String.valueOf((long) d);
            return String.valueOf(d);
        }
        return String.valueOf(v).trim();
    }

    // --------------------------------------------------------------- helpers
    private static boolean isAdmin() {
        return CurrentUser.principal().map(p -> p.user().getRole().isAdminLevel()).orElse(false);
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o).trim(); }

    private static String text(byte[] b) { return b == null ? "" : new String(b, StandardCharsets.UTF_8); }

    private static String rootMessage(Throwable e) {
        Throwable r = e;
        while (r.getCause() != null && r.getCause() != r) r = r.getCause();
        return r.getMessage() != null ? r.getMessage() : e.toString();
    }

    private static final class DayRow {
        String eventName, commName, source, templateId, text;
        final double[] m = new double[METRIC_COUNT];
    }
}
