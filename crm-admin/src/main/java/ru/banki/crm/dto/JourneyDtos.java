package ru.banki.crm.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

/**
 * Цепочка коммуникаций как блок-схема: узлы (события по дням) + связи между ними.
 * Пока живёт в мок-хранилище ({@code MockJourneyService}); при переходе на БД
 * DTO не меняется — подменяется только реализация {@code JourneyService}.
 */
public final class JourneyDtos {

    private JourneyDtos() {}

    /** Узел схемы. Тип определяет набор полей (по образцу Salesforce Flow Builder). */
    public record JourneyNode(
            @NotBlank String id,        // клиентский id узла (стабильный внутри цепочки)
            String type,                // comm | assignment | decision | pause | loop |
                                        // createRecords | updateRecords | getRecords | deleteRecords | subflow
                                        // null (старые данные) = comm
            int day,                    // день отправки (для comm)
            String channel,             // sms | push | email | cc (для comm)
            String templateCode,        // код существующего шаблона (для comm)
            String title,               // короткое название
            String note,                // комментарий: что происходит
            boolean active,
            double posX,                // позиция на канве (Drawflow)
            double posY,
            Map<String, String> props   // поля, специфичные для типа (условие, переменная, объект и т.п.)
    ) {}

    /** Ребро: from → to; fromPort = какой выход узла (output_1/output_2 у Decision/Loop). */
    public record JourneyEdge(@NotBlank String from, @NotBlank String to, String fromPort) {}

    /** Вся схема. */
    public record JourneyDto(
            String id,                  // null при создании
            @NotBlank String name,
            String kind,                // online | offline (null у старых данных = online)
            String continuesJourneyId,  // offline: метка «продолжение какой online-цепочки» (информационная)
            @NotNull @Valid List<JourneyNode> nodes,
            @NotNull @Valid List<JourneyEdge> edges
    ) {}

    /** Строка списка цепочек. */
    public record JourneyListItem(String id, String name, int nodeCount, String kind) {}
}
