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
import java.util.List;
import java.util.Map;

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
     * Сравниваем без учёта регистра, пробелов и «ё»: подпись в форме и name в API
     * совпадают не всегда до символа. Что не нашлось — остаётся пустым, и это честнее,
     * чем привязать «Сервис» к первому похожему полю и получить сюрприз в проде.
     */
    @Transactional
    public Map<String, Object> autoMap() {
        Map<String, Object> m = meta();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> fields = (List<Map<String, Object>>) m.get("fields");
        ObjectNode fieldMap = om.createObjectNode();
        List<String> unmatched = new ArrayList<>();
        OUR_FIELDS.forEach((ourKey, jiraName) -> {
            String want = norm(jiraName);
            String id = null;
            for (Map<String, Object> f : fields) {
                if (want.equals(norm(String.valueOf(f.get("name"))))) {
                    id = String.valueOf(f.get("id"));
                    break;
                }
            }
            if (id == null) {
                unmatched.add(jiraName);
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

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase().replace('ё', 'е').replaceAll("[\\s.]+", "");
    }

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
