package ru.banki.crm.dto;

import lombok.Data;

import java.util.List;

/**
 * "Цепочка": create N templates that share one base but differ by sending day.
 * Replaces v2's client-side loop of individual INSERTs with a single batch/transaction.
 */
@Data
public class ChainRequest {
    private TemplateDto base;
    private List<String> days;
}
