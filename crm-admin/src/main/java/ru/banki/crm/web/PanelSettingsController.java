package ru.banki.crm.web;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.service.AdminLogService;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Серверные настройки панели (app.panel_settings: key → jsonb).
 * Первый потребитель — настроечная админка /settings: конфиг «приложение → разделы»
 * под ключом 'appSections'. Чтение — любой аутентифицированный (оболочка панели
 * применяет конфиг при загрузке), запись — только ADMIN.
 */
@RestController
@RequestMapping("/api/panel-settings")
public class PanelSettingsController {

    /** Допустимые ключи: буква, дальше буквы/цифры/_/-, всего ≤ 64 (по ширине колонки). */
    private static final Pattern KEY_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_-]{0,63}");

    public record SettingDto(String key, JsonNode value) {}

    @PersistenceContext
    private EntityManager em;

    private final AdminLogService adminLog;
    private final ObjectMapper json;

    public PanelSettingsController(AdminLogService adminLog, ObjectMapper json) {
        this.adminLog = adminLog;
        this.json = json;
    }

    @GetMapping("/{key}")
    public SettingDto get(@PathVariable String key) {
        validateKey(key);
        List<?> rows = em.createNativeQuery(
                        "SELECT value::text FROM app.panel_settings WHERE key = :k")
                .setParameter("k", key)
                .getResultList();
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Настройка не найдена: " + key);
        }
        return new SettingDto(key, parse(String.valueOf(rows.get(0))));
    }

    @PutMapping("/{key}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public SettingDto put(@PathVariable String key, @RequestBody JsonNode value) {
        validateKey(key);
        if (value == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Пустое тело запроса");
        }
        em.createNativeQuery(
                        "INSERT INTO app.panel_settings (key, value, timestamp_upd)" +
                        " VALUES (:k, CAST(:v AS jsonb), now())" +
                        " ON CONFLICT (key) DO UPDATE SET value = CAST(:v AS jsonb), timestamp_upd = now()")
                .setParameter("k", key)
                .setParameter("v", value.toString())
                .executeUpdate();
        // Журнал действий: фиксируем строку ПОСЛЕ изменения (как для INSERT в шаблонах).
        List<?> rows = em.createNativeQuery(
                        "SELECT to_jsonb(t)::text FROM app.panel_settings t WHERE t.key = :k")
                .setParameter("k", key)
                .getResultList();
        adminLog.logTable("app.panel_settings", "UPDATE",
                rows.isEmpty() ? null : String.valueOf(rows.get(0)));
        return new SettingDto(key, value);
    }

    private static void validateKey(String key) {
        if (key == null || !KEY_PATTERN.matcher(key).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Некорректный ключ настройки (ожидается [a-zA-Z][a-zA-Z0-9_-]{0,63})");
        }
    }

    private JsonNode parse(String text) {
        try {
            return json.readTree(text);
        } catch (JsonProcessingException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Не удалось разобрать значение настройки", e);
        }
    }
}
