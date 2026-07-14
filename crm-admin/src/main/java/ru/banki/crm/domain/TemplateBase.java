package ru.banki.crm.domain;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.ArrayList;
import java.util.List;

/**
 * Columns shared by all four channel tables. Defaults are set so inserts satisfy the
 * production NOT NULL constraints even when the (reduced) v1 form omits a field.
 * NB: "source" is NOT here — the callcenter table has no such column; it lives on
 * PushTemplate / EmailTemplate / SmsTemplate only.
 */
@Getter
@Setter
@MappedSuperclass
public abstract class TemplateBase {

    @Column(name = "source_type")
    private String sourceType = "";

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "product_type", columnDefinition = "text[]")
    private List<String> productType = new ArrayList<>();

    @Column(name = "communication_type")
    private String communicationType = "";

    @Column(name = "trigger_type")
    private String triggerType = "";

    /** smallint in the notice tables, integer in callcenter — Integer maps to both. */
    @Column(name = "sending_day")
    private Integer sendingDay = 0;

    @Column(name = "partner_name")
    private String partnerName;

    @Column(name = "aff_sub3")
    private String affSub3 = "";

    @Column(name = "active_flag")
    private Boolean activeFlag = true;

    @Column(name = "communication_name")
    private String communicationName = "";

    @Column(name = "touch_point")
    private String touchPoint = "";

    @Column(name = "business_communication_type")
    private String businessCommunicationType = "";

    /** varchar(16) in prod (a service tag), NOT a boolean. */
    @Column(name = "selection_wizard_service")
    private String selectionWizardService;

    @Column(name = "national_rating")
    private Boolean nationalRating = false;

    @Column(name = "marketplace")
    private Boolean marketplace = false;

    @Column(name = "mobile_app")
    private Boolean mobileApp = false;

    @Column(name = "loyalty")
    private Boolean loyalty = false;

    @Column(name = "dialog")
    private Boolean dialog = false;

    @Column(name = "news")
    private Boolean news = false;

    /** Channel discriminator used by the unified list ("push"/"email"/"sms"/"cc"). */
    public abstract String channel();

    /** Business identifier shown to users (code / id / segment), as a string. */
    public abstract String businessCode();
}
