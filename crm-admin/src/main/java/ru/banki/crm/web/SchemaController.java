package ru.banki.crm.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
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
 * (SecurityConfig: /api/schema/** → секции set-scheme / set-objects / set-dbtree).
 * поэтому право проверяем аннотацией на классе, а не правилом URL: так не приходится
 * трогать SecurityConfig и рисковать чужими маршрутами.
 */
@RestController
@RequestMapping("/api/schema")
public class SchemaController {

    private final SchemaModelService service;
    private final ru.banki.crm.service.schema.SchemaDdlService ddl;
    private final ru.banki.crm.service.schema.SchemaInspectService inspect;
    private final ru.banki.crm.security.AccessGuard access;

    public SchemaController(SchemaModelService service,
                            ru.banki.crm.service.schema.SchemaDdlService ddl,
                            ru.banki.crm.service.schema.SchemaInspectService inspect,
                            ru.banki.crm.security.AccessGuard access) {
        this.service = service;
        this.ddl = ddl;
        this.inspect = inspect;
        this.access = access;
    }

    /**
     * Что реально есть в базе: схемы с вложенными таблицами. Только чтение —
     * обозреватель для админа и заодно проверка того, что применение DDL сработало.
     */
    @GetMapping("/db")
    public List<Map<String, Object>> db() {
        return inspect.tree();
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

    /**
     * Что будет выполнено в базе — без выполнения. Тело: модель либо {@code {model}}.
     * Модель не передали — берём сохранённую, чтобы можно было посмотреть план по текущей.
     */
    @PostMapping("/ddl/preview")
    public Map<String, Object> ddlPreview(@RequestBody(required = false) JsonNode body) {
        return ddl.preview(modelOf(body));
    }

    /** Применить модель к базе: схемы, таблицы, колонки, внешние ключи. Только аддитивно. */
    @PostMapping("/ddl/apply")
    public Map<String, Object> ddlApply(@RequestBody(required = false) JsonNode body) {
        try {
            return ddl.apply(modelOf(body));
        } catch (RuntimeException e) {
            // отказ охраны и падение SQL для пользователя выглядят одинаково — как 400
            // с текстом причины; в журнале они уже разведены на REJECTED и ERROR
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /**
     * Колонки, которые есть в базе, но которых больше нет в модели. Только чтение:
     * вместе с каждой возвращаются заполненность, соседние колонки (куда можно перенести
     * данные) и связи, которые придётся снять.
     */
    @PostMapping("/ddl/drops")
    public Map<String, Object> ddlDrops(@RequestBody(required = false) JsonNode body) {
        return ddl.dropCandidates(modelOf(body));
    }

    /**
     * Удалить колонки из базы. Единственная разрушительная ручка билдера, поэтому:
     * тело обязано нести решения по каждой колонке (что с данными, что со связями),
     * а список кандидатов сервер пересчитывает сам — телу запроса тут веры нет.
     */
    @PostMapping("/ddl/drop")
    public Map<String, Object> ddlDrop(@RequestBody JsonNode body) {
        try {
            return ddl.dropColumns(modelOf(body), body == null ? null : body.get("drops"));
        } catch (RuntimeException e) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /**
     * Взять существующие таблицы схемы под управление конструктора и вернуть их колонки —
     * из них редактор соберёт сущности. Одним запросом, потому что это одно действие:
     * взять и завести; половина результата смысла не имеет.
     */
    @PostMapping("/db/adopt")
    public Map<String, Object> adopt(@RequestBody JsonNode body) {
        access.requireCapability(ru.banki.crm.domain.Capability.EDIT,
                ru.banki.crm.service.Sections.SET_DBTREE,
                ru.banki.crm.service.Sections.SET_SCHEME,
                ru.banki.crm.service.Sections.SET_OBJECTS);
        String schema = txt(body, "schema");
        List<String> tables = new java.util.ArrayList<>();
        JsonNode arr = body == null ? null : body.get("tables");
        if (arr != null && arr.isArray()) {
            arr.forEach(n -> {
                String t = n.asText("").trim();
                if (!t.isEmpty()) tables.add(t);
            });
        }
        try {
            Map<String, Object> res = new java.util.LinkedHashMap<>(ddl.adopt(schema, tables));
            res.put("columns", inspect.columns(schema, tables));
            return res;
        } catch (RuntimeException e) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /**
     * Сколько строк в таблице и кто на неё ссылается — данные для диалога удаления.
     * Право спрашиваем то же, что и на само удаление: показывать «в таблице 40 тысяч
     * строк» тому, кто удалять не может, незачем.
     */
    @PostMapping("/ddl/table-info")
    public Map<String, Object> tableInfo(@RequestBody JsonNode body) {
        requireDrop();
        return ddl.tableInfo(txt(body, "schema"), txt(body, "table"));
    }

    /**
     * Удалить таблицу и её сущность в модели. Непустая таблица требует rows — ровно то
     * число строк, которое показал table-info; связи из чужих таблиц — cascade.
     */
    @PostMapping("/ddl/drop-table")
    public Map<String, Object> dropTable(@RequestBody JsonNode body) {
        requireDrop();
        try {
            JsonNode rows = body == null ? null : body.get("rows");
            return ddl.dropTable(txt(body, "schema"), txt(body, "table"),
                    body != null && body.path("cascade").asBoolean(false),
                    rows == null || rows.isNull() ? null : rows.asLong());
        } catch (RuntimeException e) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /** Удалить пустую схему, заведённую билдером. */
    @PostMapping("/ddl/drop-schema")
    public Map<String, Object> dropSchema(@RequestBody JsonNode body) {
        requireDrop();
        try {
            return ddl.dropSchema(txt(body, "schema"));
        } catch (RuntimeException e) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /** Право на удаление — в любом из разделов, за которыми живёт конструктор схемы. */
    private void requireDrop() {
        access.requireCapability(ru.banki.crm.domain.Capability.DELETE,
                ru.banki.crm.service.Sections.SET_DBTREE,
                ru.banki.crm.service.Sections.SET_SCHEME,
                ru.banki.crm.service.Sections.SET_OBJECTS);
    }

    private static String txt(JsonNode body, String field) {
        JsonNode v = body == null ? null : body.get(field);
        return v == null || v.isNull() ? "" : v.asText().trim();
    }

    /** Модель из тела запроса, а при пустом теле — сохранённая. */
    private JsonNode modelOf(JsonNode body) {
        if (body != null && body.has("model")) return body.get("model");
        if (body != null && body.has("entities")) return body;
        return service.currentAsNode();
    }
}
