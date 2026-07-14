package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Getter
@Setter
@Entity
@Table(name = "d_segment_properties", schema = "callcenter")
public class CcSegment extends TemplateBase {

    /** Surrogate PK (auto). Not shown to users. */
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "cc_seq")
    @SequenceGenerator(name = "cc_seq", sequenceName = "callcenter.d_segment_properties_id_seq", allocationSize = 1)
    private Long id;

    /** Business segment number the user supplies; the app looks CC templates up by it. */
    @Column(name = "segment", nullable = false)
    private Integer segment;

    @Column(name = "source_system")
    private String sourceSystem = "";

    @Column(name = "segment_descr")
    private String segmentDescr;

    @Column(name = "host_id")
    private Long hostId;

    @Column(name = "ml_check_probability")
    private Boolean mlCheckProbability;

    @Column(name = "ml_probability_required")
    private BigDecimal mlProbabilityRequired;

    @Column(name = "cutpercent")
    private Integer cutpercent;

    @Column(name = "nocutpercent")
    private Integer nocutpercent;

    @Column(name = "ab_group")
    private String abGroup;

    @Column(name = "placement")
    private String placement;

    @Column(name = "kvint_campaign_id")
    private String kvintCampaignId;

    @Override
    public String channel() {
        return "cc";
    }

    @Override
    public String businessCode() {
        return segment == null ? null : String.valueOf(segment);
    }
}
