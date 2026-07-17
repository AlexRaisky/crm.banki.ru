package ru.banki.crm.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.Journey;
import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.dto.JourneyDtos.JourneyEdge;
import ru.banki.crm.dto.JourneyDtos.JourneyListItem;
import ru.banki.crm.dto.JourneyDtos.JourneyNode;
import ru.banki.crm.repo.JourneyRepository;
import ru.banki.crm.security.CurrentUser;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Хранение цепочек в PostgreSQL (app.journeys, jsonb). Активно по умолчанию;
 * мок включается флагом app.journeys.mock=true (см. {@link MockJourneyService}).
 */
@Service
@ConditionalOnProperty(name = "app.journeys.mock", havingValue = "false", matchIfMissing = true)
public class DbJourneyService implements JourneyService {

    /** Содержимое колонки definition: узлы + связи (без id/name — они колонками). */
    record Definition(List<JourneyNode> nodes, List<JourneyEdge> edges) {}

    private final JourneyRepository repo;
    private final ObjectMapper json;

    public DbJourneyService(JourneyRepository repo, ObjectMapper objectMapper) {
        this.repo = repo;
        this.json = objectMapper.copy().setSerializationInclusion(JsonInclude.Include.NON_NULL);
    }

    @Override
    @Transactional(readOnly = true)
    public List<JourneyListItem> list() {
        return repo.findAll().stream()
                .map(j -> new JourneyListItem(j.getId(), j.getName(), parse(j).nodes().size(), j.getKind()))
                .sorted(java.util.Comparator.comparing(JourneyListItem::name))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public JourneyDto get(String id) {
        Journey j = load(id);
        Definition d = parse(j);
        return new JourneyDto(j.getId(), j.getName(), j.getKind(), j.getContinuesJourneyId(), d.nodes(), d.edges());
    }

    @Override
    @Transactional
    public JourneyDto create(JourneyDto dto) {
        String id = UUID.randomUUID().toString().substring(0, 8);
        return save(new Journey(), id, dto);
    }

    @Override
    @Transactional
    public JourneyDto update(String id, JourneyDto dto) {
        return save(load(id), id, dto);
    }

    @Override
    @Transactional
    public void delete(String id) {
        repo.delete(load(id));
    }

    // ------------------------------------------------------------------ helpers
    private JourneyDto save(Journey j, String id, JourneyDto dto) {
        String kind = "offline".equals(dto.kind()) ? "offline" : "online";
        j.setId(id);
        j.setName(dto.name());
        j.setKind(kind);
        j.setContinuesJourneyId("offline".equals(kind) ? dto.continuesJourneyId() : null);
        j.setDefinition(write(new Definition(dto.nodes(), dto.edges())));
        j.setUpdatedBy(CurrentUser.email());
        j.setUpdatedAt(Instant.now());
        repo.save(j);
        return new JourneyDto(id, dto.name(), kind, j.getContinuesJourneyId(), dto.nodes(), dto.edges());
    }

    private Journey load(String id) {
        return repo.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Цепочка не найдена: " + id));
    }

    private Definition parse(Journey j) {
        try {
            Definition d = json.readValue(j.getDefinition(), Definition.class);
            return new Definition(
                    d.nodes() == null ? List.of() : d.nodes(),
                    d.edges() == null ? List.of() : d.edges());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Повреждён JSON цепочки " + j.getId() + ": " + e.getMessage());
        }
    }

    private String write(Definition d) {
        try {
            return json.writeValueAsString(d);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Не удалось сериализовать схему: " + e.getMessage());
        }
    }
}
