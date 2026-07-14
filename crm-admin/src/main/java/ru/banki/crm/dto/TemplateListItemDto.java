package ru.banki.crm.dto;

import java.util.List;

/** One row of the unified "Список шаблонов" (mirrors v2's FetchAllTemplates UNION). */
public record TemplateListItemDto(
        String channel,
        String code,
        String communicationName,
        List<String> productType,
        String touchPoint,
        String triggerType,
        String partnerName,
        Boolean active,
        String letterosId
) {}
