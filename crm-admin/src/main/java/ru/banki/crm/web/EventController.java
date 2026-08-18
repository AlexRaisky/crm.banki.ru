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
import ru.banki.crm.service.flow.EventListService;
import ru.banki.crm.service.prod.EventExportService;
import ru.banki.crm.service.prod.EventImportService;

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
    private final EventImportService importer;
    private final EventListService catalog;
    private final AccessGuard access;

    public EventController(EventFormService service, EventExportService export,
                           EventImportService importer, EventListService catalog,
                           AccessGuard access) {
        this.service = service;
        this.export = export;
        this.importer = importer;
        this.catalog = catalog;
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

    /**
     * Каталог событий: страница строк плюс общее число под фильтр. Фильтрация и подсчёт
     * на сервере — событий после импорта из crmdb тысячи, и отдавать их целиком ради
     * двадцати строк на экране незачем.
     */
    @GetMapping("/list")
    public Map<String, Object> list(@RequestParam(required = false) String q,
                                    @RequestParam(required = false) String kind,
                                    @RequestParam(required = false) String channel,
                                    @RequestParam(required = false) Boolean active,
                                    @RequestParam(required = false) Boolean exported,
                                    @RequestParam(defaultValue = "50") int limit,
                                    @RequestParam(defaultValue = "0") int offset) {
        access.requireAnySection(Sections.EV_LIST);
        return catalog.list(new EventListService.Filter(q, kind, channel, active, exported), limit, offset);
    }

    /** Значения фильтров — только те, что реально встречаются в заведённых событиях. */
    @GetMapping("/list/facets")
    public Map<String, Object> listFacets() {
        access.requireAnySection(Sections.EV_LIST);
        return catalog.facets();
    }

    /** Карточка события: обвязка целиком, включая шаги выборки и связи с crmdb. */
    @GetMapping("/list/{id}")
    public Map<String, Object> one(@PathVariable long id) {
        access.requireAnySection(Sections.EV_LIST);
        return catalog.one(id);
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
        access.requireAnySection(Sections.SET_EVENTS, Sections.EV_EXPORT);
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

    /** Разведка: сколько событий в crmdb и сколько из них уже у нас. Только чтение. */
    @GetMapping("/import/scan")
    public Map<String, Object> importScan() {
        // раздел живёт в настройках (set-events), но раньше был страницей панели —
        // старую секцию оставляем действующей, чтобы никого не выбросить правкой
        access.requireAnySection(Sections.SET_EVENTS, Sections.EV_EXPORT);
        return importer.scan();
    }

    /**
     * Затянуть события из crmdb к себе. limit — потолок строк на таблицу за прогон:
     * импорт идёт одной транзакцией, и тянуть разом всю большую таблицу незачем.
     * Прогон повторяют, пока в ответе more не станет false.
     */
    @PostMapping("/import")
    public Map<String, Object> importFromProd(@RequestParam(defaultValue = "500") int limit) {
        access.requireCapability(Capability.ADD, Sections.SET_EVENTS, Sections.EV_EXPORT);
        return importer.importAll(Math.max(1, Math.min(5000, limit)));
    }
}
