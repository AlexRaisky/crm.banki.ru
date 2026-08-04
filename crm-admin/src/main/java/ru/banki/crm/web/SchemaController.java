package ru.banki.crm.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.service.SchemaModelService;

import java.util.List;
import java.util.Map;

/**
 * Модель Scheme Builder: хранение, история версий, журнал действий.
 * Контракт задан на фронте (API_CONTRACT в settings/scheme-builder.js) — пути отсюда.
 * <p>
 * Весь раздел живёт в настроечной админке, которая и так под админом
 * (SecurityConfig: /settings/** → hasRole ADMIN). Ручки лежат вне /api/admin/**,
 * поэтому право проверяем аннотацией на классе, а не правилом URL: так не приходится
 * трогать SecurityConfig и рисковать чужими маршрутами.
 */
@RestController
@RequestMapping("/api/schema")
@PreAuthorize("hasRole('ADMIN')")
public class SchemaController {

    private final SchemaModelService service;

    public SchemaController(SchemaModelService service) {
        this.service = service;
    }

    /** Текущая модель. Первое обращение засевает её из файла в classpath. */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public String get() {
        return service.current();
    }

    /**
     * Сохранение модели целиком.
     * <p>
     * Тело принимаем в двух видах: либо конверт {@code {model, changes}} (редактор шлёт
     * вместе с моделью дельты из своего журнала), либо голая модель. Второй вариант —
     * ради совместимости: контракт в редакторе изначально описывал именно её, и ронять
     * сохранение из-за формы тела было бы глупо.
     */
    @PutMapping
    public Map<String, Object> put(@RequestBody JsonNode body) {
        JsonNode model = body.has("model") ? body.get("model") : body;
        JsonNode changes = body.get("changes");
        return service.save(model, changes);
    }

    /** Только дельты из журнала редактора — без перезаписи модели. */
    @PostMapping("/changes")
    public Map<String, Object> changes(@RequestBody JsonNode body) {
        JsonNode changes = body.isArray() ? body : body.get("changes");
        return service.logOnly(changes);
    }

    /** История версий (заголовки, без самих моделей). */
    @GetMapping("/versions")
    public List<Map<String, Object>> versions(@RequestParam(defaultValue = "100") int limit) {
        return service.versions(Math.max(1, Math.min(limit, 500)));
    }

    /** Журнал действий: кто, что и когда. */
    @GetMapping("/audit")
    public List<Map<String, Object>> audit(@RequestParam(defaultValue = "200") int limit) {
        return service.auditLog(Math.max(1, Math.min(limit, 1000)));
    }
}
