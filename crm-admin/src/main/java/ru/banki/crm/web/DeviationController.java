package ru.banki.crm.web;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.DeviationService;
import ru.banki.crm.service.Sections;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Панель отклонений: факт выручки, снимки расчёта и разбор гипотез.
 *
 * <p>Права те же, что у самого раздела ({@link Sections#DEVIATIONS}): смотреть —
 * по секции, писать — по глаголу. Комментарий к гипотезе это правка (EDIT), а
 * загрузка выручки — добавление данных (ADD): читателю, которому раздел просто
 * показывают, менять цифры нельзя.
 */
@RestController
@RequestMapping("/api/deviations")
public class DeviationController {

    private final DeviationService service;
    private final AccessGuard access;

    public DeviationController(DeviationService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    /* Факт: раздел забирает его при открытии и считает по нему всё остальное. */
    @GetMapping("/revenue")
    public List<Map<String, Object>> revenue(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        access.requireAnySection(Sections.DEVIATIONS);
        return service.revenue(from, to);
    }

    @PostMapping("/revenue")
    public Map<String, Object> saveRevenue(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.ADD, Sections.DEVIATIONS);
        return service.saveRevenue(body);
    }

    /** Откуда приезжали цифры: загрузки из раздела и (позже) синхронизации. */
    @GetMapping("/loads")
    public List<Map<String, Object>> loads(@RequestParam(defaultValue = "20") int limit) {
        access.requireAnySection(Sections.DEVIATIONS);
        return service.loads(limit);
    }

    /* Пороги — общие для всех: раздел показывает их в методологии под таблицами. */
    @GetMapping("/thresholds")
    public Map<String, Object> thresholds() {
        access.requireAnySection(Sections.DEVIATIONS);
        return service.thresholds();
    }

    @PutMapping("/thresholds")
    public Map<String, Object> saveThresholds(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.DEVIATIONS);
        return service.saveThresholds(body);
    }

    /* Снимки расчёта — то, ради чего «доказать, что отклонение было». */
    @GetMapping("/runs")
    public List<Map<String, Object>> runs(@RequestParam(defaultValue = "20") int limit) {
        access.requireAnySection(Sections.DEVIATIONS);
        return service.runs(limit);
    }

    @GetMapping("/runs/{id}")
    public Map<String, Object> run(@PathVariable long id) {
        access.requireAnySection(Sections.DEVIATIONS);
        return service.run(id);
    }

    @PostMapping("/runs")
    public Map<String, Object> saveRun(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.ADD, Sections.DEVIATIONS);
        return service.saveRun(body);
    }

    /* Комментарии и статусы гипотез — общие, а не в браузере у каждого свои. */
    @GetMapping("/notes")
    public List<Map<String, Object>> notes() {
        access.requireAnySection(Sections.DEVIATIONS);
        return service.notes();
    }

    @PutMapping("/notes")
    public Map<String, Object> saveNote(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.DEVIATIONS);
        return service.saveNote(body);
    }
}
