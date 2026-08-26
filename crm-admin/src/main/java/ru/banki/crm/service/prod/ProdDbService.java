package ru.banki.crm.service.prod;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import ru.banki.crm.service.UnifiedTemplateService;
import ru.banki.crm.service.UnifiedTemplateService.ChannelTable;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Подключение к ВНЕШНЕЙ прод-БД (схемы notice/callcenter, таблицы 1:1 с нашими)
 * и доставка операций очереди app.prod_sync.
 *
 * Собственный маленький Hikari-пул (НЕ спринговый бин DataSource — чтобы не мешать
 * автоконфигурации основной БД). Прод не настроен (PROD_DB_URL пуст) — сервис пассивен.
 *
 * Коды при INSERT назначает прод (max+1 в его транзакции, как делала старая админка);
 * исключение — КЦ: segment бизнес-ключ и едет как есть.
 */
@Service
public class ProdDbService {

    private static final Logger log = LoggerFactory.getLogger(ProdDbService.class);

    // env — ТОЛЬКО для одноразового сида строки-приёмника при первом старте (миграция с env).
    // Дальше источник истины — строка app.db_connection с флагом is_prod_sync.
    @Value("${app.proddb.url:}")
    private String seedUrl;
    @Value("${app.proddb.user:}")
    private String seedUser;
    @Value("${app.proddb.password:}")
    private String seedPassword;

    /** Таймаут установления соединения, мс (PROD_DB_CONNECT_TIMEOUT_MS). */
    @Value("${app.proddb.connect-timeout-ms:20000}")
    private long connectTimeoutMs;

    /** Часовой пояс сессии прод-соединения: метки времени пишем/читаем в UTC+3. */
    @Value("${app.proddb.time-zone:Europe/Moscow}")
    private String prodTimeZone;

    private final ObjectMapper om;
    private final JdbcTemplate jdbc;

    private volatile HikariDataSource ds;
    private volatile String dsSig;   // сигнатура (url|user|pass) текущего пула — для пересборки при правке

    /** Кеш «канал → обязательные колонки прода»: схема меняется редко, дёргать её на каждое
        сохранение шаблона незачем. Сбрасывается при смене приёмника (requiredCacheSig). */
    private final Map<String, java.util.Set<String>> requiredCache = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile String requiredCacheSig;

    public ProdDbService(ObjectMapper om, JdbcTemplate jdbc) {
        this.om = om;
        this.jdbc = jdbc;
    }

    /** Настройки прод-приёмника (url/user/pass). */
    private record Cfg(String url, String user, String password) {}

