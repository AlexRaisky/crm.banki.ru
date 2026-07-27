package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.PromoPlanService;
import ru.banki.crm.service.Sections;

import java.util.List;
import java.util.Map;

/**
 * Планирование промо — общая таблица команды.
 * Смотреть может любой с разделом promo, править — EDITOR/ADMIN.
 */
@RestController
@RequestMapping("/api/promo/plan")
public class PromoPlanController {

    private final PromoPlanService service;
    private final AccessGuard access;

    public PromoPlanController(PromoPlanService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    /**
     * Весь план. Заодно переводим прошедшие «запланировано» в «отправлено» —
     * раньше это делал каждый клиент у себя и тут же сохранял.
     */
    @GetMapping
    public List<Map<String, Object>> list() {
        access.requireAnySection(Sections.PROMO);
        service.archiveSync();
        return service.list();
    }

    /** Завести промо. Каналов может быть несколько — вернётся столько же строк. */
    @PostMapping
    public List<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.ADD, Sections.PROMO);
        return service.create(body);
    }

    /**
     * Правка одного поля: {field, value, ver}.
     * ver — timestamp_upd, который видел клиент; разошёлся — 409.
     */
    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.PROMO);
        return service.updateField(id, body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        access.requireCapability(Capability.DELETE, Sections.PROMO);
        service.delete(id);
    }
}
