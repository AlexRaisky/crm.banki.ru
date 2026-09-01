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

    // ------------------------------------------------------------------ заведение задачи

    /**
     * Завести задачу по нашим данным.
     * <p>
     * Работа в два шага, и это не прихоть: часть полей проекта не выведена на экран
     * создания — «Source», «Letteros ID», «Финальная ссылка». В запросе создания Jira их
     * не примет («Field cannot be set. It is not on the appropriate screen»), поэтому
     * сначала создаём задачу тем, что экран принимает, а остальное дописываем правкой.
     * <p>
     * Если второй шаг не удался, задача всё равно создана — возвращаем ключ и честное
     * предупреждение вместо отката: отменять уже заведённую задачу хуже, чем дозаполнить
     * пару полей руками.
     *
     * @param data наши ключи (channel, customer, …) со значениями из панели
     * @return key, ссылка и что не доехало
     */
    @Transactional
    public Map<String, Object> createIssue(Map<String, Object> data) {
        Object[] r = row();
        String project = str(r[2]);
        String type = str(r[3]);
        String labels = str(r[4]);
        JsonNode fieldMap = node(str(r[5]));
        JsonNode valueMap = node(str(r[6]));
        if (project.isEmpty() || type.isEmpty()) {
            throw bad("Не заданы ключ проекта или тип задачи: «Настройки» → «Интеграции» → Jira.");
        }
        if (fieldMap.isEmpty()) {
            throw bad("Карта полей пуста. Нажмите «Сопоставить поля» в настройках Jira.");
        }

        Map<String, Object> m = meta();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> screen = (List<Map<String, Object>>) m.get("fields");
        Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
        screen.forEach(f -> byId.put(String.valueOf(f.get("id")), f));

        ObjectNode create = om.createObjectNode();
        ObjectNode later = om.createObjectNode();
        /* Значения в том написании, которое приняла Jira: заголовок задачи должен читаться
           как её же поля — «E-mail - Карты - Debitcards», а не «email - Карты - general». */
        Map<String, String> shown = new LinkedHashMap<>();
        /* Что не доехало и почему — одним списком: и пропущенные поля, и поля вне экрана
           создания. Человеку важно одно — чего в задаче не будет. */
        List<String> notes = new ArrayList<>();
        create.set("project", om.createObjectNode().put("key", project));
        create.set("issuetype", om.createObjectNode().put("name", type));
        String reporter = str(data.get("reporterEmail"));
        if (!reporter.isEmpty()) {
            String login = userLogin(reporter);
            if (login != null) {
                create.set("reporter", om.createObjectNode().put("name", login));
            }
        }
        if (!labels.isBlank()) {
            var arr = create.putArray("labels");
            for (String l : labels.split("[,;\\s]+")) {
                if (!l.isBlank()) arr.add(l.trim());
            }
        }

        fieldMap.fields().forEachRemaining(e -> {
            String ourKey = e.getKey();
            String fieldId = e.getValue().asText("");
            String value = str(data.get(ourKey));
            if (fieldId.isEmpty() || value.isEmpty()) {
                return;
            }
            /* Наше значение может называться в Jira иначе — «email» против «Email»,
               «ДК» против «Дебетовые карты». Соответствие живёт в value_map. */
            JsonNode swap = valueMap.path(ourKey).path(value);
            if (swap.isTextual() && !swap.asText().isBlank()) {
                value = swap.asText();
            }
            Map<String, Object> f = byId.get(fieldId);
            if (f == null) {
                later.set(fieldId, coerce(null, value));   // поля нет на экране создания
                shown.put(ourKey, value);
            } else {
                JsonNode ready = coerce(f, value);
                if (ready == null) {
                    /* Единственный случай — пользователь не нашёлся (см. coerce). */
                    String hint = "в Jira нет пользователя «" + value + "». Если он там"
                            + " записан иначе — Александра вместо Саши, — свяжите написания"
                            + " в «Настройки» → «Интеграции» → Jira → «Соответствие"
                            + " значений», либо укажите в плане его логин или рабочую почту";
                    if (Boolean.TRUE.equals(f.get("required"))) {
                        throw bad("Поле «" + f.get("name") + "» обязательно, но " + hint + ".");
                    }
                    notes.add("поле «" + f.get("name") + "» осталось пустым: " + hint);
                    return;
                }
                create.set(fieldId, ready);
                /* option приходит объектом {"value": …} — в заголовок берём именно это
                   написание, оно и стоит потом в карточке. */
                shown.put(ourKey, ready.isObject() ? ready.path("value").asText(value) : value);
            }
        });

        create.put("summary", summary(data, shown));
        ObjectNode payload = om.createObjectNode();
        payload.set("fields", create);
        JsonNode res = client().post("/rest/api/2/issue", payload.toString());
        String key = res.path("key").asText("");
        if (key.isEmpty()) {
            throw bad("Jira не вернула ключ созданной задачи");
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("key", key);
        out.put("url", str(r[0]).replaceAll("/+$", "") + "/browse/" + key);
        if (!later.isEmpty()) {
            ObjectNode upd = om.createObjectNode();
            upd.set("fields", later);
            try {
                client().put("/rest/api/2/issue/" + key, upd.toString());
                out.put("lateFilled", later.size());
            } catch (ResponseStatusException e) {
                /* Задача уже есть — не падаем, а говорим, что дозаполнить руками. */
                notes.add("поля вне экрана создания не записались: " + e.getReason());
            }
        }
        if (!notes.isEmpty()) {
            out.put("warning", "Задача " + key + " создана, но " + String.join("; ", notes) + ".");
        }
        return out;
    }

    /**
     * Заголовок задачи. На форме Jira его собирает скрипт («Поле заполняется
     * автоматически»), но через API он обязателен и никем не подставляется, поэтому
     * повторяем тот же порядок частей.
     */
    private static String summary(Map<String, Object> data, Map<String, String> shown) {
        String given = str(data.get("summary"));
        if (!given.isBlank()) {
            return given;
        }
        List<String> parts = new ArrayList<>();
        for (String k : List.of("channel", "customer", "product", "kind", "name", "sendDate")) {
            String v = shown.getOrDefault(k, str(data.get(k)));
            if (v.isBlank()) {
                continue;
            }
            parts.add("sendDate".equals(k) ? humanDate(v) : v);
        }
        return parts.isEmpty() ? "Промо" : String.join(" - ", parts);
    }

    /** В заголовке дата принята по-русски: 20.08.2026, а не 2026-08-20. */
    private static String humanDate(String iso) {
        String[] p = iso.length() >= 10 ? iso.substring(0, 10).split("-") : new String[0];
        return p.length == 3 ? p[2] + "." + p[1] + "." + p[0] : iso;
    }

    /**
     * Значение в том виде, в каком его ждёт поле. Тип берём из createmeta: список хочет
     * объект с value, пользовательское поле — логин, массив — массив. Для поля, которого
     * на экране создания нет ({@code f == null}), типа мы не знаем — шлём строкой, такие
     * поля у нас текстовые.
     * <p>
     * {@code null} в ответе значит «значение отправлять нельзя»: так возвращается
     * пользовательское поле, для которого в Jira не нашлось человека.
     */
    private JsonNode coerce(Map<String, Object> f, String raw) {
        if (f == null) {
            return om.getNodeFactory().textNode(raw);
        }
        String type = str(f.get("type"));
        String items = str(f.get("items"));
        @SuppressWarnings("unchecked")
        List<String> allowed = (List<String>) f.getOrDefault("values", List.of());
        String value = raw;
        if (!allowed.isEmpty()) {
            /* Вариант в Jira пишут по-своему: у нас «email», у них «E-mail», у нас
               «mobile-push» — у них «Mobile Push». Ищем тем же способом, что и имена
               полей: без регистра, пробелов и разделителей. Нашли — подставляем их
               написание, иначе Jira не примет. */
            String want = norm(value);
            String hit = allowed.stream().filter(v -> norm(v).equals(want)).findFirst().orElse(null);
            if (hit == null) {
                throw bad("Поле «" + f.get("name") + "»: значение «" + value + "» не из списка Jira. "
                        + "Допустимо: " + String.join(", ", allowed.subList(0, Math.min(allowed.size(), 12)))
                        + (allowed.size() > 12 ? " …" : "")
                        + ". Поправьте данные в панели или задайте соответствие значений в value_map.");
            }
            value = hit;
        }
        switch (type) {
            case "option":
                return om.createObjectNode().put("value", value);
            case "user":
                String login = userLogin(value);
                /* Не нашли — не отправляем нашу строку вместо логина. Jira отвечает на
                   это 400 по всей задаче («User 'Саша' was not found in the system»), и
                   из-за одного поля не заводится ничего. Решает вызывающий: поле
                   необязательное — оставим пустым, обязательное — объясним человеку. */
                return login == null ? null : om.createObjectNode().put("name", login);
            case "number":
                try {
                    return om.getNodeFactory().numberNode(Double.parseDouble(value));
                } catch (NumberFormatException ignored) {
                    return om.getNodeFactory().textNode(value);
                }
            case "array":
                var arr = om.createArrayNode();
                if ("string".equals(items)) {
                    arr.add(value);
                } else {
                    arr.add(om.createObjectNode().put("value", value));
                }
                return arr;
            default:
                return om.getNodeFactory().textNode(value);
        }
    }

    /**
     * Логин в Jira по почте, логину или имени. Нужен для Reporter и полей-пользователей:
     * Data Center ждёт именно логин, а панель знает человека кто как — почтой у себя в
     * профиле, а в плане и вовсе живой строкой «Саша».
     * <p>
     * Ищем в три захода, потому что ручки ищут по-разному: {@code user/search} — по
     * логину и почте, {@code user/picker} — ещё и по отображаемому имени, третий заход
     * с {@code query} на случай инстанса, который понимает облачный параметр.
     * <p>
     * Не нашли — null. Дальше это уже не «поле не заполнится»: за {@code null} следят
     * вызывающие, потому что отправленная в Jira строка, которая не логин, роняет
     * создание задачи целиком.
     */
    private String userLogin(String emailOrName) {
        String q = emailOrName == null ? "" : emailOrName.trim();
        if (q.isEmpty()) {
            return null;
        }
        String hit = firstUser("/rest/api/2/user/search?maxResults=5&username=" + enc(q), null);
        if (hit == null) {
            hit = firstUser("/rest/api/2/user/picker?maxResults=5&query=" + enc(q), "users");
        }
        if (hit == null) {
            hit = firstUser("/rest/api/2/user/search?maxResults=5&query=" + enc(q), null);
        }
        return hit;
    }

    /**
     * Логин первого найденного человека.
     *
     * @param arrayField где в ответе лежит массив: у {@code user/picker} это
     *                   {@code users}, у {@code user/search} — сам ответ
     */
    private String firstUser(String path, String arrayField) {
        try {
            JsonNode res = client().get(path);
            JsonNode arr = arrayField == null ? res : res.path(arrayField);
            if (arr != null && arr.isArray() && arr.size() > 0) {
                String name = arr.get(0).path("name").asText("");
                return name.isBlank() ? null : name;
            }
        } catch (RuntimeException ignored) {
            /* Ручки может не быть на этой версии или нет прав на поиск людей —
               пробуем следующую, а не падаем. */
        }
        return null;
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
            /* Для массива важно, из чего он: labels — это массив строк, а «Партнёр
               Раздела» — массив вариантов, и обёртка у них разная. */
            m.put("items", f.path("schema").path("items").asText(""));
            m.put("onCreateScreen", true);
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
     * Поля-списки и то, как их значения называются у них и у нас.
     * <p>
     * Списки в Jira закрытые: «Розница» не пройдёт, если в справочнике проекта стоит
     * «Карты». Панель подбирает написание сама (без регистра и разделителей), но когда
     * слова разные, помочь может только человек — и до сих пор он делал это правкой
     * value_map в базе. Здесь собрано всё, что нужно форме: наш ключ, поле, допустимые
     * значения Jira и уже заданные пары.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> valueOptions() {
        Object[] r = row();
        JsonNode fieldMap = node(str(r[5]));
        JsonNode valueMap = node(str(r[6]));

        Map<String, Object> m = meta();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> screen = (List<Map<String, Object>>) m.get("fields");
        Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
        screen.forEach(f -> byId.put(String.valueOf(f.get("id")), f));

        List<Map<String, Object>> out = new ArrayList<>();
        OUR_FIELDS.forEach((ourKey, title) -> {
            String fieldId = fieldMap.path(ourKey).asText("");
            Map<String, Object> f = fieldId.isEmpty() ? null : byId.get(fieldId);
            if (f == null) {
                return;   // поле не привязано или не на экране создания — списка значений нет
            }
            @SuppressWarnings("unchecked")
            List<String> allowed = (List<String>) f.getOrDefault("values", List.of());
            boolean user = "user".equals(str(f.get("type")));
            if (allowed.isEmpty() && !user) {
                return;   // свободный текст: сопоставлять нечего
            }
            /* Поля-пользователи попадают сюда без списка значений: людей в инстансе
               тысячи, и списком их не выдают. Пара всё равно нужна — «Саша» в плане и
               «Александра» в Jira это один человек, а связать их больше негде: поиск
               по имени такого не находит, а править план ради Jira неправильно. */
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("key", ourKey);
            row.put("title", title);
            row.put("fieldId", fieldId);
            row.put("allowed", allowed);
            row.put("user", user);
            Map<String, String> pairs = new LinkedHashMap<>();
            valueMap.path(ourKey).fields().forEachRemaining(e -> pairs.put(e.getKey(), e.getValue().asText("")));
            row.put("pairs", pairs);
            out.add(row);
        });

        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("fields", out);
        answer.put("valueMap", json(str(r[6])));
        return answer;
    }

    /**
     * Все поля инстанса, а не только те, что выведены на экран создания.
     * <p>
     * Нужны потому, что экран создания у проекта обычно куда беднее карточки: «Source» и
     * «А/В-тестирование» на задаче видны, а при заведении их не спрашивают. Такое поле
     * заполняется вторым шагом — правкой уже созданной задачи, — но привязать его к
     * нашему нужно заранее, иначе панель про него просто не знает.
     */
    public List<Map<String, Object>> allFields() {
        JsonNode res = client().get("/rest/api/2/field");
        List<Map<String, Object>> out = new ArrayList<>();
        if (res != null && res.isArray()) {
            res.forEach(f -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", f.path("id").asText(""));
                m.put("name", f.path("name").asText(""));
                m.put("type", f.path("schema").path("type").asText(""));
                m.put("onCreateScreen", false);
                if (!String.valueOf(m.get("id")).isEmpty()) {
                    out.add(m);
                }
            });
        }
        return out;
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
        List<Map<String, Object>> screen = (List<Map<String, Object>>) m.get("fields");
        /* Поля карточки, которых нет на экране создания. Ищем в них вторым кругом:
           «Source» и «А/В-тестирование» именно такие — в задаче есть, при заведении не
           спрашиваются. Если Jira не дала общий список (прав не хватило), работаем как
           раньше, только по экрану создания. */
        List<Map<String, Object>> offScreen = new ArrayList<>();
        try {
            Set<String> onScreen = new LinkedHashSet<>();
            screen.forEach(f -> onScreen.add(String.valueOf(f.get("id"))));
            allFields().forEach(f -> {
                if (!onScreen.contains(String.valueOf(f.get("id")))) offScreen.add(f);
            });
        } catch (RuntimeException e) {
            offScreen.clear();
        }

        ObjectNode fieldMap = om.createObjectNode();
        List<Map<String, Object>> unmatched = new ArrayList<>();
        List<Map<String, Object>> late = new ArrayList<>();   // привязаны, но не на экране создания
        OUR_FIELDS.forEach((ourKey, jiraName) -> {
            List<String> names = new ArrayList<>();
            names.add(jiraName);
            names.addAll(ALIASES.getOrDefault(ourKey, List.of()));

            /* Экран создания в приоритете: если поле есть там, однофамильцы из общего
               списка полей нас не интересуют — заполнять всё равно будем это. */
            List<String> hits = matchAll(screen, names);
            boolean fromScreen = !hits.isEmpty();
            if (hits.isEmpty()) {
                hits = matchAll(offScreen, names);
            }

            if (hits.size() == 1) {
                String id = hits.get(0);
                fieldMap.put(ourKey, id);
                if (!fromScreen) {
                    Map<String, Object> l = new LinkedHashMap<>();
                    l.put("key", ourKey);
                    l.put("name", jiraName);
                    l.put("id", id);
                    late.add(l);
                }
                return;
            }

            Map<String, Object> miss = new LinkedHashMap<>();
            miss.put("key", ourKey);
            miss.put("name", jiraName);
            miss.put("ambiguous", hits.size() > 1);
            miss.put("candidates", hits.size() > 1
                    ? named(hits, screen, offScreen)      // одноимённые: выбирать человеку
                    : candidates(screen, names));         // не нашлось: показываем похожие
            unmatched.add(miss);
        });
        em.createNativeQuery("UPDATE app.jira_connection SET field_map = CAST(:fm AS jsonb),"
                        + " timestamp_upd = now(), updated_by = :u WHERE id = 1")
                .setParameter("fm", fieldMap.toString())
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
        List<Map<String, Object>> all = new ArrayList<>(screen);
        all.addAll(offScreen);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("matched", fieldMap.size());
        out.put("unmatched", unmatched);
        out.put("late", late);       // нашлись, но заполнятся после создания задачи
        out.put("fieldMap", json(fieldMap.toString()));
        out.put("fields", all);      // фронту — чтобы дать выбрать поле руками
        return out;
    }

    /**
     * Все поля, подходящие под любое из имён: сперва точные совпадения, и только если их
     * нет — совпадения по началу имени.
     * <p>
     * Именно все, а не первое попавшееся. В инстансе живут поля-однофамильцы: «Source»
     * нашёлся дважды, и автосопоставление молча взяло чужое, customfield_12441 вместо
     * customfield_19070. Задача завелась, поле осталось пустым, и понять почему можно
     * было только из базы. Пусть лучше панель признается, что не знает, какое из двух.
     */
    private static List<String> matchAll(List<Map<String, Object>> fields, List<String> names) {
        List<String> exact = new ArrayList<>();
        for (String want : names) {
            for (String id : findFields(fields, norm(want), false)) {
                if (!exact.contains(id)) exact.add(id);
            }
        }
        if (!exact.isEmpty()) {
            return exact;
        }
        List<String> loose = new ArrayList<>();
        for (String want : names) {
            for (String id : findFields(fields, norm(want), true)) {
                if (!loose.contains(id)) loose.add(id);
            }
        }
        return loose;
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

    private static List<String> findFields(List<Map<String, Object>> fields, String want, boolean loose) {
        List<String> out = new ArrayList<>();
        if (want.isEmpty() || (loose && want.length() < LOOSE_MIN_LEN)) {
            return out;
        }
        for (Map<String, Object> f : fields) {
            String have = norm(String.valueOf(f.get("name")));
            if (loose ? have.startsWith(want) : have.equals(want)) {
                out.add(String.valueOf(f.get("id")));
            }
        }
        return out;
    }

    /** Поля по списку id — с именами, чтобы человеку было из чего выбирать. */
    private static List<Map<String, Object>> named(List<String> ids,
                                                   List<Map<String, Object>> screen,
                                                   List<Map<String, Object>> offScreen) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String id : ids) {
            Map<String, Object> f = find(screen, id);
            boolean onScreen = f != null;
            if (f == null) f = find(offScreen, id);
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", id);
            c.put("name", f == null ? id : f.get("name"));
            c.put("onCreateScreen", onScreen);
            out.add(c);
        }
        return out;
    }

    private static Map<String, Object> find(List<Map<String, Object>> fields, String id) {
        for (Map<String, Object> f : fields) {
            if (id.equals(String.valueOf(f.get("id")))) {
                return f;
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

    /** То же, что json(), но типом: наружу карты уходят как Object, внутри нужен узел. */
    private JsonNode node(String s) {
        Object o = json(s);
        return o instanceof JsonNode n ? n : om.createObjectNode();
    }

    /** Отказ с понятной причиной — её видно в интерфейсе, поэтому пишем по-человечески. */
    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private String jsonText(Object o) {
        try {
            return o == null ? "{}" : om.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }
}
