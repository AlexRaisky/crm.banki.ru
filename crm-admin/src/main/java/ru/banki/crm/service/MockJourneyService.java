package ru.banki.crm.service;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.dto.JourneyDtos.JourneyEdge;
import ru.banki.crm.dto.JourneyDtos.JourneyListItem;
import ru.banki.crm.dto.JourneyDtos.JourneyNode;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Мок-хранилище цепочек: in-memory, живёт до рестарта приложения.
 * По умолчанию НЕ активно — работает {@link DbJourneyService} (app.journeys);
 * включается флагом app.journeys.mock=true (для разработки без БД).
 */
@Service
@ConditionalOnProperty(name = "app.journeys.mock", havingValue = "true")
public class MockJourneyService implements JourneyService {

    private final Map<String, JourneyDto> store = new ConcurrentHashMap<>();

    @PostConstruct
    void seed() {
        java.util.Map<String, String> none = java.util.Map.of();
        JourneyDto welcome = new JourneyDto(
                "demo-welcome",
                "Welcome-цепочка (демо)",
                "online",
                null,
                List.of(
                        new JourneyNode("n0", "startIncome", 0, null, null, "Событие: подписка",
                                "Входящее событие из систем", true, 40, 20,
                                java.util.Map.of("event_name", "user_subscribed", "system", "SITE",
                                        "notify_channel", "sms", "definition_key", "subscription",
                                        "business_key_prefix", "sub")),
                        new JourneyNode("n1", "comm", 0, "sms", "3", "welcome",
                                "Приветственное SMS сразу после подписки", true, 40, 160, none),
                        new JourneyNode("n2", "decision", 0, null, null, "Кликнул по ссылке?",
                                "Ветвление по клику за 24 часа", true, 330, 160,
                                java.util.Map.of("condition", "click within 24h")),
                        new JourneyNode("n3", "comm", 1, "email", "12", "welcome",
                                "Письмо с подборкой (letteros)", true, 640, 40, none),
                        new JourneyNode("n4", "pause", 0, null, null, "Подождать",
                                "Пауза перед напоминанием", true, 640, 300,
                                java.util.Map.of("duration", "2")),
                        new JourneyNode("n5", "comm", 3, "sms", "4", "reminder",
                                "Напоминание, если клика не было", true, 930, 300, none),
                        new JourneyNode("n6", "subflow", 0, null, null, "Прогрев",
                                "Продолжение — вложенная цепочка", true, 930, 40,
                                java.util.Map.of("journey", "demo-welcome"))
                ),
                List.of(
                        new JourneyEdge("n0", "n1", "output_1"),
                        new JourneyEdge("n1", "n2", "output_1"),
                        new JourneyEdge("n2", "n3", "output_1"),   // Да
                        new JourneyEdge("n2", "n4", "output_2"),   // Нет
                        new JourneyEdge("n4", "n5", "output_1"),
                        new JourneyEdge("n3", "n6", "output_1")
                )
        );
        store.put(welcome.id(), welcome);
    }

    @Override
    public List<JourneyListItem> list() {
        return store.values().stream()
                .map(j -> new JourneyListItem(j.id(), j.name(), j.nodes().size(), j.kind()))
                .sorted(Comparator.comparing(JourneyListItem::name))
                .toList();
    }

    @Override
    public JourneyDto get(String id) {
        JourneyDto j = store.get(id);
        if (j == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Цепочка не найдена: " + id);
        }
        return j;
    }

    @Override
    public JourneyDto create(JourneyDto dto) {
        String id = UUID.randomUUID().toString().substring(0, 8);
        JourneyDto created = withId(dto, id);
        store.put(id, created);
        return created;
    }

    @Override
    public JourneyDto update(String id, JourneyDto dto) {
        get(id); // 404, если нет
        JourneyDto updated = withId(dto, id);
        store.put(id, updated);
        return updated;
    }

    @Override
    public void delete(String id) {
        get(id);
        store.remove(id);
    }

    private static JourneyDto withId(JourneyDto dto, String id) {
        String kind = "offline".equals(dto.kind()) ? "offline" : "online";
        return new JourneyDto(id, dto.name(), kind,
                "offline".equals(kind) ? dto.continuesJourneyId() : null,
                dto.nodes(), dto.edges());
    }
}
