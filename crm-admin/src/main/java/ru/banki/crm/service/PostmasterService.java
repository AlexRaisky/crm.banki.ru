package ru.banki.crm.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.security.CurrentUser;

import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Состояние почтового канала по данным Google и Mail.ru Postmaster.
 *
 * <p>Обе системы отдают ограниченное окно (у Google это около 90 дней), поэтому
 * метрики копим у себя: без своей истории нельзя ответить «когда именно поехала
 * репутация», а именно этот вопрос и задают.
 *
 * <p>Google поддержан в двух версиях. v1 — {@code domains/{домен}/trafficStats},
 * сутки на запись. v2 — {@code domainStats.query} с диапазоном дат и отдельным
 * методом статуса SPF/DKIM/DMARC. Версия берётся из настройки, а не подбирается
 * по ошибке: у части кабинетов v2 недоступен, и «пробуем v2, при сбое v1»
 * превращало бы любую сетевую неполадку в тихий откат на старый ответ.
 *
 * <p>Mail.ru: refresh-токен меняется на часовой access в o2.mail.ru, дальше
 * {@code /ext-api/stat-list-detailed/}. Заголовок у них нестандартный —
 * {@code Bearer: <токен>} вместо {@code Authorization: Bearer <токен>}, и с
 * привычным написанием сервис отвечает 401 без пояснений.
 */
@Service
public class PostmasterService {

    private static final String GOOGLE_API = "https://gmailpostmastertools.googleapis.com";
    private static final String GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
    private static final String MAILRU_API = "https://postmaster.mail.ru";
    private static final String MAILRU_TOKEN = "https://o2.mail.ru/token";
    private static final String MAILRU_CLIENT = "postmaster_api_client";
    /** Больше 10 запросов в минуту Mail.ru не принимает — тянем диапазоном, а не по дням. */
    private static final int DEFAULT_DAYS = 30;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final JdbcTemplate jdbc;
    private final ObjectMapper om;

    public PostmasterService(JdbcTemplate jdbc, ObjectMapper om) {
        this.jdbc = jdbc;
        this.om = om;
    }

    /* ---------------------------------------------------------- настройки */

