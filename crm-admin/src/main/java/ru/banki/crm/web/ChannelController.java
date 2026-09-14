package ru.banki.crm.web;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.ChannelService;
import ru.banki.crm.service.PostmasterService;
import ru.banki.crm.service.Sections;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Каналы: тарификация и состояние канала.
 *
 * <p>Права по секции {@link Sections#CHANNELS}: смотреть — по секции, править
 * тарификацию — по глаголу. Настройки доступов к постмастерам живут отдельно, за
 * секцией интеграций: там лежат токены, и открывать их тому, кому выдали только
 * просмотр цен, незачем.
 */
@RestController
@RequestMapping("/api/channels")
public class ChannelController {

    private final ChannelService service;
    private final PostmasterService postmaster;
    private final AccessGuard access;

    public ChannelController(ChannelService service, PostmasterService postmaster, AccessGuard access) {
        this.service = service;
        this.postmaster = postmaster;
        this.access = access;
    }

    @GetMapping
    public List<Map<String, Object>> channels() {
        access.requireAnySection(Sections.CHANNELS);
        return service.channels();
    }

    /** Канал бесплатный: тарификация отключается, введённые строки остаются. */
    @PutMapping("/{channelId}/free")
    public Map<String, Object> setFree(@PathVariable String channelId, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.CHANNELS);
        return service.setFree(channelId, Boolean.TRUE.equals(body.get("free")));
    }

    /* ---------------------------------------------------------- тарификация */

    @GetMapping("/{channelId}/costs")
    public List<Map<String, Object>> costs(@PathVariable String channelId) {
        access.requireAnySection(Sections.CHANNELS);
        return service.costs(channelId);
    }

    @PostMapping("/{channelId}/costs")
    public Map<String, Object> saveCost(@PathVariable String channelId, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.CHANNELS);
        return service.saveCost(channelId, body);
    }

    @DeleteMapping("/{channelId}/costs/{id}")
    public void deleteCost(@PathVariable String channelId, @PathVariable long id) {
        access.requireCapability(Capability.DELETE, Sections.CHANNELS);
        service.deleteCost(channelId, id);
    }

    @GetMapping("/{channelId}/volumes")
    public List<Map<String, Object>> volumes(@PathVariable String channelId) {
        access.requireAnySection(Sections.CHANNELS);
        return service.volumes(channelId);
    }

    @PostMapping("/{channelId}/volumes")
    public Map<String, Object> saveVolume(@PathVariable String channelId, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.CHANNELS);
        return service.saveVolume(channelId, body);
    }

    @DeleteMapping("/{channelId}/volumes/{id}")
    public void deleteVolume(@PathVariable String channelId, @PathVariable long id) {
        access.requireCapability(Capability.DELETE, Sections.CHANNELS);
        service.deleteVolume(channelId, id);
    }

    /** Помесячный ряд и цена «сейчас» — для блока расчёта и обоих графиков. */
    @GetMapping("/{channelId}/pricing")
    public Map<String, Object> pricing(
            @PathVariable String channelId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        access.requireAnySection(Sections.CHANNELS);
        return service.pricing(channelId, from, to);
    }

    /* ---------------------------------------------------------- постмастеры */

    /** Сохранённые метрики. Обновление — отдельной ручкой, чтобы открытие раздела не ходило наружу. */
    @GetMapping("/email/postmaster")
    public Map<String, Object> postmasterStats(
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String domain,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        access.requireAnySection(Sections.CHANNELS);
        return Map.of("stats", postmaster.stats(source, domain, from, to),
                      "domains", postmaster.domains(),
                      "settings", postmaster.settings());
    }

    /**
     * Обновление за период, который выбран на экране. Раньше глубина была зашита
     * (30 дней у кнопки в разделе, трое суток у проверки связи), и человек не мог
     * дотянуть историю: сколько ни жми, приезжало одно и то же окно.
     */
    @PostMapping("/email/postmaster/refresh")
    public Map<String, Object> postmasterRefresh(@RequestBody(required = false) Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.CHANNELS);
        /* «Вся история» — на глубину из настройки: сколько хранят постмастеры,
           заранее неизвестно, и выбирать её датами на глаз неудобно. */
        if (body != null && Boolean.TRUE.equals(body.get("full"))) {
            return postmaster.refreshHistory();
        }
        LocalDate from = date(body, "from"), to = date(body, "to");
        if (from != null || to != null) {
            return postmaster.refresh(from, to);
        }
        Object days = body == null ? null : body.get("days");
        Integer n = null;
        if (days != null) {
            try { n = Integer.valueOf(String.valueOf(days).trim()); } catch (NumberFormatException ignored) { }
        }
        return postmaster.refresh(n);
    }

    private static LocalDate date(Map<String, Object> body, String key) {
        Object v = body == null ? null : body.get(key);
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.length() < 10) return null;
        try { return LocalDate.parse(s.substring(0, 10)); } catch (RuntimeException e) { return null; }
    }
}
