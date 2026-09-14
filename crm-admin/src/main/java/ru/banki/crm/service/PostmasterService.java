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
                "SELECT domain, domains, google_client_id, google_api_version," +
                "       google_client_secret IS NOT NULL AND google_client_secret <> '' AS google_secret_set," +
                "       google_refresh_token IS NOT NULL AND google_refresh_token <> '' AS google_token_set," +
                "       mailru_refresh_token IS NOT NULL AND mailru_refresh_token <> '' AS mailru_token_set," +
                "       mailru_access_token IS NOT NULL AND mailru_access_token <> '' AS mailru_access_set," +
                "       sync_enabled, last_sync_at, history_days, daily_days," +
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
                "   SET domains = coalesce(nullif(?, ''), domains)," +
                /* domain остаётся «первым из списка»: он лежит у каждой строки
                   метрик, и раздел показывает его по умолчанию. */
                "       domain = coalesce(nullif(?, ''), domain)," +
                "       google_client_id = coalesce(?, google_client_id)," +
                "       google_client_secret = coalesce(nullif(?, ''), google_client_secret)," +
                "       google_refresh_token = coalesce(nullif(?, ''), google_refresh_token)," +
                "       google_api_version = coalesce(nullif(?, ''), google_api_version)," +
                "       mailru_refresh_token = coalesce(nullif(?, ''), mailru_refresh_token)," +
                "       mailru_access_token = coalesce(nullif(?, ''), mailru_access_token)," +
                "       sync_enabled = coalesce(?, sync_enabled)," +
                "       history_days = coalesce(?, history_days)," +
                "       daily_days = coalesce(?, daily_days)," +
                "       timestamp_upd = now(), updated_by = ?" +
                " WHERE id = 1",
                str(body.get("domains")), firstDomain(body), str(body.get("googleClientId")),
                str(body.get("googleClientSecret")), cleanToken(str(body.get("googleRefreshToken")), "refresh_token"),
                version(body.get("googleApiVersion")),
                cleanToken(str(body.get("mailruRefreshToken")), "refresh_token"),
                cleanToken(str(body.get("mailruAccessToken")), "access_token"),
                body.get("syncEnabled") == null ? null : Boolean.valueOf(
                        Boolean.parseBoolean(String.valueOf(body.get("syncEnabled")))),
                days(body.get("historyDays"), 3650), days(body.get("dailyDays"), 365),
                CurrentUser.email());
        return settings();
    }

    /** Число дней в допустимых границах; мусор и пустое — «не менять». */
    private static Integer days(Object v, int max) {
        String s = str(v);
        if (s == null) return null;
        try {
            int n = Integer.parseInt(s.replaceAll("\\s", ""));
            return Math.max(1, Math.min(n, max));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private boolean hasData(String source) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM (SELECT 1 FROM channel.t_postmaster_daily WHERE source = ? LIMIT 1) x",
                Integer.class, source);
        return n != null && n > 0;
    }

    /** Глубина из настройки: history_days для полной загрузки, daily_days для ночной. */
    private int depth(String column, int fallback) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT " + column + " AS d FROM app.postmaster_connection WHERE id = 1");
        Object v = rows.isEmpty() ? null : rows.get(0).get("d");
        return v instanceof Number n ? n.intValue() : fallback;
    }

    /**
     * Полная загрузка — на глубину history_days. Сколько истории хранят постмастеры,
     * заранее не известно (Google срок не публикует), поэтому просим с запасом, а
     * приедет столько, сколько у них есть.
     */
    public Map<String, Object> refreshHistory() {
        LocalDate to = LocalDate.now();
        return refresh(to.minusDays(depth("history_days", 400)), to);
    }

    /** Первый домен списка — тот, что раздел откроет по умолчанию. */
    private static String firstDomain(Map<String, Object> body) {
        String raw = str(body.get("domains"));
        if (raw == null) return str(body.get("domain"));
        for (String part : raw.split("[,;\\s]+")) {
            String d = part.trim().toLowerCase();
            if (!d.isEmpty()) return d;
        }
        return null;
    }

    /** Незнакомое значение трактуем как «обе»: терять данные хуже, чем сходить дважды. */
    private static String version(Object v) {
        String s = str(v);
        if (s == null) return null;
        return ("v1".equals(s) || "v2".equals(s)) ? s : "both";
    }

    private Map<String, Object> secrets() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT domain, domains, google_client_id, google_client_secret, google_refresh_token," +
                "       google_api_version, mailru_refresh_token, mailru_access_token" +
                "  FROM app.postmaster_connection WHERE id = 1");
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /* ------------------------------------------------------------ метрики */

    /** Сохранённые метрики за период — то, что рисует раздел. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> stats(String source, String domain, LocalDate from, LocalDate to) {
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
        if (domain != null && !domain.isBlank()) {
            sql.append(" AND domain = ?");
            args.add(domain.trim().toLowerCase());
        }
        sql.append(" ORDER BY stat_date, source");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /**
     * Обновление из обеих систем. Ошибка одной не отменяет другую: если Mail.ru
     * молчит, данные Google всё равно должны обновиться, а раздел — показать, что
     * именно не получилось.
     */
    /**
     * Обновление. Источники полностью независимы: настроенный Mail.ru должен
     * обновляться, даже если доступов Google ещё нет, и наоборот.
     *
     * <p>Транзакции здесь нет намеренно. Во-первых, внутри длинныеHTTP-походы
     * наружу, и держать на них соединение с базой незачем. Во-вторых, общая
     * транзакция связывала источники: стоило одному упасть на записи, как она
     * помечалась rollback-only и следующий источник падал уже на ровном месте —
     * снаружи это выглядело как «ничего не тянется».
     */
    public Map<String, Object> refresh(Integer days) {
        int span = (days == null || days < 1 || days > 400) ? DEFAULT_DAYS : days;
        LocalDate to = LocalDate.now();
        return refresh(to.minusDays(span), to);
    }

    /**
     * Обновление за конкретный период — им пользуется раздел, где период выбирает
     * человек. Глубина не бесконечна: Google хранит около 90 дней, Mail.ru тоже
     * отдаёт ограниченное окно, поэтому просьба «за три года» вернёт столько,
     * сколько есть, а не ошибку.
     */
    public Map<String, Object> refresh(LocalDate from, LocalDate to) {
        Map<String, Object> cfg = secrets();
        List<String> domains = domainList(cfg);
        if (to == null) to = LocalDate.now();
        if (from == null) from = to.minusDays(DEFAULT_DAYS);
        if (from.isAfter(to)) { LocalDate t = from; from = to; to = t; }
        final LocalDate f = from, t2 = to;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("domains", domains);
        out.put("from", f.toString());
        out.put("to", t2.toString());
        /* Домены обходим внутри источника, а не наоборот: статус подключения один
           на систему, и разбивать его по доменам значило бы путать «нет доступа»
           с «этот домен не подтверждён». */
        out.put("google", googleReady(cfg)
                ? runSource("google", () -> {
                      int n = 0;
                      for (String d : domains) n += loadGoogle(cfg, d, f, t2);
                      return n;
                  })
                : skipped("google", "доступы Google не заполнены"));
        out.put("mailru", mailruReady(cfg)
                ? runSource("mailru", () -> {
                      int n = 0;
                      for (String d : domains) n += loadMailru(cfg, d, f, t2);
                      return n;
                  })
                : skipped("mailru", "доступы Mail.ru не заполнены"));
        return out;
    }

    /**
     * Домены из настройки: список через запятую или перевод строки. Пустой список
     * означает, что не задано ничего, — тогда ходить некуда, и лучше вернуть пусто,
     * чем спрашивать постмастеры про домен с пустым именем.
     */
    private static List<String> domainList(Map<String, Object> cfg) {
        String raw = str(cfg.get("domains"));
        if (raw == null) raw = str(cfg.get("domain"));
        if (raw == null) return List.of();
        List<String> out = new ArrayList<>();
        for (String part : raw.split("[,;\\s]+")) {
            String d = part.trim().toLowerCase();
            if (!d.isEmpty() && !out.contains(d)) out.add(d);
        }
        return out;
    }

    /** Домены для выпадающего списка в разделе: и настроенные, и те, по которым уже есть данные. */
    @Transactional(readOnly = true)
    public List<String> domains() {
        List<String> out = new ArrayList<>(domainList(secrets()));
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT DISTINCT domain FROM channel.t_postmaster_daily ORDER BY domain")) {
            String d = str(r.get("domain"));
            /* Домен могли убрать из настройки, а метрики по нему остались — прятать
               их незачем, иначе история пропадёт вместе с опечаткой в настройке. */
            if (d != null && !out.contains(d)) out.add(d);
        }
        return out;
    }

    private static boolean googleReady(Map<String, Object> cfg) {
        return str(cfg.get("google_client_id")) != null
            && str(cfg.get("google_client_secret")) != null
            && str(cfg.get("google_refresh_token")) != null;
    }

    private static boolean mailruReady(Map<String, Object> cfg) {
        return str(cfg.get("mailru_access_token")) != null
            || str(cfg.get("mailru_refresh_token")) != null;
    }

    /**
     * Источник не настроен — это не поломка, а «ещё не подключили». Статус в базе
     * не трогаем: иначе экран показывал бы красную ошибку у системы, которую никто
     * и не собирался подключать, и на её фоне терялась бы настоящая.
     */
    private Map<String, Object> skipped(String source, String why) {
        jdbc.update("UPDATE app.postmaster_connection SET " + col(source) + "_status = 'off'," +
                    " " + col(source) + "_error = NULL WHERE id = 1");
        return Map.of("ok", false, "skipped", true, "error", why);
    }

    private static String col(String source) {
        return "google".equals(source) ? "google" : "mailru";
    }

    private interface Loader { int load() throws Exception; }

    /** Общая обвязка: посчитать, записать статус, не дать упасть всему обновлению. */
    private Map<String, Object> runSource(String source, Loader loader) {
        String col = col(source);
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
        String access = cleanToken(str(cfg.get("mailru_access_token")), "access_token");
        String refresh = str(cfg.get("mailru_refresh_token"));
        if (access == null && refresh == null) {
            throw new IllegalStateException("Не заполнены токены Mail.ru Postmaster");
        }
        if (access == null) {
            access = mailruAccessFromRefresh(refresh);
        }

        /* Имена параметров именно такие: date_from / date_to. С привычными from/to
           сервис отвечает 403 с пустым телом — не «неверный параметр», а «нет
           доступа», и искать причину приходится в токенах, где её нет. */
        String url = MAILRU_API + "/ext-api/stat-list-detailed/?domain=" + enc(domain)
                + "&date_from=" + from + "&date_to=" + to;
        JsonNode root = null;
        Exception last = null;
        /* Отказ у Mail.ru приходит и как 401, и как 403 — по коду не понять,
           протух ли токен. Поэтому при любом из них обновляем access, если есть
           чем, и пробуем ещё раз. */
        for (int attempt = 0; attempt < 2 && root == null; attempt++) {
            if (attempt == 1) {
                if (refresh == null) break;
                access = mailruAccessFromRefresh(refresh);
                jdbc.update("UPDATE app.postmaster_connection SET mailru_access_token = ? WHERE id = 1", access);
            }
            try {
                root = getJson(url, access, true);
            } catch (Exception e) {
                last = e;
                if (!denied(e)) throw e;
            }
        }
        if (root == null) {
            /* Заголовок у Mail.ru нестандартный («Bearer: токен»), и если однажды
               его приведут к общему виду, отказ будет выглядеть точно так же.
               Прежде чем сдаться, пробуем привычное написание. */
            try {
                root = getJson(url, access, false);
            } catch (Exception e) {
                throw new IllegalStateException(mailruWhy(access, last == null ? e : last));
            }
        }

        /* Ответ двухуровневый: {"ok": true, "data": [{"domain": …, "data": [дни]}]}.
           Внешний уровень — домены (их может быть несколько, если запрос без
           фильтра), внутренний — дни. Разбор по внешнему массиву как по дням
           давал ноль записей: поля date там нет, и каждая строка молча
           пропускалась. */
        JsonNode domains = root.has("data") ? root.get("data") : root;
        if (domains == null || !domains.isArray()) {
            return 0;
        }
        List<JsonNode> days = new ArrayList<>();
        for (JsonNode dom : domains) {
            JsonNode inner = dom.path("data");
            if (inner.isArray()) {
                inner.forEach(days::add);
            } else if (dom.has("date")) {
                days.add(dom);   /* на случай плоского ответа — вдруг вернут так */
            }
        }

        int n = 0;
        for (JsonNode s : days) {
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

    private static boolean denied(Exception e) {
        String m = String.valueOf(e.getMessage());
        return m.contains("HTTP 401") || m.contains("HTTP 403");
    }

    /**
     * Почему Mail.ru отказал. По коду это не отличить: и «токен не той учётки», и
     * «домен не подтверждён» дают одинаковый 403 без тела. Зато список доменов
     * токен отдаёт отдельным методом — спрашиваем его и говорим прямо, что видно.
     */
    private String mailruWhy(String access, Exception cause) {
        String base = cause.getMessage() == null ? cause.toString() : cause.getMessage();
        try {
            JsonNode reg = getJson(MAILRU_API + "/ext-api/reg-list/", access, true);
            List<String> domains = new ArrayList<>();
            JsonNode data = reg.has("data") ? reg.get("data") : reg;
            if (data.isArray()) {
                for (JsonNode d : data) {
                    String name = d.isTextual() ? d.asText() : firstText(d, "domain", "name");
                    if (name != null) domains.add(name);
                }
            }
            return base + (domains.isEmpty()
                    ? " · токен работает, но подтверждённых доменов у этой учётки нет"
                    : " · токену доступны домены: " + String.join(", ", domains)
                      + " — нужный должен быть в этом списке");
        } catch (Exception second) {
            /* Даже список доменов не отдали — дело в самом токене, а не в домене. */
            return base + " · список доменов тоже недоступен (" +
                   (second.getMessage() == null ? second.toString() : second.getMessage()) +
                   ") — похоже, токен недействителен или выдан другой учётке";
        }
    }

    private String mailruAccessFromRefresh(String refresh) throws Exception {
        String token = cleanToken(refresh, "refresh_token");
        if (token == null) {
            throw new IllegalStateException("refresh-токен Mail.ru пуст после очистки — впишите его заново");
        }
        JsonNode t;
        try {
            t = postForm(MAILRU_TOKEN,
                    "client_id=" + MAILRU_CLIENT + "&grant_type=refresh_token&refresh_token=" + enc(token),
                    null);
        } catch (IllegalStateException e) {
            /* Токен-эндпоинт отвечает на отказ кодом 400 с JSON в теле — достаём его,
               чтобы сообщение ниже разобрало причину, а не показало голый код. */
            String m = String.valueOf(e.getMessage());
            int brace = m.indexOf('{'), end = m.lastIndexOf('}');
            try {
                t = (brace >= 0 && end > brace) ? om.readTree(m.substring(brace, end + 1)) : null;
            } catch (Exception parse) {
                t = null;   /* тело обрезано или не JSON — отдадим исходную ошибку */
            }
            if (t == null) throw e;
        }
        String access = t.path("access_token").asText(null);
        if (access == null) {
            throw new IllegalStateException(mailruTokenWhy(t));
        }
        return access;
    }

    /**
     * Почему o2.mail.ru не обменял refresh-токен. Запрос у нас ровно тот, что в их
     * документации, поэтому отказ почти всегда означает само значение токена — и
     * человеку нужно сказать, что с ним делать, а не пересказывать спецификацию OAuth.
     */
    private static String mailruTokenWhy(JsonNode t) {
        String err = t.path("error").asText("");
        String base = "Mail.ru не принял refresh-токен (" + (err.isEmpty() ? t.toString() : err) + ")";
        if ("invalid_request".equals(err) || "invalid_grant".equals(err)) {
            return base + ": значение токена неверное или он перевыпущен. Получите новую пару по ссылке"
                 + " https://o2.mail.ru/login?client_id=postmaster_api_client&response_type=code"
                 + "&state=crm&redirect_uri=https%3A%2F%2Fpostmaster.mail.ru%2Fext-api%2Foauth%2F"
                 + " и впишите refresh_token из ответа. Если токены получали заново для другого контура,"
                 + " впишите одну и ту же свежую пару на всех контурах: старый refresh после перевыпуска"
                 + " может перестать работать.";
        }
        return base;
    }

    /**
     * Токен, очищенный от того, что налипает при копировании. Страница выдачи у
     * Mail.ru отдаёт JSON, и в поле легко уходит целиком
     * {"access_token":"…","refresh_token":"…"} или значение в кавычках и с переводом
     * строки. Сервис на такое отвечает invalid_request без подсказки, что именно
     * не так. Сами токены пробелов и кавычек не содержат, поэтому их выкидываем, а
     * из вставленного JSON берём нужное поле.
     */
    private String cleanToken(String raw, String jsonKey) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.startsWith("{")) {
            try {
                String v = om.readTree(s).path(jsonKey).asText(null);
                if (v != null) s = v;
            } catch (Exception ignored) {
                /* не JSON — чистим как обычную строку */
            }
        }
        s = s.replaceAll("[\"'\\s]", "");
        return s.isEmpty() ? null : s;
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
        /* Если по подключённой системе ещё нет ни одной строки, это первый запуск
           после подключения — догоняем историю на всю настроенную глубину. Иначе
           новый кабинет месяцами показывал бы только последнюю неделю, пока кто-то
           не догадается нажать «Загрузить всю историю». */
        boolean catchUp = (google && !hasData("google")) || (mailru && !hasData("mailru"));
        if (catchUp) {
            refreshHistory();
        } else {
            refresh(depth("daily_days", 7));
        }
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
            String body = res.body() == null ? "" : res.body().trim();
            /* Постмастеры часто отвечают кодом без тела, и голое «HTTP 403»
               отправляет искать причину в токенах, где её может не быть. Поэтому
               добавляем адрес (он безопасен — токен идёт заголовком) и подсказку
               по самому частому смыслу кода. */
            String hint = switch (res.statusCode()) {
                case 401 -> "токен недействителен или истёк";
                case 403 -> "доступ закрыт: проверьте, что домен подтверждён в кабинете"
                          + " и токен выдан учётке, которая его видит";
                case 429 -> "слишком часто: у Mail.ru не больше 10 запросов в минуту";
                default -> null;
            };
            throw new IllegalStateException("HTTP " + res.statusCode()
                    + (hint == null ? "" : " — " + hint)
                    + (body.isEmpty() ? "" : ": " + (body.length() > 300 ? body.substring(0, 300) : body))
                    + " [" + hideQueryToken(req.uri().toString()) + "]");
        }
        return om.readTree(res.body());
    }

    /** На всякий случай: в адресе токена быть не должно, но ошибка уходит на экран. */
    private static String hideQueryToken(String url) {
        return url.replaceAll("(?i)(token|secret)=[^&]*", "$1=…");
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
