package ru.banki.crm.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Цепочка-схема (journey builder). Вся схема (узлы + связи + позиции)
 * лежит одним jsonb-документом в {@code definition} — читается/пишется атомарно.
 */
@Entity
@Table(name = "journeys", schema = "app")
@Getter
@Setter
@NoArgsConstructor
public class Journey {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false)
    private String name;

    /** online | offline */
    @Column(length = 10, nullable = false)
    private String kind = "online";

    /** offline: информационная метка — продолжение какой online-цепочки. */
    @Column(name = "continues_journey_id", length = 36)
    private String continuesJourneyId;

    /** JSON: {nodes:[...], edges:[...]} — формат JourneyDtos. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private String definition;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();
}