    /** Настройки для экрана: сами токены наружу не отдаём, только признак «заполнено». */
    @Transactional(readOnly = true)
    public Map<String, Object> settings() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT domain, google_client_id, google_api_version," +
                "       google_client_secret IS NOT NULL AND google_client_secret <> '' AS google_secret_set," +
                "       google_refresh_token IS NOT NULL AND google_refresh_token <> '' AS google_token_set," +
                "       mailru_refresh_token IS NOT NULL AND mailru_refresh_token <> '' AS mailru_token_set," +
                "       google_status, google_error, google_checked_at," +
                "       mailru_status, mailru_error, mailru_checked_at, timestamp_upd, updated_by" +
                "  FROM app.postmaster_connection WHERE id = 1");
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /**
     * Сохранение настроек. Пустое поле токена означает «не менять»: экран показывает
     * маску вместо значения, и очистка поля не должна стирать рабочий доступ.
     */
    @Transactional
    public Map<String, Object> saveSettings(Map<String, Object> body) {
        jdbc.update(
                "UPDATE app.postmaster_connection" +
                "   SET domain = coalesce(nullif(?, ''), domain)," +
                "       google_client_id = coalesce(?, google_client_id)," +
                "       google_client_secret = coalesce(nullif(?, ''), google_client_secret)," +
                "       google_refresh_token = coalesce(nullif(?, ''), google_refresh_token)," +
                "       google_api_version = coalesce(nullif(?, ''), google_api_version)," +
                "       mailru_refresh_token = coalesce(nullif(?, ''), mailru_refresh_token)," +
                "       timestamp_upd = now(), updated_by = ?" +
                " WHERE id = 1",
                str(body.get("domain")), str(body.get("googleClientId")),
                str(body.get("googleClientSecret")), str(body.get("googleRefreshToken")),
                "v2".equals(str(body.get("googleApiVersion"))) ? "v2" : "v1",
                str(body.get("mailruRefreshToken")), CurrentUser.email());
        return settings();
    }

    private Map<String, Object> secrets() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT domain, google_client_id, google_client_secret, google_refresh_token," +
                "       google_api_version, mailru_refresh_token" +
                "  FROM app.postmaster_connection WHERE id = 1");
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /* ------------------------------------------------------------ метрики */

    /** Сохранённые метрики за период — то, что рисует раздел. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> stats(String source, LocalDate from, LocalDate to) {
        LocalDate f = from != null ? from : LocalDate.now().minusDays(DEFAULT_DAYS);
        LocalDate t = to != null ? to : LocalDate.now();
        StringBuilder sql = new StringBuilder(
                "SELECT source, domain, stat_date, sent, delivered, read_count, complaints," +
                "       spam_rate, domain_reputation, ip_reputation, spf_ratio, dkim_ratio, dmarc_ratio" +
                "  FROM channel.t_postmaster_daily WHERE stat_date BETWEEN ? AND ?");
        List<Object> args = new ArrayList<>(List.of(Date.valueOf(f), Date.valueOf(t)));
        if (source != null && !source.isBlank()) {
            sql.append(" AND source = ?");
            args.add(source);
        }
        sql.append(" ORDER BY stat_date, source");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /**
     * Обновление из обеих систем. Ошибка одной не отменяет другую: если Mail.ru
     * молчит, данные Google всё равно должны обновиться, а раздел — показать, что
     * именно не получилось.
     */
    @Transactional
    public Map<String, Object> refresh(Integer days) {
        Map<String, Object> cfg = secrets();
        String domain = str(cfg.get("domain"));
        int span = (days == null || days < 1 || days > 400) ? DEFAULT_DAYS : days;
        LocalDate to = LocalDate.now(), from = to.minusDays(span);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("domain", domain);
        out.put("google", runSource("google", () -> loadGoogle(cfg, domain, from, to)));
        out.put("mailru", runSource("mailru", () -> loadMailru(cfg, domain, from, to)));
        return out;
    }

    private interface Loader { int load() throws Exception; }

    /** Общая обвязка: посчитать, записать статус, не дать упасть всему обновлению. */
    private Map<String, Object> runSource(String source, Loader loader) {
        String col = "google".equals(source) ? "google" : "mailru";
        try {
            int n = loader.load();
            jdbc.update("UPDATE app.postmaster_connection SET " + col + "_status = 'ok'," +
                        " " + col + "_error = NULL, " + col + "_checked_at = now() WHERE id = 1");
            return Map.of("ok", true, "days", n);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.toString() : e.getMessage();
            jdbc.update("UPDATE app.postmaster_connection SET " + col + "_status = 'error'," +
                        " " + col + "_error = ?, " + col + "_checked_at = now() WHERE id = 1",
                    msg.length() > 900 ? msg.substring(0, 900) : msg);
            return Map.of("ok", false, "error", msg);
        }
    }

    /* ------------------------------------------------------------- Google */

    private int loadGoogle(Map<String, Object> cfg, String domain, LocalDate from, LocalDate to)
            throws Exception {
        String token = googleAccessToken(cfg);
        boolean v2 = "v2".equals(str(cfg.get("google_api_version")));
        JsonNode root = v2
                ? getJson(GOOGLE_API + "/v2/domains/" + enc(domain) + "/domainStats:query"
                        + "?startDate=" + from + "&endDate=" + to, token, false)
                : getJson(GOOGLE_API + "/v1/domains/" + enc(domain) + "/trafficStats"
                        + "?startDate.year=" + from.getYear()
                        + "&startDate.month=" + from.getMonthValue()
                        + "&startDate.day=" + from.getDayOfMonth()
                        + "&endDate.year=" + to.getYear()
                        + "&endDate.month=" + to.getMonthValue()
                        + "&endDate.day=" + to.getDayOfMonth(), token, false);

        JsonNode list = root.has("trafficStats") ? root.get("trafficStats")
                       : root.has("domainStats")  ? root.get("domainStats")
                       : root.get("stats");
        if (list == null || !list.isArray()) {
            return 0;
        }
        int n = 0;
        for (JsonNode s : list) {
            /* Имя записи — domains/{домен}/trafficStats/20260115: дата в конце, и в
               v1 её больше нигде нет. */
            LocalDate d = dateFromName(s.path("name").asText(null));
            if (d == null) {
                continue;
            }
            upsert("google", domain, d,
                    null, null, null, null,
                    dec(s, "userReportedSpamRatio"),
                    s.path("domainReputation").asText(null),
                    worstIpReputation(s),
                    dec(s, "spfSuccessRatio"), dec(s, "dkimSuccessRatio"), dec(s, "dmarcSuccessRatio"),
                    s.toString());
            n++;
        }
        return n;
    }

    /** Худшая категория среди IP за день: одна плохая важнее, чем средняя по больнице. */
    private String worstIpReputation(JsonNode s) {
        JsonNode ips = s.path("ipReputations");
        if (!ips.isArray()) return null;
        List<String> order = List.of("BAD", "LOW", "MEDIUM", "HIGH");
        String worst = null;
        for (JsonNode ip : ips) {
            String r = ip.path("reputation").asText(null);
            if (r == null) continue;
            if (worst == null || order.indexOf(r) < order.indexOf(worst)) worst = r;
        }
        return worst;
    }

    private String googleAccessToken(Map<String, Object> cfg) throws Exception {
        String id = str(cfg.get("google_client_id"));
        String secret = str(cfg.get("google_client_secret"));
        String refresh = str(cfg.get("google_refresh_token"));
        if (id == null || secret == null || refresh == null) {
            throw new IllegalStateException("Не заполнены доступы Google Postmaster");
        }
        String form = "client_id=" + enc(id) + "&client_secret=" + enc(secret)
                + "&refresh_token=" + enc(refresh) + "&grant_type=refresh_token";
        JsonNode t = postForm(GOOGLE_TOKEN, form, null);
        String access = t.path("access_token").asText(null);
        if (access == null) {
            throw new IllegalStateException("Google не выдал access_token: " + t);
        }
        return access;
    }

    /* ------------------------------------------------------------- Mail.ru */

    private int loadMailru(Map<String, Object> cfg, String domain, LocalDate from, LocalDate to)
            throws Exception {
        String refresh = str(cfg.get("mailru_refresh_token"));
        if (refresh == null) {
            throw new IllegalStateException("Не заполнен refresh-токен Mail.ru Postmaster");
        }
        JsonNode t = postForm(MAILRU_TOKEN,
                "client_id=" + MAILRU_CLIENT + "&grant_type=refresh_token&refresh_token=" + enc(refresh),
                null);
        String access = t.path("access_token").asText(null);
        if (access == null) {
            throw new IllegalStateException("Mail.ru не выдал access_token: " + t);
        }
        JsonNode root = getJson(MAILRU_API + "/ext-api/stat-list-detailed/?domain=" + enc(domain)
                + "&from=" + from + "&to=" + to, access, true);

        JsonNode list = root.has("data") ? root.get("data") : root;
        if (list == null || !list.isArray()) {
            return 0;
        }
        int n = 0;
        for (JsonNode s : list) {
            LocalDate d = parseDate(firstText(s, "date", "day", "dt"));
            if (d == null) {
                continue;
            }
            /* spam_percent приходит процентами, у Google доля — приводим к доле,
               иначе на одном графике окажутся 2 и 0,02. */
            BigDecimal spamPct = dec(s, "spam_percent");
            upsert("mailru", domain, d,
                    lng(s, "messages_sent"), lng(s, "delivered"), lng(s, "read"), lng(s, "complaints"),
                    spamPct == null ? null : spamPct.movePointLeft(2),
                    s.path("reputation").asText(null), null, null, null, null,
                    s.toString());
            n++;
        }
        return n;
    }

    /* --------------------------------------------------------------- HTTP */

    private JsonNode getJson(String url, String token, boolean mailruHeader) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("Accept", "application/json")
                .GET();
        /* У Mail.ru заголовок именно такой: «Bearer: токен». Привычный
           Authorization: Bearer даёт 401 без пояснения. */
        if (mailruHeader) b.header("Bearer", token);
        else b.header("Authorization", "Bearer " + token);
        return send(b.build());
    }

    private JsonNode postForm(String url, String form, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(form, StandardCharsets.UTF_8));
        if (token != null) b.header("Authorization", "Bearer " + token);
        return send(b.build());
    }

    private JsonNode send(HttpRequest req) throws Exception {
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() / 100 != 2) {
            String body = res.body() == null ? "" : res.body();
            throw new IllegalStateException("HTTP " + res.statusCode() + ": "
                    + (body.length() > 300 ? body.substring(0, 300) : body));
        }
        return om.readTree(res.body());
    }

    /* --------------------------------------------------------------- запись */

    private void upsert(String source, String domain, LocalDate d,
                        Long sent, Long delivered, Long read, Long complaints,
                        BigDecimal spam, String domainRep, String ipRep,
                        BigDecimal spf, BigDecimal dkim, BigDecimal dmarc, String raw) {
        jdbc.update(
                "INSERT INTO channel.t_postmaster_daily (source, domain, stat_date, sent, delivered," +
                "        read_count, complaints, spam_rate, domain_reputation, ip_reputation," +
                "        spf_ratio, dkim_ratio, dmarc_ratio, raw)" +
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)" +
                " ON CONFLICT (source, domain, stat_date) DO UPDATE SET" +
                "    sent = EXCLUDED.sent, delivered = EXCLUDED.delivered," +
                "    read_count = EXCLUDED.read_count, complaints = EXCLUDED.complaints," +
                "    spam_rate = EXCLUDED.spam_rate, domain_reputation = EXCLUDED.domain_reputation," +
                "    ip_reputation = EXCLUDED.ip_reputation, spf_ratio = EXCLUDED.spf_ratio," +
                "    dkim_ratio = EXCLUDED.dkim_ratio, dmarc_ratio = EXCLUDED.dmarc_ratio," +
                "    raw = EXCLUDED.raw",
                source, domain, Date.valueOf(d), sent, delivered, read, complaints,
                spam, domainRep, ipRep, spf, dkim, dmarc, raw);
    }

    /* --------------------------------------------------------------- мелочи */

    private static LocalDate dateFromName(String name) {
        if (name == null) return null;
        int i = name.lastIndexOf('/');
        String tail = i < 0 ? name : name.substring(i + 1);
        if (tail.length() != 8) return parseDate(tail);
        try {
            return LocalDate.of(Integer.parseInt(tail.substring(0, 4)),
                    Integer.parseInt(tail.substring(4, 6)), Integer.parseInt(tail.substring(6, 8)));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static LocalDate parseDate(String s) {
        if (s == null || s.length() < 10) return null;
        try {
            return LocalDate.parse(s.substring(0, 10));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String firstText(JsonNode n, String... keys) {
        for (String k : keys) {
            String v = n.path(k).asText(null);
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    private static BigDecimal dec(JsonNode n, String key) {
        JsonNode v = n.path(key);
        return v.isMissingNode() || v.isNull() ? null : new BigDecimal(v.asText("0"));
    }

    private static Long lng(JsonNode n, String key) {
        JsonNode v = n.path(key);
        return v.isMissingNode() || v.isNull() ? null : v.asLong();
    }

    private static String str(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? null : s;
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }
}
