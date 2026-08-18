package ru.banki.crm.web;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.JourneyService;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.flow.MaterializationService;
import ru.banki.crm.service.flow.MaterializationService.CreatedRow;
import ru.banki.crm.service.flow.MaterializationService.PlannedRow;
import ru.banki.crm.service.flow.MaterializationService.PreviewResult;

import java.util.List;

/**
 * Материализация цепочек: предпросмотр инсертов слоя B и их выполнение.
 * Поток: кнопка «Предпросмотр» → POST /preview → модалка (значения редактируемы)
 * → кнопка «Сохранить» в модалке → POST /materialize (сохраняет цепочку + слой A + слой B).
 */
@RestController
@RequestMapping("/api/flow")
public class FlowController {

    public record MaterializeRequest(@Valid JourneyDto journey, List<PlannedRow> rows) {}
    public record MaterializeResponse(String journeyId, List<CreatedRow> created) {}

    private final MaterializationService materialization;
    private final JourneyService journeys;
    private final AccessGuard guard;

    public FlowController(MaterializationService materialization, JourneyService journeys, AccessGuard guard) {
        this.materialization = materialization;
        this.journeys = journeys;
        this.guard = guard;
    }

    @PostMapping("/preview")
    public PreviewResult preview(@Valid @RequestBody JourneyDto journey) {
        guard.requireAnySection(Sections.JOURNEYS);
        return materialization.preview(journey);
    }

    /* Материализация пишет строки в боевые процессные таблицы, поэтому не просто
       видимость раздела, а право на добавление в нём. Предпросмотр ниже — только чтение. */
    @PostMapping("/materialize")
    public MaterializeResponse materialize(@Valid @RequestBody MaterializeRequest req) {
        guard.requireCapability(ru.banki.crm.domain.Capability.ADD, Sections.JOURNEYS);
        // Сначала сохраняем саму цепочку (create/update), чтобы у материализации был стабильный journey_id.
        JourneyDto saved = (req.journey().id() == null || req.journey().id().isBlank())
                ? journeys.create(req.journey())
                : journeys.update(req.journey().id(), req.journey());
        List<CreatedRow> created = materialization.materialize(saved, req.rows() == null ? List.of() : req.rows());
        return new MaterializeResponse(saved.id(), created);
    }
}
