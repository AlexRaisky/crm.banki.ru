package ru.banki.crm.service.jira;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Настройка Jira и разбор её метаданных.
 * <p>
 * Главная мысль: поля в Jira DC называются {@code customfield_12345}, и знать их заранее
 * нельзя. Поэтому панель их не угадывает, а спрашивает у самой Jira ({@code createmeta})
 * и сопоставляет с нашими по видимому названию: «Канал» — канал строки плана,
 * «Заказчик» — заказчик и так далее. Что не сопоставилось, видно списком в настройках, и
 * это чинится руками, а не всплывает ошибкой при создании задачи.
 */
@Service
public class JiraService {

    /**
     * Наши поля и то, как они называются на экране создания задачи. Список не «на всякий
     * случай», а ровно под тип CRM-Промо: подпись слева в форме Jira.
     */
    public static final Map<String, String> OUR_FIELDS = new LinkedHashMap<>();
    static {
        OUR_FIELDS.put("channel", "Канал");
        OUR_FIELDS.put("customer", "Заказчик");
        OUR_FIELDS.put("product", "Тип продукта");
        OUR_FIELDS.put("kind", "Вид рассылки");
        OUR_FIELDS.put("name", "Название рассылки");
        OUR_FIELDS.put("sendDate", "Дата отправки рассылки");
        OUR_FIELDS.put("meaning", "Бизнес-смысл");
        OUR_FIELDS.put("link", "Ссылка");
        OUR_FIELDS.put("content", "Контент");
        OUR_FIELDS.put("segment", "Сегмент");
        OUR_FIELDS.put("abTest", "А/В-тестирование");
        OUR_FIELDS.put("source", "Source");
        OUR_FIELDS.put("service", "Сервис");
        OUR_FIELDS.put("analyst", "Ответственный аналитик");
    }

    /**
     * Как то же поле может называться в чужой Jira. Основное имя из OUR_FIELDS — то, что
     * показываем человеку; здесь варианты, которые тоже засчитываем при сопоставлении.
     * <p>
     * Список не выдуман: «A/B-тестирование» в Jira пишут и латиницей, и кириллицей, и
     * через «АБ», а поле источника называют то английским Source, то русским Источником.
     */
    static final Map<String, List<String>> ALIASES = new LinkedHashMap<>();
    static {
        ALIASES.put("abTest", List.of("A/B-тестирование", "AB-тестирование", "АБ-тестирование",
                "A/B тест", "AB-тест", "АБ-тест", "A/B test", "AB test"));
        ALIASES.put("source", List.of("Источник", "Сорс", "Source system", "Источник трафика"));
        ALIASES.put("customer", List.of("Заказчик задачи", "Customer"));
        ALIASES.put("channel", List.of("Канал коммуникации", "Channel"));
        ALIASES.put("sendDate", List.of("Дата отправки", "Дата рассылки"));
        ALIASES.put("analyst", List.of("Ответственный", "Аналитик"));
    }

    @PersistenceContext
    private EntityManager em;

    private final ObjectMapper om;

    public JiraService(ObjectMapper om) {
        this.om = om;
    }

    // ------------------------------------------------------------------ конфиг

    /** Настройки без токена — их отдаём наружу. */
    @Transactional(readOnly = true)
    public Map<String, Object> config() {
        Object[] r = row();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("baseUrl", str(r[0]));
        m.put("hasToken", r[1] != null && !String.valueOf(r[1]).isBlank());
        m.put("projectKey", str(r[2]));
        m.put("issueType", str(r[3]));
        m.put("labels", str(r[4]));
        m.put("fieldMap", json(str(r[5])));
        m.put("valueMap", json(str(r[6])));
        m.put("lastStatus", str(r[7]));
        m.put("lastError", str(r[8]));
        m.put("lastCheckedAt", r[9] == null ? null : String.valueOf(r[9]));
        return m;
    }

