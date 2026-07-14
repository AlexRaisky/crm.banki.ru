package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "email_template", schema = "notice")
public class EmailTemplate extends TemplateBase {

    /** For email the primary key (id) IS the business code shown in the list. */
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "email_seq")
    @SequenceGenerator(name = "email_seq", sequenceName = "notice.email_template_id_seq", allocationSize = 1)
    private Long id;

    @Column(name = "trigger_code")
    private Integer triggerCode;

    @Column(name = "letteros_id")
    private Long letterosId;

    @Column(name = "subject")
    private String subject = "";

    @Column(name = "email_from")
    private String emailFrom = "";

    @Column(name = "source")
    private String source;

    @Column(name = "ab_group")
    private String abGroup;

    // Named without the "is" prefix to avoid Lombok's boolean-accessor special-casing.
    @Column(name = "is_service")
    private Boolean service = false;

    @Column(name = "is_info")
    private Boolean info = false;

    @Column(name = "msg_text")
    private String msgText;

    @Column(name = "preheader")
    private String preheader;

    @Column(name = "utm_custom")
    private String utmCustom;

    @Column(name = "mail_text")
    private String mailText;

    @Override
    public String channel() {
        return "email";
    }

    @Override
    public String businessCode() {
        return id == null ? null : String.valueOf(id);
    }
}
