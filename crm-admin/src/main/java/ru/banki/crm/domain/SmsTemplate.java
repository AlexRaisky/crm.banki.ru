package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "d_com_sms_template", schema = "notice")
public class SmsTemplate extends TemplateBase {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "sms_seq")
    @SequenceGenerator(name = "sms_seq", sequenceName = "notice.d_com_sms_template_id_seq", allocationSize = 1)
    private Integer id;

    /** Business code (MAX(code)+1 on insert, kept < 10000 per v2 rule). */
    @Column(name = "code")
    private Integer code;

    @Column(name = "brief")
    private String brief;

    @Column(name = "name")
    private String name;

    @Column(name = "msg_text")
    private String msgText;

    @Column(name = "source")
    private String source;

    @Column(name = "ab_group")
    private String abGroup;

    @Column(name = "sender_name")
    private String senderName;

    @Column(name = "night_send")
    private Boolean nightSend = false;

    @Column(name = "antispam_check")
    private Boolean antispamCheck = false;

    @Override
    public String channel() {
        return "sms";
    }

    @Override
    public String businessCode() {
        return code == null ? null : String.valueOf(code);
    }
}
