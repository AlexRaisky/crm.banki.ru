package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.dto.EventFormDtos.EventCreated;
import ru.banki.crm.dto.EventFormDtos.OfflineEventForm;
import ru.banki.crm.dto.EventFormDtos.OnlineEventForm;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.flow.EventFormService;

import java.util.Map;

/**
 * Завод событий формой — разделы «Онлайн-событие» и «Событие по расписанию».
 * <p>
 * Права на своей секции у каждого раздела: смотрит форму тот, кому выдан read,
 * заводит событие — тот, кому выдан add. Справочники отдаём при read любого из двух
 * разделов: списки в них общие, и держать две одинаковые ручки незачем.
 */
@RestController
@RequestMapping("/api/events")
public class EventController {

    private final EventFormService service;
    private final AccessGuard access;

    public EventController(EventFormService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    @GetMapping("/dictionaries")
    public Map<String, Object> dictionaries() {
        access.requireAnySection(Sections.EV_ONLINE, Sections.EV_OFFLINE);
        return service.dictionaries();
    }

    @PostMapping("/online")
    public EventCreated createOnline(@Valid @RequestBody OnlineEventForm form) {
        access.requireCapability(Capability.ADD, Sections.EV_ONLINE);
        return service.createOnline(form);
    }

    @PostMapping("/offline")
    public EventCreated createOffline(@Valid @RequestBody OfflineEventForm form) {
        access.requireCapability(Capability.ADD, Sections.EV_OFFLINE);
        return service.createOffline(form);
    }
}
