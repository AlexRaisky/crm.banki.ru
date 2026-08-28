package ru.banki.crm.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.DictionaryService;
import ru.banki.crm.service.Sections;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dictionaries")
public class DictionaryController {

    private final DictionaryService service;
    private final AccessGuard access;

    public DictionaryController(DictionaryService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    @GetMapping("/partners")
    public List<String> partners() {
        return service.partnerNames();
    }

    /**
     * Пополнение справочника партнёров. Право — как на заведение шаблона ИЛИ промо:
     * справочник у них общий, и планировщик промо встречает нового партнёра ничуть
     * не реже. Без раздела promo кнопка «+» в плане упиралась бы в 403.
     */
    @PostMapping("/partners")
    public Map<String, String> addPartner(@RequestBody Map<String, String> body) {
        access.requireCapability(Capability.ADD, Sections.ADMIN, Sections.TEMPLATES, Sections.PROMO);
        return Map.of("name", service.addPartner(body == null ? null : body.get("name")));
    }

    @GetMapping("/cc-segments")
    public List<Map<String, Object>> ccSegments() {
        return service.ccSegments();
    }

    @GetMapping("/comm-names")
    public List<String> commNames(@RequestParam(required = false) String channel) {
        return service.communicationNames(channel);
    }

    @GetMapping("/touch-points")
    public List<String> touchPoints() {
        return service.touchPoints();
    }

    @GetMapping("/product-types")
    public List<String> productTypes() {
        return service.productTypes();
    }

    // ------------------------------------------------------------------ ведение справочников
    /* Правка справочников — секция настроек set-refs, а не тех разделов, где значения
       используются. Пополнить список из формы мастера (кнопка «+») и вести сам справочник
       — разные полномочия: первое делают каждый день, второе меняет то, что видят все. */

    @GetMapping("/refs/{kind}")
    public List<Map<String, Object>> refRows(@PathVariable String kind) {
        access.requireCapability(Capability.READ, Sections.SET_REFS);
        return service.refRows(kind);
    }

    @PostMapping("/refs/{kind}")
    public Map<String, Object> refAdd(@PathVariable String kind, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.ADD, Sections.SET_REFS);
        Object order = body == null ? null : body.get("sortOrder");
        return service.refAdd(kind,
                body == null ? null : String.valueOf(body.get("value")),
                order == null ? null : Integer.valueOf(String.valueOf(order)));
    }

    @PatchMapping("/refs/{kind}/{id}")
    public Map<String, Object> refSetActive(@PathVariable String kind, @PathVariable long id,
                                            @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.SET_REFS);
        return service.refSetActive(kind, id, !Boolean.FALSE.equals(body == null ? null : body.get("isActive")));
    }

    @DeleteMapping("/refs/{kind}/{id}")
    public Map<String, Object> refDelete(@PathVariable String kind, @PathVariable long id) {
        access.requireCapability(Capability.DELETE, Sections.SET_REFS);
        service.refDelete(kind, id);
        return Map.of("deleted", true);
    }
}
