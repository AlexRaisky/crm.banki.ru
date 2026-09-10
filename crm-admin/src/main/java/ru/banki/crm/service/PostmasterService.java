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
 * <p>Google поддержан в двух версиях, и по умолчанию мы ходим в обе: v1
 * ({@code domains/{домен}/trafficStats}) отдаёт историю трафика по дням, v2
 * ({@code domainStats.query} и {@code getComplianceStatus}) — статус SPF, DKIM и
 * DMARC. Версии дополняют друг друга, поэтому режим {@code both} и стоит
 * настройкой по умолчанию; ошибка одной не отменяет данные другой — у части
 * кабинетов v2 просто недоступен.
 *
 * <p>Mail.ru: access-токен живёт час. Его можно вписать руками — это выручает,
 * когда refresh выдать не могут, — но пока refresh заполнен, протухший access
 * обновляется сам. Заголовок у них нестандартный: {@code Bearer: <токен>}
 * вместо {@code Authorization: Bearer <токен>}, и с привычным написанием сервис
 * отвечает 401 без пояснений.
 *
 * <p>Раз в сутки метрики забираются сами ({@link #dailySync()}): раньше они
 * появлялись, только если кто-то нажал кнопку.
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
                "       mailru_access_token IS NOT NULL AND mailru_access_token <> '' AS mailru_access_set," +
                "       sync_enabled, last_sync_at," +
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
                "       mailru_access_token = coalesce(nullif(?, ''), mailru_access_token)," +
                "       sync_enabled = coalesce(?, sync_enabled)," +
                "       timestamp_upd = now(), updated_by = ?" +
                " WHERE id = 1",
                str(body.get("domain")), str(body.get("googleClientId")),
                str(body.get("googleClientSecret")), str(body.get("googleRefreshToken")),
                version(body.get("googleApiVersion")),
                str(body.get("mailruRefreshToken")), str(body.get("mailruAccessToken")),
                body.get("syncEnabled") == null ? null : Boolean.valueOf(
                        Boolean.parseBoolean(String.valueOf(body.get("syncEnabled")))),
                CurrentUser.email());
        return settings();
    }

    /** Незнакомое значение трактуем как «обе»: терять данные хуже, чем сходить дважды. */
    private static String version(Object v) {
        String s = str(v);
        if (s == null) return null;
        return ("v1".equals(s) || "v2".equals(s)) ? s : "both";
    }

    private Map<String, Object> secrets() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT domain, google_client_id, google_client_secret, google_refresh_token," +
                "       google_api_version, mailru_refresh_token, mailru_access_token" +
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
                "       spam_rate, domain_reputation, ip_reputation, spf_ratio, dkim_ratio, dmarc_ratio," +
                "       spf_status, dkim_status, dmarc_status" +
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

    /**
     * Google. Режим {@code both} ходит в обе версии: v1 отдаёт историю трафика по
     * дням, v2 — статус SPF/DKIM/DMARC. Ответы дополняют друг друга и складываются
     * в одну строку дня, поэтому выбор «или-или» означал бы терять половину картины.
     *
     * <p>Ошибка одной версии не отменяет другую: у части кабинетов v2 недоступен, и
     * ронять из-за этого весь сбор нельзя. Если не ответила ни одна — ошибка уходит
     * наверх, иначе «обновилось» показывалось бы при пустом результате.
     */
    private int loadGoogle(Map<String, Object> cfg, String domain, LocalDate from, LocalDate to)
            throws Exception {
        String token = googleAccessToken(cfg);
        String mode = str(cfg.get("google_api_version"));
        boolean both = "both".equals(mode);
        int n = 0;
        Exception firstError = null;

        if (both || !"v2".equals(mode)) {
            try { n += loadGoogleV1(token, domain, from, to); }
            catch (Exception e) { firstError = e; }
        }
        if (both || "v2".equals(mode)) {
            try { n += loadGoogleV2(token, domain, from, to); }
            catch (Exception e) { if (firstError == null) firstError = e; else n += 0; }
        }
        if (n == 0 && firstError != null) {
            throw firstError;
        }
        return n;
    }

    private int loadGoogleV1(String token, String domain, LocalDate from, LocalDate to)
            throws Exception {
        JsonNode root = getJson(GOOGLE_API + "/v1/domains/" + enc(domain) + "/trafficStats"
                + "?startDate.year=" + from.getYear()
                + "&startDate.month=" + from.getMonthValue()
                + "&startDate.day=" + from.getDayOfMonth()
                + "&endDate.year=" + to.getYear()
                + "&endDate.month=" + to.getMonthValue()
                + "&endDate.day=" + to.getDayOfMonth(), token, false);
        JsonNode list = root.path("trafficStats");
        if (!list.isArray()) {
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
                    null, null, null,
                    s.toString());
            n++;
        }
        return n;
    }

    private int loadGoogleV2(String token, String domain, LocalDate from, LocalDate to)
            throws Exception {
        int n = 0;
        JsonNode root = getJson(GOOGLE_API + "/v2/domains/" + enc(domain) + "/domainStats:query"
                + "?startDate=" + from + "&endDate=" + to, token, false);
        JsonNode list = root.has("domainStats") ? root.get("domainStats") : root.path("stats");
        if (list.isArray()) {
            for (JsonNode s : list) {
                LocalDate d = dateFromName(s.path("name").asText(null));
                if (d == null) d = parseDate(s.path("date").asText(null));
                if (d == null) continue;
                upsert("google", domain, d,
                        null, null, null, null,
                        dec(s, "userReportedSpamRatio"),
                        s.path("domainReputation").asText(null),
                        worstIpReputation(s),
                        dec(s, "spfSuccessRatio"), dec(s, "dkimSuccessRatio"), dec(s, "dmarcSuccessRatio"),
                        null, null, null,
                        s.toString());
                n++;
            }
        }
        /* Статус проверок подлинности — не история, а состояние DNS на сейчас.
           Пишем его в сегодняшнюю строку: так он виден рядом с долями за день. */
        try {
            JsonNode c = getJson(GOOGLE_API + "/v2/domains/" + enc(domain) + ":getComplianceStatus",
                    token, false);
            upsert("google", domain, to,
                    null, null, null, null, null, null, null, null, null, null,
                    statusOf(c, "spf"), statusOf(c, "dkim"), statusOf(c, "dmarc"),
                    c.toString());
            if (n == 0) n = 1;
        } catch (Exception ignored) {
            /* Метод есть не во всех кабинетах — история трафика важнее, её уже забрали. */
        }
        return n;
    }

    /** Статус может прийти строкой или объектом со своим полем — берём и то и другое. */
    private static String statusOf(JsonNode root, String key) {
        JsonNode n = root.path(key + "ComplianceStatus");
        if (n.isMissingNode() || n.isNull()) n = root.path(key);
        if (n.isMissingNode() || n.isNull()) return null;
        if (n.isTextual()) return n.asText();
        String s = n.path("status").asText(null);
        return s != null ? s : n.toString();
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
        String access = str(cfg.get("mailru_access_token"));
        String refresh = str(cfg.get("mailru_refresh_token"));
        if (access == null && refresh == null) {
            throw new IllegalStateException("Не заполнены токены Mail.ru Postmaster");
        }
        if (access == null) {
            access = mailruAccessFromRefresh(refresh);
        }

        String url = MAILRU_API + "/ext-api/stat-list-detailed/?domain=" + enc(domain)
                + "&from=" + from + "&to=" + to;
        JsonNode root;
        try {
            root = getJson(url, access, true);
        } catch (Exception e) {
            /* Вписанный руками access живёт час. Когда он протух, ответ — 401, и
               единственный способ продолжить без человека: обменять refresh и
               заодно сохранить свежий access, чтобы следующий заход не начинался
               с ошибки. Нет refresh — сказать об этом прямо. */
            if (refresh == null || !String.valueOf(e.getMessage()).contains("401")) {
                throw e;
            }
            access = mailruAccessFromRefresh(refresh);
            jdbc.update("UPDATE app.postmaster_connection SET mailru_access_token = ? WHERE id = 1", access);
            root = getJson(url, access, true);
        }

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
                    null, null, null,
                    s.toString());
            n++;
        }
        return n;
    }

    private String mailruAccessFromRefresh(String refresh) throws Exception {
        JsonNode t = postForm(MAILRU_TOKEN,
                "client_id=" + MAILRU_CLIENT + "&grant_type=refresh_token&refresh_token=" + enc(refresh),
                null);
        String access = t.path("access_token").asText(null);
        if (access == null) {
            throw new IllegalStateException("Mail.ru не выдал access_token: " + t);
        }
        return access;
    }

    /**
     * Ежедневный сбор. Раньше метрики появлялись, только если кто-то нажал кнопку, —
     * а вопрос «когда поехала репутация» задают как раз тогда, когда никто не нажимал.
     *
     * <p>Ночью, потому что оба постмастера отдают данные за прошедшие сутки с
     * задержкой. Берём окно шире одного дня: пропущенный из-за недоступности день
     * тогда подхватится следующим запуском сам.
     */
    @org.springframework.scheduling.annotation.Scheduled(cron = "${app.postmaster.cron:0 20 5 * * *}")
    public void dailySync() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT sync_enabled FROM app.postmaster_connection WHERE id = 1");
        if (rows.isEmpty() || !Boolean.TRUE.equals(rows.get(0).get("sync_enabled"))) {
            return;
        }
        Map<String, Object> cfg = secrets();
        boolean google = str(cfg.get("google_refresh_token")) != null;
        boolean mailru = str(cfg.get("mailru_access_token")) != null
                      || str(cfg.get("mailru_refresh_token")) != null;
        if (!google && !mailru) {
            return;   /* доступы не заведены — ходить некуда, шуметь ошибкой незачем */
        }
        refresh(7);
        jdbc.update("UPDATE app.postmaster_connection SET last_sync_at = now() WHERE id = 1");
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

    /**
     * Запись дня. Пустые значения НЕ затирают уже сохранённые: в режиме both за один
     * день приходят два ответа — трафик из v1 и статус проверок из v2, — и обычный
     * перезаписывающий upsert стирал бы то, чего нет во втором ответе.
     */
    private void upsert(String source, String domain, LocalDate d,
                        Long sent, Long delivered, Long read, Long complaints,
                        BigDecimal spam, String domainRep, String ipRep,
                        BigDecimal spf, BigDecimal dkim, BigDecimal dmarc,
                        String spfStatus, String dkimStatus, String dmarcStatus, String raw) {
        jdbc.update(
                "INSERT INTO channel.t_postmaster_daily (source, domain, stat_date, sent, delivered," +
                "        read_count, complaints, spam_rate, domain_reputation, ip_reputation," +
                "        spf_ratio, dkim_ratio, dmarc_ratio, spf_status, dkim_status, dmarc_status, raw)" +
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)" +
                " ON CONFLICT (source, domain, stat_date) DO UPDATE SET" +
                "    sent = coalesce(EXCLUDED.sent, channel.t_postmaster_daily.sent)," +
                "    delivered = coalesce(EXCLUDED.delivered, channel.t_postmaster_daily.delivered)," +
                "    read_count = coalesce(EXCLUDED.read_count, channel.t_postmaster_daily.read_count)," +
                "    complaints = coalesce(EXCLUDED.complaints, channel.t_postmaster_daily.complaints)," +
                "    spam_rate = coalesce(EXCLUDED.spam_rate, channel.t_postmaster_daily.spam_rate)," +
                "    domain_reputation = coalesce(EXCLUDED.domain_reputation, channel.t_postmaster_daily.domain_reputation)," +
                "    ip_reputation = coalesce(EXCLUDED.ip_reputation, channel.t_postmaster_daily.ip_reputation)," +
                "    spf_ratio = coalesce(EXCLUDED.spf_ratio, channel.t_postmaster_daily.spf_ratio)," +
                "    dkim_ratio = coalesce(EXCLUDED.dkim_ratio, channel.t_postmaster_daily.dkim_ratio)," +
                "    dmarc_ratio = coalesce(EXCLUDED.dmarc_ratio, channel.t_postmaster_daily.dmarc_ratio)," +
                "    spf_status = coalesce(EXCLUDED.spf_status, channel.t_postmaster_daily.spf_status)," +
                "    dkim_status = coalesce(EXCLUDED.dkim_status, channel.t_postmaster_daily.dkim_status)," +
                "    dmarc_status = coalesce(EXCLUDED.dmarc_status, channel.t_postmaster_daily.dmarc_status)," +
                "    raw = coalesce(EXCLUDED.raw, channel.t_postmaster_daily.raw)",
                source, domain, Date.valueOf(d), sent, delivered, read, complaints,
                spam, domainRep, ipRep, spf, dkim, dmarc,
                spfStatus, dkimStatus, dmarcStatus, raw);
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
