package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.dto.ChainRequest;
import ru.banki.crm.dto.TemplateDto;
import ru.banki.crm.dto.TemplateListItemDto;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.TemplateService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/templates")
public class TemplateController {

    private final TemplateService service;
    private final AccessGuard access;

    public TemplateController(TemplateService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    /** Unified list for "Список шаблонов" (v2 FetchAllTemplates).
     *  q — свободный поиск, limit — сколько строк вернуть (пагинация: грузим первые N, не весь справочник). */
    @GetMapping
    public List<TemplateListItemDto> list(@RequestParam(required = false) String channel,
                                          @RequestParam(required = false) String product,
                                          @RequestParam(required = false) String touch,
                                          @RequestParam(required = false) String trigger,
                                          @RequestParam(required = false) String active,
                                          @RequestParam(required = false) String q,
                                          @RequestParam(required = false) Integer limit) {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN);
        return service.list(channel, product, touch, trigger, active, q, limit);
    }

    /** Итоги под теми же фильтрами: {total, active} — для строки статистики без выгрузки всех строк. */
    @GetMapping("/count")
    public Map<String, Long> count(@RequestParam(required = false) String channel,
                                   @RequestParam(required = false) String product,
                                   @RequestParam(required = false) String touch,
                                   @RequestParam(required = false) String trigger,
                                   @RequestParam(required = false) String active,
                                   @RequestParam(required = false) String q) {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN);
        return service.count(channel, product, touch, trigger, active, q);
    }

    @GetMapping("/{channel}/{code}")
    public TemplateDto get(@PathVariable String channel, @PathVariable String code) {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN);
        return service.get(channel, code);
    }

    @PostMapping("/{channel}")
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public Map<String, String> create(@PathVariable String channel, @Valid @RequestBody TemplateDto dto) {
        access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES);
        dto.setChannel(channel);
        return Map.of("code", service.create(dto));
    }

    @PostMapping("/{channel}/chain")
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public Map<String, List<String>> createChain(@PathVariable String channel, @RequestBody ChainRequest req) {
        access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES);
        if (req.getBase() != null) {
            req.getBase().setChannel(channel);
        }
        return Map.of("codes", service.createChain(req));
    }

    @PutMapping("/{channel}/{code}")
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public void update(@PathVariable String channel, @PathVariable String code,
                       @RequestBody TemplateDto dto) {
        access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES);
        service.update(channel, code, dto);
    }

    @DeleteMapping("/{channel}/{code}")
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public void delete(@PathVariable String channel, @PathVariable String code) {
        access.requireAnySection(Sections.ADMIN, Sections.TEMPLATES);
        service.delete(channel, code);
    }
}