    /**
     * Сохранение настроек. Пустой токен означает «не менять»: форма его не показывает, и
     * пустое поле при правке адреса означало бы «стереть» — тихая поломка интеграции,
     * которую заметят только при следующей задаче.
     */
    @Transactional
    public Map<String, Object> save(Map<String, Object> body) {
        em.createNativeQuery(
                        "UPDATE app.jira_connection SET base_url = :url, project_key = :pk, issue_type = :it,"
                        + " default_labels = :lb,"
                        + " token = CASE WHEN :tok = :empty THEN token ELSE :tok END,"
                        + " timestamp_upd = now(), updated_by = :u WHERE id = 1")
                .setParameter("url", text(body.get("baseUrl")))
                .setParameter("pk", text(body.get("projectKey")))
                .setParameter("it", text(body.get("issueType")))
                .setParameter("lb", text(body.get("labels")))
                .setParameter("tok", text(body.get("token")))
                .setParameter("empty", "")
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
        return config();
    }

    /** Карту полей и значений пишем отдельно: её правят другой формой и другим ритмом. */
    @Transactional
    public Map<String, Object> saveMaps(Map<String, Object> body) {
        em.createNativeQuery(
                        "UPDATE app.jira_connection SET field_map = CAST(:fm AS jsonb),"
                        + " value_map = CAST(:vm AS jsonb), timestamp_upd = now(), updated_by = :u WHERE id = 1")
                .setParameter("fm", jsonText(body.get("fieldMap")))
                .setParameter("vm", jsonText(body.get("valueMap")))
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
        return config();
    }

    // ------------------------------------------------------------------ связь