    /** Активная строка-приёмник синка из реестра, либо null. */
    private Cfg config() {
        try {
            return jdbc.query(
                    "SELECT jdbc_url, username, password FROM app.db_connection " +
                    "WHERE is_prod_sync AND is_active LIMIT 1",
                    rs -> rs.next() ? new Cfg(rs.getString(1), rs.getString(2), rs.getString(3)) : null);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Одноразовый сид строки-приёмника из env, если её ещё нет. Нужен, чтобы при переезде
     * с env на реестр синк не сломался: на первом старте с заданным PROD_DB_URL создаём
     * строку в app.db_connection. После этого env можно убрать — строка остаётся.
     */
    @EventListener(ApplicationReadyEvent.class)
    void seedFromEnv() {
        if (seedUrl == null || seedUrl.isBlank()) return;
        try {
            Integer n = jdbc.queryForObject(
                    "SELECT count(*) FROM app.db_connection WHERE is_prod_sync", Integer.class);
            if (n != null && n > 0) return;   // приёмник уже есть — env не трогаем
            jdbc.update(
                    "INSERT INTO app.db_connection (name, jdbc_url, username, password, purpose, is_active, is_prod_sync, created_by) " +
                    "VALUES (?, ?, ?, ?, ?, true, true, 'env-bootstrap') ON CONFLICT (name) DO NOTHING",
                    "prod", seedUrl, blankNull(seedUser), blankNull(seedPassword),
                    "Внешняя прод-база (приёмник синка). Заведено из env при миграции — env можно убрать.");
        } catch (Exception ignore) {
            // на очень раннем старте таблицы может ещё не быть — не критично, сид не обязателен
        }
    }

    public boolean configured() {
        Cfg c = config();
        return c != null && c.url() != null && !c.url().isBlank();
    }

    private HikariDataSource ds() {
        Cfg c = config();
        if (c == null || c.url() == null || c.url().isBlank()) {
            throw new IllegalStateException("Прод-приёмник не настроен: нет активной строки is_prod_sync в app.db_connection.");
        }
        String sig = c.url() + "\0" + blankNull(c.user()) + "\0" + blankNull(c.password());
        HikariDataSource local = ds;
        if (local != null && sig.equals(dsSig)) return local;   // конфиг не менялся — отдаём тот же пул
        synchronized (this) {
            if (ds == null || !sig.equals(dsSig)) {
                if (ds != null) { try { ds.close(); } catch (Exception ignore) {} ds = null; }
                HikariConfig cfg = new HikariConfig();
                cfg.setJdbcUrl(c.url());
                cfg.setUsername(c.user());
                cfg.setPassword(c.password());
                cfg.setMaximumPoolSize(2);
                cfg.setMinimumIdle(0);
                // канал до прода может идти через бастион/VPN — даём запас на рукопожатие
                cfg.setConnectionTimeout(connectTimeoutMs);
                cfg.addDataSourceProperty("connectTimeout", String.valueOf(connectTimeoutMs / 1000));
                cfg.addDataSourceProperty("loginTimeout", String.valueOf(connectTimeoutMs / 1000));
                cfg.addDataSourceProperty("socketTimeout", "60");
                cfg.setInitializationFailTimeout(-1); // пул создаётся даже при недоступном проде
                // Часовой пояс сессии — московский: now() при записи (timestamp_cr/upd) и чтение
                // меток идут в UTC+3, как и остальное в проде. Работает и для timestamp, и для
                // timestamptz: в первом случае пишется московское «стенное» время, во втором —
                // корректный момент, отображаемый как +03. Совпадает с hibernate.jdbc.time_zone.
                cfg.setConnectionInitSql("SET TIME ZONE '" + prodTimeZone + "'");
                cfg.setPoolName("prod-db");
                ds = new HikariDataSource(cfg);
                dsSig = sig;
            }
            return ds;
        }
    }

    private static String blankNull(String s) { return (s == null || s.isBlank()) ? null : s; }

    // ---------------------------------------------------------------- health
    /**
     * Проверка соединения: коннект, latency, наличие канальных таблиц.
     * <p>
     * Про ключи ответа. Успех обозначен сразу двумя — {@code reachable} и {@code ok}, и
     * это не небрежность. Исторически здесь был только первый, а у базы событий — только
     * второй; читатели же (карта интеграций, «Состояние системы») написаны под {@code ok}
     * и потому показывали живую прод-базу как «не отвечает». Ключи оставлены оба: убрать
     * {@code reachable} нельзя, его читает «Диагностика подключений».
     */
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        Cfg pc = config();
        boolean configured = pc != null && pc.url() != null && !pc.url().isBlank();
        out.put("configured", configured);
        if (!configured) {
            out.put("hint", "Заведи прод-подключение на «Диагностике» и отметь «приёмник синка».");
            return out;
        }
        long t0 = System.currentTimeMillis();
        try (Connection c = ds().getConnection()) {
            try (PreparedStatement ps = c.prepareStatement("SELECT 1"); ResultSet rs = ps.executeQuery()) {
                rs.next();
            }
            out.put("reachable", true);
            out.put("ok", true);
            out.put("url", pc.url());
            out.put("user", pc.user());
            out.put("latencyMs", System.currentTimeMillis() - t0);
            Map<String, Boolean> tables = new LinkedHashMap<>();
            for (String ch : List.of("sms", "push", "email", "cc", "fa", "vk", "la")) {
                ChannelTable ct = UnifiedTemplateService.channelTable(ch);
                String[] st = ct.table().split("\\.");
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT count(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = ?")) {
                    ps.setString(1, st[0]);
                    ps.setString(2, st[1]);
                    try (ResultSet rs = ps.executeQuery()) {
                        rs.next();
                        tables.put(ct.table(), rs.getInt(1) > 0);
                    }
                }
            }
            out.put("tables", tables);
        } catch (Exception e) {
            out.put("reachable", false);
            out.put("ok", false);
            // у Hikari верхнее сообщение — «request timed out»; настоящая причина в cause
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) root = root.getCause();
            out.put("error", String.valueOf(e.getMessage()));
            if (root != e && root.getMessage() != null) out.put("cause", root.getMessage());
            out.put("url", pc.url());
            out.put("user", pc.user());
        }
        return out;
    }

