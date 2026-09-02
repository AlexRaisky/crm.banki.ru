package ru.banki.crm.service.deploy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Какая версия кода собрана в этот образ и что было в истории ветки на момент сборки.
 * <p>
 * Внутри контейнера git недоступен (.git не попадает в сборку — и правильно), поэтому
 * историю кладёт в образ сам сборщик: {@code scripts/build.sh} пишет
 * {@code src/main/resources/build-info.json} и только потом запускает docker build.
 * Файл генерируемый и в репозитории не хранится.
 * <p>
 * Отсюда важное свойство: контур знает не только свой коммит, но и то, что было ДО него.
 * Этого хватает, чтобы ответить на главный вопрос выкатки — «что есть у меня и чего ещё
 * нет на соседе»: находим коммит соседа в нашей истории и берём всё, что выше.
 */
@Service
public class BuildInfoService {

    private static final Logger log = LoggerFactory.getLogger(BuildInfoService.class);
    private static final String RESOURCE = "build-info.json";

    private final ObjectMapper json;
    private final Map<String, Object> info;
    private final List<Map<String, Object>> history;

    public BuildInfoService(ObjectMapper json) {
        this.json = json;
        JsonNode root = read();
        this.info = header(root);
        this.history = commits(root);
    }

    /** Коротко о сборке: хеш, ветка, время. Без истории — её просят отдельно. */
    public Map<String, Object> summary() {
        return new LinkedHashMap<>(info);
    }

    /** Полный хеш собранного коммита либо пусто, если образ собран мимо scripts/build.sh. */
    public String commit() {
        return String.valueOf(info.getOrDefault("commit", ""));
    }

    public boolean known() {
        return !commit().isEmpty();
    }

    /** История ветки на момент сборки, новые сверху. */
    public List<Map<String, Object>> history() {
        return history;
    }

    /**
     * Коммиты, которые есть в нашей сборке и которых нет у контура с версией {@code theirs}.
     * <p>
     * Хеш соседа ищем в своей истории. Не нашли — значит сосед ушёл в сторону (собран с
     * другой ветки или история длиннее того, что мы храним), и врать про «не доехало»
     * нельзя: возвращаем пусто, а раздел скажет, что сравнить не с чем.
     */
    public List<Map<String, Object>> ahead(String theirs) {
        String t = theirs == null ? "" : theirs.trim();
        if (t.isEmpty() || history.isEmpty()) {
            return List.of();
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> c : history) {
            String h = String.valueOf(c.get("commit"));
            if (h.startsWith(t) || t.startsWith(h)) {
                return out;                       // дошли до версии соседа — всё, что выше, и есть разница
            }
            out.add(c);
        }
        return List.of();                          // версии соседа в нашей истории нет
    }

    /** Знаем ли мы вообще про такой коммит — нужно, чтобы не катить срез «в никуда». */
    public boolean hasCommit(String commit) {
        String c = commit == null ? "" : commit.trim();
        if (c.isEmpty()) return false;
        for (Map<String, Object> m : history) {
            String h = String.valueOf(m.get("commit"));
            if (h.startsWith(c) || c.startsWith(h)) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ чтение файла

    private JsonNode read() {
        try (InputStream in = new ClassPathResource(RESOURCE).getInputStream()) {
            return json.readTree(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            /* Файла нет — образ собрали обычным docker build. Это не поломка: панель
               работает, просто раздел выкаток честно скажет, что версия неизвестна. */
            log.info("build-info.json отсутствует — версия сборки неизвестна ({})", e.getMessage());
            return null;
        }
    }

    private static Map<String, Object> header(JsonNode root) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("commit", text(root, "commit"));
        m.put("shortCommit", text(root, "shortCommit"));
        m.put("branch", text(root, "branch"));
        m.put("builtAt", text(root, "builtAt"));
        m.put("builtBy", text(root, "builtBy"));
        m.put("subject", text(root, "subject"));
        return m;
    }

    private static List<Map<String, Object>> commits(JsonNode root) {
        List<Map<String, Object>> out = new ArrayList<>();
        JsonNode arr = root == null ? null : root.get("history");
        if (arr == null || !arr.isArray()) {
            return out;
        }
        for (JsonNode c : arr) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("commit", text(c, "commit"));
            m.put("shortCommit", text(c, "shortCommit"));
            m.put("subject", text(c, "subject"));
            m.put("author", text(c, "author"));
            m.put("date", text(c, "date"));
            /* Коммит с миграцией нельзя пропустить при выборе среза: Flyway идёт строго
               по номерам. Поэтому признак считает сборщик и кладёт сюда. */
            m.put("migration", c.path("migration").asBoolean(false));
            out.add(m);
        }
        return out;
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v == null || v.isNull() ? "" : v.asText().trim();
    }
}
