package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.dto.UserDtos.*;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.UserService;

import java.util.List;
import java.util.Map;

/** ADMIN-only user & access management (guarded by /api/admin/** => hasRole ADMIN in SecurityConfig). */
@RestController
@RequestMapping("/api/admin")
public class AdminUserController {

    private final UserService users;
    private final ru.banki.crm.service.SchemaModelService schema;

    public AdminUserController(UserService users, ru.banki.crm.service.SchemaModelService schema) {
        this.users = users;
        this.schema = schema;
    }

    /**
     * Справочник разделов для матрицы прав: id + метаданные. writable — есть ли
     * add/edit/delete (иначе только просмотр), adminOnly — раздел даёт роль админа,
     * в матрице не-админа он не нужен.
     */
    @GetMapping("/sections")
    public List<Map<String, Object>> sections() {
        List<Map<String, Object>> out = new java.util.ArrayList<>(Sections.ALL.stream()
                .map(s -> Map.<String, Object>of(
                        "id", s,
                        "writable", Sections.isWritable(s),
                        "adminOnly", Sections.isAdminOnly(s),
                        // группа сайдбара: матрица прав рисует по ней заголовки
                        "group", Sections.groupOf(s)))
                .toList());
        out.addAll(entitySections());
        return out;
    }

    /**
     * Строки матрицы для отдельных сущностей CRM. Список берётся из схемы
     * (app.schema_model), потому что сущности заводятся в Scheme Builder, а не в коде:
     * захардкодить их означало бы, что новая сущность появляется в панели, но выдать её
     * нельзя.
     * <p>
     * Подпись приходит с сервера: на клиенте её взять неоткуда — справочник подписей в
     * admin-users.js статический, и сущность показывалась бы сырым ent:client.
     * <p>
     * Сущность с готовым серверным экраном (source, сейчас это «Шаблоны и сегменты»)
     * пропускаем: у неё своя секция (templates), и вторая строка про то же самое только
     * сбивала бы с толку — какая из двух галок решает.
     */
    private List<Map<String, Object>> entitySections() {
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        com.fasterxml.jackson.databind.JsonNode model;
        try {
            model = schema.currentAsNode();
        } catch (RuntimeException e) {
            return out;   // схемы нет или она битая — матрица должна открыться всё равно
        }
        com.fasterxml.jackson.databind.JsonNode schemas = model.get("schemas");
        com.fasterxml.jackson.databind.JsonNode tables = model.get("entities");
        if (schemas == null || !schemas.isArray()) return out;
        for (com.fasterxml.jackson.databind.JsonNode s : schemas) {
            String id = text(s, "id");
            if (id.isEmpty()) continue;
            com.fasterxml.jackson.databind.JsonNode head = head(tables, id);
            if (head != null && !text(head, "source").isEmpty()) continue;
            String label = text(s, "label");
            if (label.isEmpty() && head != null) label = text(head, "label");
            boolean technical = head != null && head.path("technical").asBoolean(false);
            out.add(Map.of(
                    "id", Sections.entity(id),
                    "writable", false,
                    "adminOnly", false,
                    "group", "Сущности",
                    "label", (label.isEmpty() ? id : label) + (technical ? " (служебная)" : "")));
        }
        return out;
    }

    /** Главная таблица схемы — та, чьё имя совпало с именем схемы; иначе первая по порядку. */
    private static com.fasterxml.jackson.databind.JsonNode head(
            com.fasterxml.jackson.databind.JsonNode tables, String schemaId) {
        if (tables == null || !tables.isArray()) return null;
        com.fasterxml.jackson.databind.JsonNode first = null;
        for (com.fasterxml.jackson.databind.JsonNode t : tables) {
            if (!schemaId.equals(text(t, "schema"))) continue;
            if (schemaId.equals(text(t, "id"))) return t;
            if (first == null) first = t;
        }
        return first;
    }

    private static String text(com.fasterxml.jackson.databind.JsonNode n, String field) {
        com.fasterxml.jackson.databind.JsonNode v = n == null ? null : n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText().trim();
    }

    @GetMapping("/users")
    public List<UserView> list() {
        return users.list();
    }

    @PostMapping("/users")
    public UserView create(@Valid @RequestBody CreateUser req) {
        return users.create(req);
    }

    @PutMapping("/users/{id}")
    public UserView update(@PathVariable Long id, @RequestBody UpdateUser req) {
        return users.update(id, req);
    }

    @DeleteMapping("/users/{id}")
    public void delete(@PathVariable Long id) {
        users.delete(id);
    }

    @PutMapping("/users/{id}/password")
    public Map<String, String> resetPassword(@PathVariable Long id, @Valid @RequestBody ResetPassword req) {
        users.resetPassword(id, req.newPassword());
        return Map.of("status", "ok");
    }
}
