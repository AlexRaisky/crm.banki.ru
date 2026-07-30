package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.AbTestService;
import ru.banki.crm.service.Sections;

import java.util.List;
import java.util.Map;

/**
 * А/Б тесты — общая таблица команды.
 * Права ровно как у планирования промо, только своей секции: смотрит любой с разделом
 * abtests, правит тот, кому в матрице выдали add/edit/delete.
 */
@RestController
@RequestMapping("/api/ab-tests")
public class AbTestController {

    private final AbTestService service;
    private final AccessGuard access;

    public AbTestController(AbTestService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        access.requireAnySection(Sections.ABTESTS);
        return service.list();
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.ADD, Sections.ABTESTS);
        return service.create(body);
    }

    /**
     * Правка одного поля: {field, value, ver}.
     * ver — timestamp_upd, который видел клиент; разошёлся — 409.
     */
    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.ABTESTS);
        return service.updateField(id, body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        access.requireCapability(Capability.DELETE, Sections.ABTESTS);
        service.delete(id);
    }
}
