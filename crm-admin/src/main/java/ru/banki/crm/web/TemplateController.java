package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
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
    public List<TemplateListItemDto> list(@RequestParam(required = false) List<String> channel,
                                          @RequestParam(required = false) List<String> product,
                                          @RequestParam(required = false) List<String> touch,
                                          @RequestParam(required = false) List<String> trigger,
                                          @RequestParam(required = false) List<String> partner,
                                          @RequestParam(required = false) String active,
                                          @RequestParam(required = false) String q,
                                          @RequestParam(required = false) String sort,
                                          @RequestParam(required = false) String dir,
                                          @RequestParam(required = false) Integer limit,
                                          @RequestParam(required = false) Integer offset) {
        /* VIEWER — «Просмотр настроек»: тот же экран мастера, но в режиме чтения. Секция
           у него теперь своя (её выдают, не открывая сам мастер), поэтому читать шаблоны
           ему можно — а ручки записи ниже требуют ADMIN или TEMPLATES, как и раньше. */
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN, Sections.VIEWER);
        return service.list(channel, product, touch, trigger, partner, active, q, sort, dir, limit, offset);
    }

    /** Значения для выпадающих фильтров (продукт/точка/триггер) из реальных данных. */
    @GetMapping("/facets")
    public Map<String, List<String>> facets() {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN, Sections.VIEWER);
        return service.facets();
    }

    /** Итоги под теми же фильтрами: {total, active} — для строки статистики без выгрузки всех строк. */
    @GetMapping("/count")
    public Map<String, Long> count(@RequestParam(required = false) List<String> channel,
                                   @RequestParam(required = false) List<String> product,
                                   @RequestParam(required = false) List<String> touch,
                                   @RequestParam(required = false) List<String> trigger,
                                   @RequestParam(required = false) List<String> partner,
                                   @RequestParam(required = false) String active,
                                   @RequestParam(required = false) String q) {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN, Sections.VIEWER);
        return service.count(channel, product, touch, trigger, partner, active, q);
    }

    @GetMapping("/{channel}/{code}")
    public TemplateDto get(@PathVariable String channel, @PathVariable String code) {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN, Sections.VIEWER);
        return service.get(channel, code);
    }

    /**
     * @param force создавать, даже если шаблон с таким source уже есть — осознанный повтор
     *              (А/Б-пара, ещё один день цепочки). Совпадение letteros_id так не
     *              обходится: это то же самое письмо.
     */
    @PostMapping("/{channel}")
    public Map<String, String> create(@PathVariable String channel, @Valid @RequestBody TemplateDto dto,
                                      @RequestParam(defaultValue = "false") boolean force) {
        access.requireCapability(Capability.ADD, Sections.ADMIN, Sections.TEMPLATES);
        dto.setChannel(channel);
        return Map.of("code", service.create(dto, force));
    }

    /** Занят ли уже этот source (и letteros_id у писем) — чтобы спросить до создания. */
    @GetMapping("/{channel}/duplicates")
    public Map<String, String> duplicates(@PathVariable String channel,
                                          @RequestParam(required = false) String source,
                                          @RequestParam(required = false) String letterosId) {
        access.requireAnySection(Sections.TEMPLATES, Sections.ADMIN, Sections.VIEWER);
        return service.duplicates(channel, source, letterosId);
    }

    @PostMapping("/{channel}/chain")
    public Map<String, List<String>> createChain(@PathVariable String channel, @RequestBody ChainRequest req) {
        access.requireCapability(Capability.ADD, Sections.ADMIN, Sections.TEMPLATES);
        if (req.getBase() != null) {
            req.getBase().setChannel(channel);
        }
        return Map.of("codes", service.createChain(req));
    }

    @PutMapping("/{channel}/{code}")
    public void update(@PathVariable String channel, @PathVariable String code,
                       @RequestBody TemplateDto dto) {
        access.requireCapability(Capability.EDIT, Sections.ADMIN, Sections.TEMPLATES);
        service.update(channel, code, dto);
    }

    @DeleteMapping("/{channel}/{code}")
    public void delete(@PathVariable String channel, @PathVariable String code) {
        access.requireCapability(Capability.DELETE, Sections.ADMIN, Sections.TEMPLATES);
        service.delete(channel, code);
    }
}
