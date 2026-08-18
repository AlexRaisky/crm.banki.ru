package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.dto.JourneyDtos.JourneyListItem;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.JourneyService;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.service.Sections;

import java.util.List;

/** Цепочки-схемы (journey builder). Раздел целиком доступен только ADMIN. */
@RestController
@RequestMapping("/api/journeys")
public class JourneyController {

    private final JourneyService service;
    private final AccessGuard guard;

    public JourneyController(JourneyService service, AccessGuard guard) {
        this.service = service;
        this.guard = guard;
    }

    @GetMapping
    public List<JourneyListItem> list() {
        guard.requireAnySection(Sections.JOURNEYS);
        return service.list();
    }

    @GetMapping("/{id}")
    public JourneyDto get(@PathVariable String id) {
        guard.requireAnySection(Sections.JOURNEYS);
        return service.get(id);
    }

    @PostMapping
    public JourneyDto create(@Valid @RequestBody JourneyDto dto) {
        guard.requireCapability(Capability.ADD, Sections.JOURNEYS);
        return service.create(dto);
    }

    @PutMapping("/{id}")
    public JourneyDto update(@PathVariable String id, @Valid @RequestBody JourneyDto dto) {
        guard.requireCapability(Capability.EDIT, Sections.JOURNEYS);
        return service.update(id, dto);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable String id) {
        guard.requireCapability(Capability.DELETE, Sections.JOURNEYS);
        service.delete(id);
    }
}