    /** Проверка связи: кто мы для Jira. Ничего не меняет. */
    @Transactional
    public Map<String, Object> check() {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            JsonNode me = client().get("/rest/api/2/myself");
            out.put("ok", true);
            out.put("name", me.path("name").asText(""));
            out.put("displayName", me.path("displayName").asText(""));
            out.put("email", me.path("emailAddress").asText(""));
            noteCheck("OK", null);
        } catch (ResponseStatusException e) {
            out.put("ok", false);
            out.put("error", e.getReason());
            noteCheck("ERROR", e.getReason());
        }
        return out;
    }

    /**
     * Поля экрана создания задачи: id, имя, обязательность и допустимые значения.
     * <p>
     * Это ответ на вопрос «что Jira ждёт в запросе» — тот самый, из-за которого создание
     * обычно падает с 400 на обязательном поле, о котором никто не знал.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> meta() {
        Object[] r = row();
        String project = str(r[2]);
        String type = str(r[3]);
        if (project.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Не задан ключ проекта");
        }
        String path = "/rest/api/2/issue/createmeta?projectKeys=" + enc(project)
                + (type.isEmpty() ? "" : "&issuetypeNames=" + enc(type))
                + "&expand=projects.issuetypes.fields";
        JsonNode res = client().get(path);
        JsonNode fields = res.path("projects").path(0).path("issuetypes").path(0).path("fields");
        if (fields.isMissingNode() || !fields.isObject()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Jira не вернула поля для проекта " + project + " и типа «" + type + "». "
                    + "Проверьте ключ проекта, название типа задачи и права сервисной учётки.");
        }
        List<Map<String, Object>> out = new ArrayList<>();
        fields.fields().forEachRemaining(e -> {
            JsonNode f = e.getValue();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.getKey());
            m.put("name", f.path("name").asText(e.getKey()));
            m.put("required", f.path("required").asBoolean(false));
            m.put("type", f.path("schema").path("type").asText(""));
            List<String> values = new ArrayList<>();
            JsonNode allowed = f.get("allowedValues");
            if (allowed != null && allowed.isArray()) {
                allowed.forEach(v -> {
                    String s = v.path("value").asText(v.path("name").asText(""));
                    if (!s.isEmpty()) {
                        values.add(s);
                    }
                });
            }
            m.put("values", values);
            out.add(m);
        });
        // обязательные первыми: именно из-за них падает создание задачи
        out.sort((a, b) -> Boolean.compare(!(Boolean) a.get("required"), !(Boolean) b.get("required")));
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("project", project);
        answer.put("issueType", type);
        answer.put("fields", out);
        answer.put("ourFields", OUR_FIELDS);
        return answer;
    }

    /**
     * Сопоставить наши поля с полями Jira по видимому имени.
     * <p>
     * Ищем в три захода: точное имя из OUR_FIELDS, затем запасные из ALIASES, затем —
     * вхождение одного имени в другое («Ссылка» против «Ссылка на макет»). Ничего
     * похожего не нашлось — оставляем пустым и возвращаем кандидатов: угадывать поле
     * по первому похожему нельзя, а вот показать человеку, что есть на экране создания,
     * куда полезнее сухого «не найдено».
     */
    @Transactional
    public Map<String, Object> autoMap() {
        Map<String, Object> m = meta();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> fields = (List<Map<String, Object>>) m.get("fields");
        ObjectNode fieldMap = om.createObjectNode();
        List<Map<String, Object>> unmatched = new ArrayList<>();
        OUR_FIELDS.forEach((ourKey, jiraName) -> {
            List<String> names = new ArrayList<>();
            names.add(jiraName);
            names.addAll(ALIASES.getOrDefault(ourKey, List.of()));

            String id = null;
            for (String want : names) {                       // точное совпадение
                id = findField(fields, norm(want), false);
                if (id != null) break;
            }
            if (id == null) {
                for (String want : names) {                   // вхождение
                    id = findField(fields, norm(want), true);
                    if (id != null) break;
                }
            }
            if (id == null) {
                Map<String, Object> miss = new LinkedHashMap<>();
                miss.put("key", ourKey);
                miss.put("name", jiraName);
                miss.put("candidates", candidates(fields, names));
                unmatched.add(miss);
            } else {
                fieldMap.put(ourKey, id);
            }
        });
        em.createNativeQuery("UPDATE app.jira_connection SET field_map = CAST(:fm AS jsonb),"
                        + " timestamp_upd = now(), updated_by = :u WHERE id = 1")
                .setParameter("fm", fieldMap.toString())
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("matched", fieldMap.size());
        out.put("unmatched", unmatched);
        out.put("fieldMap", json(fieldMap.toString()));
        out.put("fields", fields);   // фронту — чтобы дать выбрать поле руками
        return out;
    }

    /**
     * id поля с таким именем: точно, а при {@code loose} — ещё и по началу имени
     * («Ссылка» находит «Ссылка на макет», «Дата отправки» — «Дата отправки рассылки»).
     * <p>
     * Именно по началу и только в одну сторону: имя в Jira должно начинаться с нашего,
     * не наоборот. Обратное направление выглядит соблазнительно, но привязывает «Тип
     * продукта» к полю «Тип» — а неверная привязка хуже пустой: пустую видно сразу,
     * неверную заметят на первой заведённой задаче. Короткие имена в нестрогий проход
     * не пускаем вовсе, у них слишком много случайных совпадений.
     */
    private static final int LOOSE_MIN_LEN = 5;

    private static String findField(List<Map<String, Object>> fields, String want, boolean loose) {
        if (want.isEmpty() || (loose && want.length() < LOOSE_MIN_LEN)) {
            return null;
        }
        for (Map<String, Object> f : fields) {
            String have = norm(String.valueOf(f.get("name")));
            boolean hit = loose ? have.startsWith(want) : have.equals(want);
            if (hit) {
                return String.valueOf(f.get("id"));
            }
        }
        return null;
    }

    /**
     * Чем поле могло бы быть: поля Jira, у которых с нашим именем есть общее слово.
     * Не догадка для подстановки, а подсказка глазам — часто сразу видно, что поле
     * названо иначе, чем ожидала панель.
     */
    private static List<Map<String, Object>> candidates(List<Map<String, Object>> fields, List<String> names) {
        Set<String> words = new LinkedHashSet<>();
        names.forEach(n -> {
            for (String w : n.toLowerCase().split("[\\s./\\-_]+")) {
                if (w.length() > 2) words.add(norm(w));
            }
        });
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> f : fields) {
            String have = norm(String.valueOf(f.get("name")));
            if (words.stream().anyMatch(have::contains)) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("id", f.get("id"));
                c.put("name", f.get("name"));
                out.add(c);
            }
            if (out.size() >= 5) break;
        }
        return out;
    }

    // ------------------------------------------------------------------ внутреннее

    /** Клиент по текущим настройкам. Собираем на каждый вызов: настройки правят на ходу. */
    public JiraClient client() {
        Object[] r = row();
        return new JiraClient(str(r[0]), r[1] == null ? "" : String.valueOf(r[1]), om);
    }

    /** Настроена ли интеграция — адрес и токен на месте. */
    @Transactional(readOnly = true)
    public boolean configured() {
        Object[] r = row();
        return !str(r[0]).isEmpty() && r[1] != null && !String.valueOf(r[1]).isBlank();
    }

    Object[] row() {
        List<?> rows = em.createNativeQuery(
                        "SELECT base_url, token, project_key, issue_type, default_labels,"
                        + " field_map::text, value_map::text, last_status, last_error, last_checked_at"
                        + " FROM app.jira_connection WHERE id = 1").getResultList();
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Строка настроек Jira не найдена — не прогнали миграцию V42?");
        }
        return (Object[]) rows.get(0);
    }

    private void noteCheck(String status, String error) {
        em.createNativeQuery("UPDATE app.jira_connection SET last_status = :s, last_error = :e,"
                        + " last_checked_at = now() WHERE id = 1")
                .setParameter("s", status)
                .setParameter("e", error == null ? "" : error)
                .executeUpdate();
    }

    /**
     * Имя поля к сравнимому виду.
     * <p>
     * Кроме регистра, пробелов и «ё» снимаем ещё две беды, из-за которых поле «не
     * находится» при одинаковых на вид подписях. Первая — разделители: «A/B-тест»,
     * «A/B тест» и «AB тест» для человека одно и то же. Вторая коварнее: кириллица
     * вперемешку с латиницей. В нашем списке стояло «А/В-тестирование» с русскими А и В,
     * а в Jira поле названо латинскими A и B — на экране не отличить, для equals это
     * разные строки. Поэтому буквы-двойники сводим к латинским.
     */
    private static String norm(String s) {
        if (s == null) {
            return "";
        }
        String low = s.toLowerCase().replace('ё', 'е');
        StringBuilder sb = new StringBuilder(low.length());
        for (int i = 0; i < low.length(); i++) {
            char c = low.charAt(i);
            int idx = CYR_LOOKALIKE.indexOf(c);
            sb.append(idx >= 0 ? LAT_LOOKALIKE.charAt(idx) : c);
        }
        return sb.toString().replaceAll("[\\s.\\-_/\\\\()]+", "");
    }

    /* Кириллические буквы и латинские двойники — попарно, посимвольно. Только те, что
       в нижнем регистре неотличимы на глаз: спутать их в названии поля легко, а найти
       потом трудно. */
    private static final String CYR_LOOKALIKE = "асеорхукмтвн";
    private static final String LAT_LOOKALIKE = "aceopxykmtbh";

    private static String enc(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static String text(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }

    private Object json(String s) {
        try {
            return om.readTree(s == null || s.isBlank() ? "{}" : s);
        } catch (Exception e) {
            return om.createObjectNode();
        }
    }

    private String jsonText(Object o) {
        try {
            return o == null ? "{}" : om.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }
}
