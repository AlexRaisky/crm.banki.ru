package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
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

    /** Пополнение справочника партнёров из формы мастера: право то же, что на заведение шаблона. */
    @PostMapping("/partners")
    public Map<String, String> addPartner(@RequestBody Map<String, String> body) {
        access.requireCapability(Capability.ADD, Sections.ADMIN, Sections.TEMPLATES);
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
}
