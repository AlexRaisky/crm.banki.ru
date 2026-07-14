package ru.banki.crm.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "push_template", schema = "notice")
public class PushTemplate extends TemplateBase {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "push_seq")
    @SequenceGenerator(name = "push_seq", sequenceName = "notice.push_template_id_seq", allocationSize = 1)
    private Long id;

    /** Business code (MAX(code)+1 on insert). */
    @Column(name = "code")
    private Integer code;

    @Column(name = "brief")
    private String brief;

    @Column(name = "name")
    private String name;

    @Column(name = "title")
    private String title;

    @Column(name = "msg_text")
    private String msgText;

    @Column(name = "deep_link")
    private String deepLink;

    @Column(name = "source")
    private String source;

    @Column(name = "ab_group")
    private String abGroup;

    @Column(name = "webview_url")
    private String webviewUrl;

    @Column(name = "night_send")
    private Boolean nightSend = false;

    @Override
    public String channel() {
        return "push";
    }

    @Override
    public String businessCode() {
        return code == null ? null : String.valueOf(code);
    }
}
