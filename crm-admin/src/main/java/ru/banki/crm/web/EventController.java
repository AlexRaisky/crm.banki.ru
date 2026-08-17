package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.dto.EventFormDtos.EventCreated;
import ru.banki.crm.dto.EventFormDtos.OfflineEventForm;
import ru.banki.crm.dto.EventFormDtos.OnlineEventForm;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.flow.EventFormService;
import ru.banki.crm.service.prod.EventExportService;

import java.util.List;
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
    private final EventExportService export;
    private final AccessGuard access;

    public EventController(EventFormService service, EventExportService export, AccessGuard access) {
        this.service = service;
        this.export = export;
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

    /** Список событий с состоянием перелива (сколько строк слоя B уже в проде). */
    @GetMapping("/export")
    public List<Map<String, Object>> exportList(@RequestParam(defaultValue = "100") int limit) {
        access.requireAnySection(Sections.EV_EXPORT);
        return export.list(Math.max(1, Math.min(500, limit)));
    }

    /**
     * Сверка DDL с продом до перелива: колонка, которой в проде нет, при вставке молча
     * отбрасывается, и знать об этом лучше заранее.
     */
    @GetMapping("/export/health")
    public Map<String, Object> exportHealth() {
        access.requireAnySection(Sections.EV_EXPORT);
        return export.health();
    }

    /**
     * Перелить событие в прод-БД. Право ADD именно на разделе перелива: заводить
     * события у себя и отправлять их в прод — разные полномочия.
     */
    @PostMapping("/export/{eventId}")
    public Map<String, Object> exportEvent(@PathVariable long eventId) {
        access.requireCapability(Capability.ADD, Sections.EV_EXPORT);
        return export.export(eventId);
    }
}
