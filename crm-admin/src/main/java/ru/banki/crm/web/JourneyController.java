package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.dto.JourneyDtos.JourneyListItem;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.JourneyService;
import ru.banki.crm.service.Sections;

import java.util.List;

/** Цепочки-схемы (journey builder). Раздел целиком доступен только ADMIN. */
@RestController
@RequestMapping("/api/journeys")
@PreAuthorize("hasRole('ADMIN')")
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
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public JourneyDto create(@Valid @RequestBody JourneyDto dto) {
        guard.requireAnySection(Sections.JOURNEYS);
        return service.create(dto);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public JourneyDto update(@PathVariable String id, @Valid @RequestBody JourneyDto dto) {
        guard.requireAnySection(Sections.JOURNEYS);
        return service.update(id, dto);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('EDITOR','ADMIN')")
    public void delete(@PathVariable String id) {
        guard.requireAnySection(Sections.JOURNEYS);
        service.delete(id);
    }
}
