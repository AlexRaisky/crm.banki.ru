package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.service.DictionaryService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dictionaries")
public class DictionaryController {

    private final DictionaryService service;

    public DictionaryController(DictionaryService service) {
        this.service = service;
    }

    @GetMapping("/partners")
    public List<String> partners() {
        return service.partnerNames();
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
