package ru.banki.crm.service.deploy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Выкатки: что стоит на каждом контуре, что ещё не доехало и какой командой это доставить.
 * <p>
 * Панель <b>не выполняет</b> выкат. Приложение живёт в контейнере и не может ни пересобрать
 * себя, ни пересоздать соседа — для этого нужен доступ к docker, а это заметно больше прав,
 * чем стоит давать веб-приложению. Поэтому раздел отвечает на вопросы «что где стоит» и
 * «что поедет», отдаёт готовую команду и записывает намерение в журнал, а команду человек
 * запускает сам.
 * <p>
 * Версии соседей спрашиваем по внутренней сети compose ({@code http://app-preprod:8080}):
 * контуры видят друг друга по именам сервисов. Запрос идёт с общим секретом
 * ({@code DEPLOY_PEER_TOKEN}), иначе пришлось бы открывать версию наружу без разбора.
 */
@Service
public class DeployService {

    private static final Logger log = LoggerFactory.getLogger(DeployService.class);

    /** Куда можно катить с какого контура. Порядок жёсткий: тест → препрод → прод. */
    private static final Map<String, String> NEXT = Map.of("test", "preprod", "preprod", "prod");

    private final JdbcTemplate jdbc;
    private final BuildInfoService build;
    private final ObjectMapper json;
    private final HttpClient http;

    @Value("${app.env.name:prod}")
    private String envName;

    /** Адреса соседей: {@code preprod=http://app-preprod:8080,prod=http://app-prod:8080}. */
    @Value("${app.deploy.peers:}")
    private String peersRaw;

    @Value("${app.deploy.peer-token:}")
    private String peerToken;

    /** Ветка, из которой собирают: подставляется в команды выката. */
    @Value("${app.deploy.branch:admin-panel}")
    private String branch;

    /** Каталог с compose-файлами на сервере — тоже только для текста команды. */
    @Value("${app.deploy.dir:~/crm.banki.ru}")
    private String deployDir;

    public DeployService(JdbcTemplate jdbc, BuildInfoService build, ObjectMapper json) {
        this.jdbc = jdbc;
        this.build = build;
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    }

    // ------------------------------------------------------------------ обзор

    /**
     * Состояние всех контуров плюс разница «мы → следующий». Опрос соседей не должен ронять
     * раздел: сосед может быть выключен, и это само по себе полезно увидеть.
     */
    public Map<String, Object> overview() {
        Map<String, Object> me = new LinkedHashMap<>(build.summary());
        me.put("env", envName);
        me.put("reachable", true);
        me.put("self", true);

        List<Map<String, Object>> envs = new ArrayList<>();
        envs.add(me);
        peers().forEach((name, url) -> envs.add(peer(name, url)));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("envs", envs);
        out.put("branch", branch);
        out.put("known", build.known());
        out.put("target", NEXT.get(envName));
        out.put("peersConfigured", !peers().isEmpty());
        return out;
    }

    /**
     * Что есть у нас и чего нет на целевом контуре. Возвращает и «сколько из этого тянет
     * миграции» — от этого зависит, можно ли вообще выбирать срез не с конца.
     */
    public Map<String, Object> pending(String target) {
        String t = target(target);
        Map<String, Object> peer = peer(t, peers().get(t));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("target", t);
        out.put("targetCommit", peer.get("commit"));
        out.put("targetReachable", peer.get("reachable"));
        out.put("known", build.known());

        List<Map<String, Object>> ahead = build.ahead(String.valueOf(peer.getOrDefault("commit", "")));
        out.put("commits", ahead);
        out.put("migrations", ahead.stream().filter(c -> Boolean.TRUE.equals(c.get("migration"))).count());
        /* Пустой список означает две разные вещи — «всё доехало» и «сравнить не с чем», —
           и путать их нельзя: во втором случае человек решит, что выкатывать нечего. */
        out.put("comparable", build.known() && !String.valueOf(peer.getOrDefault("commit", "")).isEmpty());
        return out;
    }

    /**
     * Команда на выкат среза. Ровно то, что человек выполнит в терминале, — и ровно то,
     * что мы записываем в журнал: расхождение между «показали» и «записали» сделало бы
     * журнал бесполезным.
     */
    @Transactional
    public Map<String, Object> plan(String target, String upTo, boolean record) {
        String t = target(target);
        if (!build.known()) {
            throw bad("Версия сборки неизвестна: образ собран мимо scripts/build.sh");
        }
        String commit = upTo == null || upTo.isBlank() ? build.commit() : upTo.trim();
        if (!build.hasCommit(commit)) {
            throw bad("Коммита " + commit + " нет в истории этой сборки");
        }
        Map<String, Object> peer = peer(t, peers().get(t));
        List<Map<String, Object>> ahead = build.ahead(String.valueOf(peer.getOrDefault("commit", "")));

        // срез: от целевой версии до выбранного коммита включительно
        List<Map<String, Object>> slice = new ArrayList<>();
        boolean started = false;
        for (int i = ahead.size() - 1; i >= 0; i--) {
            Map<String, Object> c = ahead.get(i);
            String h = String.valueOf(c.get("commit"));
            slice.add(0, c);
            if (h.startsWith(commit) || commit.startsWith(h)) {
                started = true;
                break;
            }
        }
        if (!started) {
            slice.clear();
        }
        long migrations = slice.stream().filter(c -> Boolean.TRUE.equals(c.get("migration"))).count();
        String subject = slice.isEmpty() ? "" : String.valueOf(slice.get(0).get("subject"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("target", t);
        out.put("upTo", commit);
        out.put("subject", subject);
        out.put("commits", slice);
        out.put("migrations", migrations);
        out.put("script", script(t, commit));
        out.put("partial", !commit.equals(build.commit()));

        if (record) {
            Long id = jdbc.queryForObject(
                    "INSERT INTO app.deploy_log (source_env, target_env, to_commit, to_subject,"
                    + " from_commit, commits, migrations, actor)"
                    + " VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                    Long.class, envName, t, commit, subject,
                    String.valueOf(peer.getOrDefault("commit", "")), slice.size(), (int) migrations,
                    CurrentUser.email());
            out.put("logId", id);
        }
        return out;
    }

    /**
     * Поставить выкат в очередь обработчику на хосте.
     * <p>
     * Панель не катит сама и не должна: docker живёт на хосте, а сокет хоста в контейнере
     * равен root на сервере. Поэтому здесь та же запись в журнал, что и у «Записать и
     * катить», только помеченная как задание — её подберёт scripts/deploy-runner.sh.
     * <p>
     * Второе задание в очередь не пускаем: сборка идёт на одном теге crm-admin:local, и
     * два выката разом собирали бы образ друг поверх друга.
     */
    @Transactional
    public Map<String, Object> enqueue(String target, String upTo) {
        Integer busy = jdbc.queryForObject(
                "SELECT count(*) FROM app.deploy_log WHERE run_status IN ('queued', 'running')",
                Integer.class);
        if (busy != null && busy > 0) {
            throw bad("Один выкат уже в очереди или выполняется. Дождитесь его окончания.");
        }
        Map<String, Object> planned = plan(target, upTo, true);
        Object logId = planned.get("logId");
        jdbc.update("UPDATE app.deploy_log SET run_status = 'queued', run_by = ? WHERE id = ?",
                CurrentUser.email(), ((Number) logId).longValue());
        planned.put("runStatus", "queued");
        planned.put("runner", runner());
        return planned;
    }

    /**
     * Жив ли обработчик. Ответ на вопрос, который иначе задавать некому: без него
     * нажатая кнопка молча копила бы задания, и это выглядело бы как «панель сломалась».
     */
    @Transactional(readOnly = true)
    public Map<String, Object> runner() {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            Map<String, Object> row = jdbc.queryForMap(
                    "SELECT last_seen_at, host, version,"
                    + " extract(epoch from (now() - last_seen_at))::bigint AS ago"
                    + " FROM app.deploy_runner WHERE id = 1");
            Object ago = row.get("ago");
            long sec = ago instanceof Number n ? n.longValue() : -1;
            out.put("lastSeenAt", row.get("last_seen_at") == null ? null : String.valueOf(row.get("last_seen_at")));
            out.put("host", row.get("host"));
            out.put("agoSec", sec);
            /* Пять минут при таймере в минуту — это пропущенные четыре запуска подряд:
               случайный сбой так долго не длится. */
            out.put("alive", row.get("last_seen_at") != null && sec >= 0 && sec < 300);
        } catch (RuntimeException e) {
            out.put("alive", false);
            out.put("error", "Таблица обработчика недоступна — миграция V48 не накачена?");
        }
        return out;
    }

    /** Текущее задание очереди: что катится прямо сейчас или ждёт обработчика. */
    @Transactional(readOnly = true)
    public Map<String, Object> currentJob() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, target_env, to_commit, to_subject, run_status, run_started_at,"
                + " run_finished_at, run_output, run_by"
                + " FROM app.deploy_log WHERE run_status IN ('queued', 'running')"
                + " OR (run_status IN ('done', 'failed') AND run_finished_at > now() - interval '10 minutes')"
                + " ORDER BY id DESC LIMIT 1");
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /**
     * Текст команды. Частичный выкат отдельной веткой: катить «до коммита» через checkout
     * ветки нельзя — она уедет вперёд, и на цели окажется не то, что показали.
     */
    private String script(String target, String upTo) {
        String service = "app-" + target;
        String compose = "docker compose -f docker-compose.yml -f docker-compose.server.yml";
        boolean full = upTo.equals(build.commit());
        StringBuilder s = new StringBuilder();
        s.append("cd ").append(deployDir).append(" && git fetch origin && git checkout ")
                .append(full ? branch : upTo).append(full ? " && git pull --ff-only" : "").append("\n");
        s.append("cd ").append(deployDir).append("/crm-admin && bash scripts/build.sh\n");
        s.append("cd ").append(deployDir).append("/crm-admin && ").append(compose)
                .append(" up -d --no-deps --force-recreate ").append(service).append("\n");
        if ("prod".equals(target)) {
            s.append("docker exec crm-admin-nginx nginx -s reload\n");
        }
        s.append("docker logs --tail 30 crm-admin-").append(service.replace("app-", "app-")).append("\n");
        return s.toString();
    }

    // ------------------------------------------------------------------ журнал

    @Transactional(readOnly = true)
    public List<Map<String, Object>> history(int limit) {
        return jdbc.query(
                "SELECT id, source_env, target_env, to_commit, to_subject, from_commit,"
                + "       commits, migrations, status, actor, note, timestamp_cr"
                + "  FROM app.deploy_log ORDER BY id DESC LIMIT ?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("from", rs.getString("source_env"));
                    m.put("to", rs.getString("target_env"));
                    m.put("commit", rs.getString("to_commit"));
                    m.put("shortCommit", shorten(rs.getString("to_commit")));
                    m.put("subject", rs.getString("to_subject"));
                    m.put("wasCommit", shorten(rs.getString("from_commit")));
                    m.put("commits", rs.getInt("commits"));
                    m.put("migrations", rs.getInt("migrations"));
                    m.put("status", rs.getString("status"));
                    m.put("actor", rs.getString("actor"));
                    m.put("note", rs.getString("note"));
                    m.put("at", String.valueOf(rs.getTimestamp("timestamp_cr")));
                    return m;
                }, Math.max(1, Math.min(limit, 200)));
    }

    /**
     * Отметить записи выполненными: если на целевом контуре уже стоит тот коммит, который
     * планировали, выкат состоялся. Проверяем по факту, а не по нажатию кнопки — команду
     * выполняют в терминале, и «нажал» ещё не значит «доехало».
     */
    @Transactional
    public int reconcile() {
        int done = 0;
        for (Map.Entry<String, String> e : peers().entrySet()) {
            Map<String, Object> peer = peer(e.getKey(), e.getValue());
            String commit = String.valueOf(peer.getOrDefault("commit", ""));
            if (commit.isEmpty()) continue;
            done += jdbc.update(
                    "UPDATE app.deploy_log SET status = 'done', timestamp_upd = now()"
                    + " WHERE status = 'planned' AND target_env = ? AND to_commit = ?",
                    e.getKey(), commit);
        }
        return done;
    }

    @Transactional
    public void cancel(long id) {
        jdbc.update("UPDATE app.deploy_log SET status = 'cancelled', timestamp_upd = now()"
                + " WHERE id = ? AND status = 'planned'", id);
    }

    // ------------------------------------------------------------------ соседи

    private Map<String, String> peers() {
        Map<String, String> out = new LinkedHashMap<>();
        for (String part : peersRaw.split(",")) {
            String p = part.trim();
            int eq = p.indexOf('=');
            if (eq <= 0) continue;
            String name = p.substring(0, eq).trim();
            String url = p.substring(eq + 1).trim();
            if (!name.isEmpty() && !url.isEmpty() && !name.equals(envName)) out.put(name, url);
        }
        return out;
    }

    private Map<String, Object> peer(String name, String url) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("env", name);
        m.put("self", false);
        if (url == null || url.isBlank()) {
            m.put("reachable", false);
            m.put("error", "адрес контура не задан (app.deploy.peers)");
            m.put("commit", "");
            return m;
        }
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url.replaceAll("/+$", "") + "/api/build"))
                    .timeout(Duration.ofSeconds(4))
                    .header("Accept", "application/json")
                    .header("X-Peer-Token", peerToken)
                    .GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                m.put("reachable", false);
                m.put("error", "ответ " + res.statusCode());
                m.put("commit", "");
                return m;
            }
            JsonNode b = json.readTree(res.body());
            m.put("reachable", true);
            m.put("commit", b.path("commit").asText(""));
            m.put("shortCommit", b.path("shortCommit").asText(""));
            m.put("branch", b.path("branch").asText(""));
            m.put("builtAt", b.path("builtAt").asText(""));
            m.put("subject", b.path("subject").asText(""));
        } catch (Exception e) {
            log.debug("peer {} недоступен: {}", name, e.toString());
            m.put("reachable", false);
            m.put("error", String.valueOf(e.getMessage()));
            m.put("commit", "");
        }
        return m;
    }

    /** Совпадает ли присланный секрет с нашим — для запроса версии от соседнего контура. */
    public boolean peerTokenValid(String token) {
        return !peerToken.isBlank() && peerToken.equals(token);
    }

    // ------------------------------------------------------------------ мелочи

    private String target(String target) {
        String t = target == null ? "" : target.trim();
        if (t.isEmpty()) t = NEXT.getOrDefault(envName, "");
        if (t.isEmpty() || t.equals(envName)) {
            throw bad("С контура " + envName + " выкатывать некуда");
        }
        if (!peers().containsKey(t)) {
            throw bad("Контур " + t + " не настроен в app.deploy.peers");
        }
        return t;
    }

    private static String shorten(String commit) {
        String c = commit == null ? "" : commit;
        return c.length() > 8 ? c.substring(0, 8) : c;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