    // ---------------------------------------------------------------- deliver
    /**
     * Применить одну операцию очереди к прод-БД. Возвращает код строки в проде
     * (для INSERT — присвоенный продом; для UPDATE/DELETE — переданный localCode).
     */
    public long apply(String channel, String operation, long localCode, String payloadJson, String actor) throws Exception {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) throw new IllegalArgumentException("Неизвестный канал: " + channel);
        try (Connection c = ds().getConnection()) {
            c.setAutoCommit(false);
            try {
                markActor(c, actor);   // прод-триггеры аудита читают app.current_user
                long result = switch (operation) {
                    case "INSERT" -> {
                        long assigned = insert(c, ct, localCode, payloadJson);
                        smsTypeEnsure(c, channel, assigned);
                        smsApprovedEnsure(c, channel, assigned);
                        yield assigned;
                    }
                    case "UPDATE" -> {
                        int n = update(c, ct, localCode, payloadJson);
                        // строки в проде нет (исторически не доехала) — превращаем в INSERT
                        long assigned = n > 0 ? localCode : insert(c, ct, localCode, payloadJson);
                        smsTypeEnsure(c, channel, assigned);
                        /* И при правке тоже: у шаблонов, уехавших до появления этой таблицы,
                           строки согласования нет вовсе — правка их дозаведёт. Уже
                           заполненную строку вызов не трогает. */
                        smsApprovedEnsure(c, channel, assigned);
                        yield assigned;
                    }
                    case "DELETE" -> {
                        // спутник — ПЕРЕД шаблоном: он ссылается на него template_code'ом,
                        // и обратный порядок упёрся бы во внешний ключ, будь он там заведён
                        smsTypeDelete(c, channel, localCode);
                        try (PreparedStatement ps = c.prepareStatement(
                                "DELETE FROM " + ct.table() + " WHERE " + ct.codeCol() + " = ?")) {
                            ps.setLong(1, localCode);
                            ps.executeUpdate();
                        }
                        yield localCode;
                    }
                    default -> throw new IllegalArgumentException("Неизвестная операция: " + operation);
                };
                c.commit();
                return result;
            } catch (Exception e) {
                c.rollback();
                throw e;
            }
        }
    }

    // ------------------------------------------------------- спутник sms-шаблона

    /* Тип отправки для sms: одна строка на шаблон в notice.d_com_sms_type.
       Все поля кроме кода постоянные — у коммуникаций CRM тип отправки всегда один,
       и меняются только code и template_code. Держим их здесь, рядом с SQL, а не в
       конфигурации: это не настройка, а форма записи, которую ждёт прод. */
    private static final String SMS_TYPE = "notice.d_com_sms_type";
    private static final String SMS_TYPE_BRIEF = "SendSplashUrl";
    private static final String SMS_TYPE_NAME = "отправка смс CRM";
    private static final String SMS_TYPE_SENDER = "Banki.ru";

    /**
     * Завести спутника sms-шаблона, если его ещё нет.
     * <p>
     * code и template_code равны коду шаблона В ПРОДЕ — не нашему: при вставке код
     * присваивает прод (см. {@link #insert}), и взять локальный значило бы сослаться
     * на чужую строку.
     * <p>
     * Зовём и при обновлении: проверка «нет — создать» идемпотентна, а у шаблонов,
     * уехавших до появления этого правила, спутника нет вовсе — правка их дозаведёт.
     * Существующую строку не трогаем: её могли поправить руками в проде, и затирать
     * такую правку доставкой шаблона мы не вправе.
     */
    private void smsTypeEnsure(Connection c, String channel, long code) throws Exception {
        if (!"sms".equals(channel)) return;
        String sql = "INSERT INTO " + SMS_TYPE
                + " (code, brief, \"name\", sender_name, priority, timeout, time_from, time_to, template_code)"
                + " SELECT ?, ?, ?, ?, 1, 60000, TIME '00:00:00', TIME '23:59:59', ?"
                + " WHERE NOT EXISTS (SELECT 1 FROM " + SMS_TYPE + " WHERE code = ?)";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, code);
            ps.setString(2, SMS_TYPE_BRIEF);
            ps.setString(3, SMS_TYPE_NAME);
            ps.setString(4, SMS_TYPE_SENDER);
            ps.setLong(5, code);
            ps.setLong(6, code);
            ps.executeUpdate();
        }
    }

    // ------------------------------------------------- согласование текста у операторов

    /* Второй спутник sms-шаблона: текст в том виде, в каком его согласовывают сотовые
       операторы. Строка на шаблон в notice.d_com_sms_approved_template, флаги
       approved_* проставляют люди по итогам согласования — мы их не трогаем никогда.

       Разложение — ровно две замены, и обе живут ЗДЕСЬ, одной строкой на оба пути
       (заведение нового шаблона и разовая доливка существующих записей). Разъехавшись,
       эти два пути дали бы операторам два разных текста под одним согласованием.

       1) ##любая_переменная## -> %w. Именно %w, а не %d: он покрывает буквы, цифры и
          спецсимволы, то есть верен и для имени, и для суммы. В значения переменных
          не смотрим — по имени переменной её содержимое всё равно не угадать.
       2) Короткая ссылка banki.ru/q/XXXX -> banki.ru/q/%w. Домен и путь остаются
          текстом: оператор при согласовании смотрит именно на то, куда ведёт ссылка,
          и шаблон, где вместо неё голое %w, вызывает больше вопросов, а не меньше.
          Шаблон привязан к /q/ намеренно — иначе выражение съело бы и обычные
          статические ссылки вроде banki.ru/products/deposits.

       Правила операторов (МегаФон через МТС) запрещают %w+, запрещают две групповые
       переменные подряд и ограничивают совокупное число слов двадцатью. Первые два
       запрета нарушить нечем: мы не выпускаем ни %w+, ни %w{1,n}, ни %d+ — только
       одиночные %w. Остаётся счёт: тексты, где переменных больше двадцати, не
       заполняем совсем — такую строку должен написать человек. */
    private static final String SMS_APPROVED = "notice.d_com_sms_approved_template";

    /** Выражение разложения. {@code %s} — источник текста (алиас таблицы шаблонов). */
    private static final String SMS_APPROVED_EXPR =
            "regexp_replace(regexp_replace(coalesce(%s.msg_text, ''),"
            + " '##[A-Za-z0-9_]+##', '%%w', 'g'),"
            + " '(banki\\.ru/q/)[A-Za-z0-9]+', '\\1%%w', 'g')";

    /** Предел операторов: не больше двадцати переменных на шаблон. */
    private static final int SMS_APPROVED_MAX_VARS = 20;

    /**
     * Завести строку согласования для sms-шаблона, если её ещё нет.
     * <p>
     * template_id ссылается на {@code notice.d_com_sms_template.id}, а не на code:
     * в этой схеме принято различать их именем колонки — у соседнего спутника
     * ({@link #SMS_TYPE}) поле называется template_code и хранит именно код.
     * Берём id той же строки, которую только что записали, подзапросом по коду —
     * локальный id здесь не годится, в проде он свой.
     * <p>
     * Существующую строку не трогаем — как и у спутника-типа, и по более серьёзной
     * причине: рядом лежат флаги согласования с операторами. Переписать текст под уже
     * проставленным approved_* значило бы выдать за согласованное то, чего оператор
     * не видел.
     */
    private void smsApprovedEnsure(Connection c, String channel, long code) throws Exception {
        if (!"sms".equals(channel)) return;
        String expr = String.format(SMS_APPROVED_EXPR, "t");
        String sql = "INSERT INTO " + SMS_APPROVED
                + " (template_id, \"template\", business_communication_type)"
                + " SELECT s.id, s.tpl, s.bct FROM ("
                + "   SELECT t.id AS id, t.business_communication_type AS bct, " + expr + " AS tpl"
                + "   FROM " + UnifiedTemplateService.channelTable("sms").table() + " t WHERE t.code = ?"
                + " ) s"
                + " WHERE s.tpl <> ''"
                + "   AND (length(s.tpl) - length(replace(s.tpl, '%w', ''))) / 2 <= " + SMS_APPROVED_MAX_VARS
                + "   AND NOT EXISTS (SELECT 1 FROM " + SMS_APPROVED + " a WHERE a.template_id = s.id)";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, code);
            ps.executeUpdate();
        }
    }

    /**
     * Убрать спутника вместе с шаблоном — но только своей формы (code = template_code).
     * Строку с тем же кодом, но ссылающуюся на другой шаблон, заводили не мы.
     */
    private void smsTypeDelete(Connection c, String channel, long code) throws Exception {
        if (!"sms".equals(channel)) return;
        try (PreparedStatement ps = c.prepareStatement(
                "DELETE FROM " + SMS_TYPE + " WHERE code = ? AND template_code = ?")) {
            ps.setLong(1, code);
            ps.setLong(2, code);
            ps.executeUpdate();
        }
    }

    /**
     * ПОТОКОВО отдаёт строки прод-таблицы канала (для сверки) — по одной, серверным курсором,
     * без загрузки всей таблицы в память (иначе на больших таблицах — OutOfMemory).
     * autoCommit=false + fetchSize включают курсор на стороне Postgres.
     */
    public void readEach(String channel, java.util.function.Consumer<JsonNode> consumer) throws Exception {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) throw new IllegalArgumentException("Неизвестный канал: " + channel);
        try (Connection c = ds().getConnection()) {
            c.setAutoCommit(false);
            try (PreparedStatement ps = c.prepareStatement("SELECT to_jsonb(t)::text FROM " + ct.table() + " t")) {
                ps.setFetchSize(500);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) consumer.accept(om.readTree(rs.getString(1)));
                }
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    /**
     * Потоковое чтение ИЗМЕНЁННЫХ строк канала: всё, у чего
     * COALESCE(timestamp_upd, timestamp_cr) > since. COALESCE обязателен — метки в проде
     * завели недавно, у старых строк timestamp_upd = NULL, и условие «upd > since» терял бы их;
     * заодно страхует путь вставки, который не проставил upd.
     * since = null → отдаём всё (первичная заливка).
     * Возвращает максимум этого выражения по прочитанным строкам (новый водяной знак)
     * либо null, если строк не было.
     */
    public java.sql.Timestamp readChangedSince(String channel, java.sql.Timestamp since,
                                               java.util.function.Consumer<JsonNode> consumer) throws Exception {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) throw new IllegalArgumentException("Неизвестный канал: " + channel);
        String chg = "COALESCE(t.timestamp_upd, t.timestamp_cr)";
        String sql = "SELECT to_jsonb(t)::text, " + chg + " AS chg FROM " + ct.table() + " t" +
                (since == null ? "" : " WHERE " + chg + " > ?") +
                " ORDER BY " + chg;
        java.sql.Timestamp max = null;
        try (Connection c = ds().getConnection()) {
            c.setAutoCommit(false);                       // курсор на сервере, без выгрузки всей таблицы
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                if (since != null) ps.setTimestamp(1, since);
                ps.setFetchSize(500);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        consumer.accept(om.readTree(rs.getString(1)));
                        java.sql.Timestamp t = rs.getTimestamp(2);
                        if (t != null && (max == null || t.after(max))) max = t;
                    }
                }
            } finally {
                c.setAutoCommit(true);
            }
        }
        return max;
    }

    /** Одна прод-строка канала по бизнес-коду (для импорта выбранной строки). null — нет такой. */
    public String readOne(String channel, long code) throws Exception {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null) return null;
        try (Connection c = ds().getConnection();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT to_jsonb(t)::text FROM " + ct.table() + " t WHERE t." + ct.codeCol() + " = ?")) {
            ps.setLong(1, code);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    /**
     * Прокидывает актёра в сессионную переменную app.current_user на прод-соединении,
     * чтобы BEFORE-триггеры аудита записали в log.t_admin_log реального пользователя
     * (аналог set_config('app.current_user', ...) из старой Appsmith-админки).
     * is_local=true — значение живёт только до конца ЭТОЙ транзакции: пул переиспользует
     * соединение, но в следующую операцию чужой актёр не утечёт.
     * В лог кладём логин без домена: split_part(email, '@', 1).
     */
    private static void markActor(Connection c, String actor) throws Exception {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT set_config('app.current_user', split_part(COALESCE(?, ''), '@', 1), true)")) {
            ps.setString(1, actor);
            ps.executeQuery();
        }
    }

    /**
     * INSERT: id и код выдаёт прод (max+1). Правила нумерации:
     *  sms / email — в диапазоне до 10000 (ct.codeLimit), push — сквозной счётчик,
     *  cc — id по счётчику, а segment приходит из формы как есть.
     */
    private long insert(Connection c, ChannelTable ct, long localCode, String payloadJson) throws Exception {
        long code;
        long newId;
        if ("id".equals(ct.codeCol())) {
            newId = maxPlusOne(c, ct.table(), "id", ct.codeLimit());  // email: код = id
            code = newId;
        } else {
            newId = maxPlusOne(c, ct.table(), "id", null);            // суррогатный id — без ограничения
            code = ct.prodAssignsCode()
                    ? maxPlusOne(c, ct.table(), ct.codeCol(), ct.codeLimit())
                    : localCode;                                     // cc: segment как есть
        }
        if (ct.codeLimit() != null && code >= ct.codeLimit()) {
            throw new IllegalStateException("Свободные коды в диапазоне до " + ct.codeLimit()
                    + " закончились для " + ct.table());
        }
        // Явно перечисляем ТОЛЬКО заполненные колонки: остальные получат дефолты прод-таблицы
        // (передача явного NULL перебила бы DEFAULT и упала на NOT NULL).
        JsonNode parsed = om.readTree(payloadJson);
        // подстраховка для записей, уже стоявших в очереди: обязательные поля прода
        if (parsed instanceof com.fasterxml.jackson.databind.node.ObjectNode on) {
            UnifiedTemplateService.prodDefaults(channelOf(ct)).forEach((k, v) -> {
                if (!on.hasNonNull(k)) on.put(k, v);
            });
            payloadJson = on.toString();
        }
        JsonNode payload = parsed;
        java.util.Set<String> prodCols = tableColumns(c, ct.table());

        /* Страховка от повторной доставки. Очередь и без того больше не переотправляет
           доставленное (см. ProdSyncService), но если связь оборвётся между вставкой и
           получением ответа, повтор всё равно возможен — а различить «не доехало» и
           «доехало, но ответ потерян» снаружи нельзя. Поэтому перед вставкой ищем в
           проде свежую строку, совпадающую с этой ПОЛНОСТЬЮ: и по кампании, и по
           содержимому. */
        Long already = recentTwin(c, ct, payload, prodCols);
        if (already != null) return already;

        List<String> cols = new ArrayList<>();
        for (Iterator<String> it = payload.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if ("id".equals(k) || ct.codeCol().equals(k)) continue;
            if (!k.matches("[a-z_][a-z0-9_]*") || !prodCols.contains(k)) continue;
            if (payload.get(k) == null || payload.get(k).isNull()) continue;
            cols.add(k);
        }
        // у email бизнес-код и есть id — колонку нельзя перечислять дважды
        boolean codeIsId = "id".equals(ct.codeCol());
        StringBuilder colList = new StringBuilder("id");
        StringBuilder valList = new StringBuilder("?::bigint");
        if (!codeIsId) {
            colList.append(", ").append(ct.codeCol());
            valList.append(", ?::bigint");
        }
        for (String k : cols) {
            colList.append(", ").append(k);
            valList.append(", p.").append(k);
        }
        // Метки ставим часами прода: по ним ETL увидит новую строку. Если у прод-таблицы
        // есть свой DEFAULT/триггер — он перекроет, конфликта нет.
        for (String ts : List.of("timestamp_cr", "timestamp_upd")) {
            if (prodCols.contains(ts)) {
                colList.append(", ").append(ts);
                valList.append(", now()");
            }
        }
        // типы конвертирует сам Postgres: jsonb_populate_record по структуре прод-таблицы
        String sql = "INSERT INTO " + ct.table() + " (" + colList + ") SELECT " + valList +
                " FROM jsonb_populate_record(NULL::" + ct.table() + ", ?::jsonb) p";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            int i = 1;
            ps.setLong(i++, newId);
            if (!codeIsId) ps.setLong(i++, code);
            ps.setString(i, payloadJson);
            ps.executeUpdate();
        }
        return code;
    }

    /** UPDATE по бизнес-коду: SET-список из ключей payload (кроме id и кода). */
    private int update(Connection c, ChannelTable ct, long localCode, String payloadJson) throws Exception {
        JsonNode payload = om.readTree(payloadJson);
        // payload собирается из d_template, поэтому берём только колонки, которые реально есть в прод-таблице
        java.util.Set<String> prodCols = tableColumns(c, ct.table());
        List<String> cols = new ArrayList<>();
        for (Iterator<String> it = payload.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if ("id".equals(k) || ct.codeCol().equals(k)) continue;
            if (!k.matches("[a-z_][a-z0-9_]*")) {
                throw new IllegalArgumentException("Недопустимая колонка payload: " + k);
            }
            if (!prodCols.contains(k)) continue;
            // null не переносим: в проде такие колонки NOT NULL с дефолтом — оставляем текущее значение
            if (payload.get(k) == null || payload.get(k).isNull()) continue;
            cols.add(k);
        }
        if (cols.isEmpty()) return 0;
        StringBuilder set = new StringBuilder();
        for (String k : cols) {
            if (set.length() > 0) set.append(", ");
            set.append(k).append(" = p.").append(k);
        }
        // Метку изменения ставим на стороне прода (его часами) — по ней ETL и увидит правку.
        // Если в проде есть свой триггер на timestamp_upd, он просто перекроет это значение.
        if (prodCols.contains("timestamp_upd")) {
            if (set.length() > 0) set.append(", ");
            set.append("timestamp_upd = now()");
        }
        String sql = "UPDATE " + ct.table() + " t SET " + set +
                " FROM (SELECT * FROM jsonb_populate_record(NULL::" + ct.table() + ", ?::jsonb)) p" +
                " WHERE t." + ct.codeCol() + " = ?";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, payloadJson);
            ps.setLong(2, localCode);
            return ps.executeUpdate();
        }
    }

    /**
     * Содержимое, по которому два шаблона одной кампании отличаются друг от друга.
     * Берём только те колонки, что есть и в payload, и в прод-таблице.
     */
    private static final List<String> TWIN_CONTENT = List.of(
            "msg_text", "title", "subject", "letteros_id", "sender_name", "deep_link");

    /**
     * Уже вставленная строка за последний час, совпадающая с этой полностью.
     * Возвращаем её бизнес-код — очередь запишет его как результат доставки, и дубль
     * не появится.
     * <p>
     * Сравниваем не только кампанию и имя коммуникации, но и содержимое. Иначе страховка
     * ломала бы работу: А/Б-шаблоны заводят парой — одна кампания, одно имя коммуникации,
     * разный текст, — и вторая строка молча получила бы код первой. При повторной доставке
     * payload тот же самый до байта, поэтому совпадёт и содержимое; у А/Б-пары — нет.
     * <p>
     * Работает только если в прод-таблице есть source_type, communication_name и
     * timestamp_cr: без последней окно не ограничить, и совпадение годовой давности
     * приняли бы за свежий дубль.
     */
    private static Long recentTwin(Connection c, ChannelTable ct, JsonNode payload,
                                   java.util.Set<String> prodCols) {
        if (!prodCols.contains("source_type") || !prodCols.contains("communication_name")
                || !prodCols.contains("timestamp_cr")) return null;
        String src = jsonText(payload, "source_type"), name = jsonText(payload, "communication_name");
        if (src.isEmpty() || name.isEmpty()) return null;

        /* Сопоставляем как текст: в разных каналах эти колонки разных типов
           (letteros_id числовой), а нам нужно лишь равенство значений. */
        List<String> content = new ArrayList<>();
        List<String> values = new ArrayList<>();
        for (String col : TWIN_CONTENT) {
            if (!prodCols.contains(col) || payload.get(col) == null || payload.get(col).isNull()) continue;
            content.add("coalesce(" + col + "::text, '') = ?");
            values.add(jsonText(payload, col));
        }
        /* Сравнить нечего — значит и уверенности, что это дубль, нет: пропускаем вставку
           через обычный путь, лучше лишняя строка, чем потерянная. */
        if (content.isEmpty()) return null;

        String sql = "SELECT " + ct.codeCol() + " FROM " + ct.table() +
                " WHERE source_type = ? AND communication_name = ?" +
                "   AND timestamp_cr > now() - interval '1 hour'" +
                "   AND " + String.join(" AND ", content) +
                " ORDER BY " + ct.codeCol() + " DESC LIMIT 1";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setQueryTimeout(20);
            ps.setString(1, src);
            ps.setString(2, name);
            for (int i = 0; i < values.size(); i++) ps.setString(3 + i, values.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    long code = rs.getLong(1);
                    log.warn("prod-insert: в {} уже есть свежая строка {}={} с тем же содержимым" +
                            " (source_type={}, communication_name={}) — считаем доставленной," +
                            " дубль не создаём", ct.table(), ct.codeCol(), code, src, name);
                    return code;
                }
            }
        } catch (Exception e) {
            /* проверка необязательная: не вышло — вставляем, как раньше */
            log.warn("prod-insert: проверка на дубль в {} не удалась: {}", ct.table(), e.getMessage());
        }
        return null;
    }

    private static String jsonText(JsonNode row, String field) {
        JsonNode v = row == null ? null : row.get(field);
        return v == null || v.isNull() ? "" : v.asText().trim();
    }

    /** Канал по описанию таблицы (для channel-specific дефолтов). */
    private static String channelOf(ChannelTable ct) {
        for (String ch : List.of("sms", "push", "email", "cc", "fa", "vk", "la")) {
            ChannelTable t = UnifiedTemplateService.channelTable(ch);
            if (t != null && t.table().equals(ct.table())) return ch;
        }
        return "";
    }

    /** Колонки прод-таблицы (payload из d_template может содержать лишние ключи). */
    private static java.util.Set<String> tableColumns(Connection c, String table) throws Exception {
        String[] st = table.split("\\.");
        java.util.Set<String> cols = new java.util.HashSet<>();
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?")) {
            ps.setString(1, st[0]);
            ps.setString(2, st[1]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) cols.add(rs.getString(1));
            }
        }
        return cols;
    }

    /**
     * Колонки прод-таблицы канала, которые NOT NULL и БЕЗ DEFAULT: если такой колонки нет
     * в payload, INSERT в проде упадёт. Наши схемы расходятся с прод-схемой (у нас у той же
     * колонки может стоять DEFAULT ''), поэтому спрашиваем именно прод, а не свою базу.
     *
     * id и бизнес-код исключены — их проставляет сам insert(); identity/generated тоже:
     * их значение генерирует Postgres, хоть column_default у них и пуст.
     *
     * Прод не настроен или недоступен → пустой набор: пре-флайт молчит и работать не мешает.
     */
    public java.util.Set<String> requiredColumns(String channel) {
        ChannelTable ct = UnifiedTemplateService.channelTable(channel);
        if (ct == null || !configured()) return java.util.Set.of();
        Cfg cfg = config();
        String sig = cfg == null ? "" : (cfg.url() + "\0" + cfg.user());
        if (!sig.equals(requiredCacheSig)) {   // сменили приёмник — прежняя схема не про него
            requiredCache.clear();
            requiredCacheSig = sig;
        }
        java.util.Set<String> cached = requiredCache.get(channel);
        if (cached != null) return cached;
        String[] st = ct.table().split("\\.");
        java.util.Set<String> req = new java.util.HashSet<>();
        try (Connection c = ds().getConnection();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT column_name FROM information_schema.columns" +
                     " WHERE table_schema = ? AND table_name = ? AND is_nullable = 'NO'" +
                     " AND column_default IS NULL AND is_identity = 'NO' AND is_generated = 'NEVER'")) {
            ps.setString(1, st[0]);
            ps.setString(2, st[1]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) req.add(rs.getString(1));
            }
        } catch (Exception e) {
            return java.util.Set.of();   // прод недоступен — не кешируем и не блокируем
        }
        req.remove("id");
        req.remove(ct.codeCol());
        requiredCache.put(channel, req);
        return req;
    }

    /**
     * Каких обязательных полей прода не хватает в payload. Пустой список — препятствий нет.
     * Проверяем именно отсутствие/NULL: пустая строка прод-ограничение NOT NULL проходит,
     * и запрещать её здесь значило бы отбивать то, что прод принял бы.
     */
    public List<String> missingRequired(String channel, String payloadJson) {
        java.util.Set<String> req = requiredColumns(channel);
        if (req.isEmpty() || payloadJson == null) return List.of();
        Map<String, String> auto = UnifiedTemplateService.prodDefaults(channel);
        List<String> missing = new ArrayList<>();
        try {
            JsonNode payload = om.readTree(payloadJson);
            for (String col : req) {
                if (auto.containsKey(col)) continue;   // insert() подставит сам
                JsonNode v = payload.get(col);
                if (v == null || v.isNull()) missing.add(col);
            }
        } catch (Exception e) {
            return List.of();   // payload не разобрали — пусть решает прод
        }
        java.util.Collections.sort(missing);
        return missing;
    }

    /** max+1 по колонке; при заданном limit нумерация идёт только в диапазоне ниже него. */
    static long maxPlusOne(Connection c, String table, String col, Long limit) throws Exception {
        String sql = "SELECT COALESCE(MAX(" + col + "), 0) + 1 FROM " + table
                + (limit == null ? "" : " WHERE " + col + " < ?");
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            if (limit != null) ps.setLong(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }
}
