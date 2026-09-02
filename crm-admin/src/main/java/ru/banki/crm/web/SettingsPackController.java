package ru.banki.crm.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.service.deploy.SettingsPackService;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Перенос настроек между контурами: собрать пакет здесь, применить там.
 * <p>
 * Под {@code /api/admin/**}, то есть за ролью администратора. Отдельной секции нет
 * намеренно: пакет тащит роли и матрицу прав, а значит тот, кто его применяет, и так
 * распоряжается доступом целиком.
 */
@RestController
@RequestMapping("/api/admin/settings-pack")
public class SettingsPackController {

    private final SettingsPackService pack;

    public SettingsPackController(SettingsPackService pack) {
        this.pack = pack;
    }

    /** Что можно положить в пакет и сколько записей в каждом объекте на этом контуре. */
    @GetMapping
    public List<Map<String, Object>> catalog() {
        return pack.catalog();
    }

    /** Собрать пакет. Без списка — всё, что умеем переносить. */
    @PostMapping("/export")
    public Map<String, Object> export(@RequestBody(required = false) JsonNode body) {
        return pack.export(keys(body));
    }

    /** Что произойдёт при применении присланного пакета — до того, как что-то изменится. */
    @PostMapping("/preview")
    public Map<String, Object> preview(@RequestBody JsonNode body) {
        return pack.preview(body);
    }

    /**
     * Применить. Тело: сам пакет плюс {@code keys} — какие объекты из него брать;
     * без списка применяется всё, что в пакете есть.
     */
    @PostMapping("/apply")
    public Map<String, Object> apply(@RequestBody JsonNode body) {
        JsonNode packNode = body != null && body.has("pack") ? body.get("pack") : body;
        return pack.apply(packNode, keys(body));
    }

    /** Слепки «как было»: что можно вернуть, если перенос оказался неудачным. */
    @GetMapping("/snapshots")
    public List<Map<String, Object>> snapshots(@RequestParam(defaultValue = "30") int limit) {
        return pack.snapshots(limit);
    }

    @PostMapping("/snapshots/{id}/restore")
    public Map<String, Object> restore(@PathVariable long id) {
        return pack.restore(id);
    }

    private static List<String> keys(JsonNode body) {
        List<String> out = new ArrayList<>();
        JsonNode arr = body == null ? null : body.get("keys");
        if (arr != null && arr.isArray()) {
            arr.forEach(n -> {
                String k = n.asText("").trim();
                if (!k.isEmpty()) out.add(k);
            });
        }
        return out;
    }
}
