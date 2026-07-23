package ru.banki.crm.web;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.AdminLogService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Подключение раздела «Отчёты» к Tableau: адрес сервера, книга и токен.
 * <p>
 * Конфиг общий на всю панель (раньше лежал в localStorage каждого пользователя,
 * из-за чего у всех был свой), задаёт его только ADMIN, остальные лишь читают.
 * Хранится в той же таблице, что и прочие настройки панели — app.panel_settings
 * под ключом 'tableauReports'; отдельная миграция не нужна, строка появляется
 * при первом PUT.
 * <p>
 * Почему свой контроллер, а не PanelSettingsController: там GET открыт любому
 * аутентифицированному, а здесь в значении лежит токен Tableau (JWT/PAT) —
 * READER не должен его вычитать. Санитайзинг ответа возможен только тут,
 * где мы знаем структуру значения.
 */
@RestController
@RequestMapping("/api/reports/connections")
public class ReportConnectionController {

    /** Ключ строки в app.panel_settings — общий документ со всеми отчётами. */
    private static final String SETTINGS_KEY = "tableauReports";

    /** Идентификатор отчёта из фронта (planfact/matrix/leadgen и т.п.) — без вольностей в JSON-ключах. */
    private static final Pattern REPORT_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_-]{0,31}");

    /**
     * Ответ на GET: конфиг по отчётам + признак того, может ли текущий пользователь его менять
     * (фронту нужен, чтобы решить, показывать ли форму подключения).
     */
    public record ConnectionsDto(boolean canEdit, Map<String, Map<String, Object>> items) {}

    @PersistenceContext
    private EntityManager em;

    private final AdminLogService adminLog;
    private final ObjectMapper json;

    public ReportConnectionController(AdminLogService adminLog, ObjectMapper json) {
        this.adminLog = adminLog;
        this.json = json;
    }

    /**
     * Конфиг всех отчётов. Не-админу токен не отдаём вообще — вместо него hasToken,
     * чтобы интерфейс мог сказать «подключение настроено», не раскрывая секрет.
     */
    @GetMapping
    public ConnectionsDto get() {
        boolean admin = isAdmin();
        ObjectNode all = readAll();
        Map<String, Map<String, Object>> items = new LinkedHashMap<>();
        all.fieldNames().forEachRemaining(report -> {
            JsonNode e = all.get(report);
            if (e == null || !e.isObject()) return;
            String token = text(e, "token");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("server", text(e, "server"));
            out.put("view", text(e, "view"));
            out.put("hasToken", !token.isEmpty());
            // Токен уходит в браузер только админу: он же его и задаёт, а <tableau-viz>
            // подставляет его в разметку. Прочим ролям отчёт открывается без token —
            // авторизацию берёт на себя сам Tableau (SSO/гостевой доступ).
            if (admin && !token.isEmpty()) out.put("token", token);
            items.put(report, out);
        });
        return new ConnectionsDto(admin, items);
    }

    /**
     * Сохранить подключение одного отчёта. Тело: {server, view, token}.
     * <p>
     * Пустой/отсутствующий token НЕ затирает сохранённый. Да, админ видит токен в GET,
     * то есть форма приходит заполненной и «пусто» можно было бы считать осознанной
     * очисткой. Но пустое поле слишком легко получить случайно (открыли страницу до
     * загрузки конфига, обновили только адрес сервера, сеть отдала 5xx на GET) — а цена
     * ошибки высокая: токен нигде больше не хранится и его придётся перевыпускать.
     * Поэтому «сохранить» никогда не удаляет секрет, а для осознанного сброса есть DELETE.
     */
    @PutMapping("/{report}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public Map<String, Object> put(@PathVariable String report, @RequestBody JsonNode body) {
        validateReport(report);
        if (body == null || !body.isObject()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ожидается объект {server, view, token}");
        }
        // Адрес и книга обязательны: без них встраивание показывает ту же заглушку
        // «не настроено», что и при отсутствии подключения. Раньше пустые значения
        // сохранялись с кодом 200 — админ жал «Сохранить», не видел ошибки и считал,
        // что отчёт настроен, а у людей он не открывался. Токен при этом НЕ обязателен:
        // если Tableau пускает по SSO или гостевым доступом, он не нужен.
        String server = text(body, "server").replaceAll("/+$", "");
        String view = text(body, "view");
        if (server.isEmpty() || view.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Укажите адрес Tableau и опубликованную книгу/лист — оба поля обязательны."
                    + " Чтобы убрать подключение, нажмите «Очистить».");
        }

        ObjectNode all = readAll();
        JsonNode prev = all.get(report);
        String prevToken = (prev != null && prev.isObject()) ? text(prev, "token") : "";

        String token = text(body, "token");
        if (token.isEmpty()) token = prevToken;

        ObjectNode entry = json.createObjectNode();
        entry.put("server", server);
        entry.put("view", view);
        entry.put("token", token);
        all.set(report, entry);
        write(all);
        // Отдаём и токен: эндпоинт и так только для ADMIN, а фронту нужно обновить кэш
        // (при пустом поле токен взят из старого значения, иначе встраивание потеряет его
        // до следующей перезагрузки страницы).
        return adminView(entry);
    }

    /** Полный сброс подключения отчёта — единственный способ удалить сохранённый токен. */
    @DeleteMapping("/{report}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public Map<String, Object> delete(@PathVariable String report) {
        validateReport(report);
        ObjectNode all = readAll();
        all.remove(report);
        write(all);
        return Map.of("server", "", "view", "", "hasToken", false);
    }

    /* ---------- хранилище ---------- */

    private ObjectNode readAll() {
        List<?> rows = em.createNativeQuery(
                        "SELECT value::text FROM app.panel_settings WHERE key = :k")
                .setParameter("k", SETTINGS_KEY)
                .getResultList();
        if (rows.isEmpty()) return json.createObjectNode();
        try {
            JsonNode node = json.readTree(String.valueOf(rows.get(0)));
            return node != null && node.isObject() ? (ObjectNode) node : json.createObjectNode();
        } catch (JsonProcessingException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Не удалось разобрать конфиг подключений к Tableau", e);
        }
    }

    private void write(ObjectNode all) {
        em.createNativeQuery(
                        "INSERT INTO app.panel_settings (key, value, timestamp_upd)" +
                        " VALUES (:k, CAST(:v AS jsonb), now())" +
                        " ON CONFLICT (key) DO UPDATE SET value = CAST(:v AS jsonb), timestamp_upd = now()")
                .setParameter("k", SETTINGS_KEY)
                .setParameter("v", all.toString())
                .executeUpdate();
        // Журнал действий: пишем только факт правки и состав отчётов — саму строку
        // целиком (как делает PanelSettingsController) нельзя: в ней токен, а он утечёт
        // в t_admin_log, доступный шире, чем сам конфиг. Автора проставит AdminLogService.
        ObjectNode logRow = json.createObjectNode();
        logRow.put("key", SETTINGS_KEY);
        List<String> names = new java.util.ArrayList<>();
        all.fieldNames().forEachRemaining(names::add);
        logRow.put("reports", String.join(",", names));
        adminLog.logTable("app.panel_settings", "UPDATE", logRow.toString());
    }

    /* ---------- утилиты ---------- */

    private static boolean isAdmin() {
        return CurrentUser.principal()
                .map(p -> p.user().getRole().isAdminLevel())
                .orElse(false);
    }

    private static void validateReport(String report) {
        if (report == null || !REPORT_PATTERN.matcher(report).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Некорректный идентификатор отчёта (ожидается [a-zA-Z][a-zA-Z0-9_-]{0,31})");
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull()) ? "" : v.asText("").trim();
    }

    /** Ответ на запись: тот же вид, что и в GET у админа. */
    private static Map<String, Object> adminView(ObjectNode entry) {
        String token = entry.path("token").asText("");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("server", entry.path("server").asText(""));
        out.put("view", entry.path("view").asText(""));
        out.put("hasToken", !token.isEmpty());
        if (!token.isEmpty()) out.put("token", token);
        return out;
    }
}
