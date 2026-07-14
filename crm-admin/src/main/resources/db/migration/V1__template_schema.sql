-- Prod-identical schema for the communication-template tables.
-- The three notice.* tables mirror the REAL production DDL (full column set, types,
-- nullability) provided by the team. NOT NULL columns get DEFAULTs so dev seeding and
-- the reduced v1 form both insert cleanly; the app also sets these values explicitly.
-- On the real corporate DB these tables already exist (profile=prod disables Flyway).

CREATE SCHEMA IF NOT EXISTS notice;
CREATE SCHEMA IF NOT EXISTS callcenter;
CREATE SCHEMA IF NOT EXISTS retention;
CREATE SCHEMA IF NOT EXISTS arch;

-- ------------------------------------------------------------------ PUSH
CREATE SEQUENCE IF NOT EXISTS notice.push_template_id_seq;
CREATE TABLE IF NOT EXISTS notice.push_template (
    id                          bigint          PRIMARY KEY DEFAULT nextval('notice.push_template_id_seq'),
    code                        integer,
    brief                       varchar(100),
    name                        varchar(64),
    title                       varchar(60),
    msg_text                    text,
    deep_link                   varchar(255),
    product_type                text[]          NOT NULL DEFAULT '{}',
    source                      varchar(100),
    communication_type          varchar(16)     NOT NULL DEFAULT '',
    trigger_type                varchar(8)      NOT NULL DEFAULT '',
    sending_day                 smallint        NOT NULL DEFAULT 0,
    partner_name                varchar(100),
    ab_group                    varchar(8),
    aff_sub3                    varchar(255),
    webview_url                 varchar(2048),
    source_type                 varchar(128),
    active_flag                 boolean         DEFAULT true,
    communication_name          varchar         NOT NULL DEFAULT '',
    touch_point                 varchar         NOT NULL DEFAULT '',
    business_communication_type varchar(16),
    night_send                  boolean         NOT NULL DEFAULT false,
    selection_wizard_service    varchar(16),
    national_rating             boolean         NOT NULL DEFAULT false,
    marketplace                 boolean         NOT NULL DEFAULT false,
    mobile_app                  boolean         NOT NULL DEFAULT false,
    loyalty                     boolean         NOT NULL DEFAULT false,
    dialog                      boolean         NOT NULL DEFAULT false,
    news                        boolean         NOT NULL DEFAULT false,
    img_ios                     varchar(255),
    img_android                 varchar(255),
    action_buttons              jsonb,
    permanent_exclude           boolean,
    time_to_live                integer
);
ALTER SEQUENCE notice.push_template_id_seq OWNED BY notice.push_template.id;

-- ----------------------------------------------------------------- EMAIL
CREATE SEQUENCE IF NOT EXISTS notice.email_template_id_seq;
CREATE TABLE IF NOT EXISTS notice.email_template (
    id                          bigint          PRIMARY KEY DEFAULT nextval('notice.email_template_id_seq'),
    trigger_code                integer,
    msg_text                    text,
    subject                     text            NOT NULL DEFAULT '',
    email_from                  varchar(64)     NOT NULL DEFAULT '',
    letteros_id                 bigint,
    is_service                  boolean         NOT NULL DEFAULT false,
    preheader                   varchar,
    utm_custom                  varchar,
    source_type                 varchar(128)    NOT NULL DEFAULT '',
    product_type                text[]          NOT NULL DEFAULT '{}',
    source                      varchar(100),
    is_info                     boolean         NOT NULL DEFAULT false,
    trigger_type                varchar(8)      NOT NULL DEFAULT '',
    sending_day                 smallint        NOT NULL DEFAULT 0,
    partner_name                varchar(100),
    ab_group                    varchar(8),
    aff_sub3                    varchar(255)    NOT NULL DEFAULT '',
    communication_name          varchar(255)    NOT NULL DEFAULT '',
    active_flag                 boolean         DEFAULT true,
    touch_point                 varchar         NOT NULL DEFAULT '',
    communication_type          varchar(16)     NOT NULL DEFAULT '',
    permanent_exclude           boolean,
    business_communication_type varchar(16)     NOT NULL DEFAULT '',
    selection_wizard_service    varchar(16),
    national_rating             boolean         NOT NULL DEFAULT false,
    marketplace                 boolean,
    mobile_app                  boolean,
    loyalty                     boolean,
    dialog                      boolean,
    news                        boolean,
    mail_text                   varchar,
    links_info                  jsonb
);
ALTER SEQUENCE notice.email_template_id_seq OWNED BY notice.email_template.id;

-- ------------------------------------------------------------------- SMS
CREATE SEQUENCE IF NOT EXISTS notice.d_com_sms_template_id_seq;
CREATE TABLE IF NOT EXISTS notice.d_com_sms_template (
    id                          integer         PRIMARY KEY DEFAULT nextval('notice.d_com_sms_template_id_seq'),
    code                        integer,
    brief                       varchar(60),
    name                        varchar(60),
    msg_text                    text,
    default_attrs               jsonb,
    required_attrs              text[],
    attribute_values            varchar,
    source_type                 varchar(128)    NOT NULL DEFAULT '',
    product_type                text[]          NOT NULL DEFAULT '{}',
    communication_type          varchar(16)     NOT NULL DEFAULT '',
    source                      varchar(100),
    trigger_type                varchar(8)      NOT NULL DEFAULT '',
    sending_day                 smallint        NOT NULL DEFAULT 0,
    partner_name                varchar(100),
    ab_group                    varchar(8),
    aff_sub3                    varchar(255)    NOT NULL DEFAULT '',
    active_flag                 boolean         DEFAULT true,
    communication_name          varchar         NOT NULL DEFAULT '',
    touch_point                 varchar         NOT NULL DEFAULT '',
    permanent_exclude           boolean,
    business_communication_type varchar(16)     NOT NULL DEFAULT '',
    night_send                  boolean         NOT NULL DEFAULT false,
    selection_wizard_service    varchar(16),
    national_rating             boolean         NOT NULL DEFAULT false,
    marketplace                 boolean         NOT NULL DEFAULT false,
    mobile_app                  boolean         NOT NULL DEFAULT false,
    loyalty                     boolean         NOT NULL DEFAULT false,
    dialog                      boolean         NOT NULL DEFAULT false,
    news                        boolean         NOT NULL DEFAULT false,
    sender_name                 varchar(30),
    antispam_check              boolean         NOT NULL DEFAULT false
);
ALTER SEQUENCE notice.d_com_sms_template_id_seq OWNED BY notice.d_com_sms_template.id;

-- -------------------------------------------------------- CALL CENTER (CC)
-- Mirrors the real prod DDL. NB: the PK is a surrogate "id" (bigint, auto); "segment"
-- is a separate NOT NULL business number the user supplies and the app looks templates up by.
CREATE SEQUENCE IF NOT EXISTS callcenter.d_segment_properties_id_seq;
CREATE TABLE IF NOT EXISTS callcenter.d_segment_properties (
    id                             bigint       PRIMARY KEY DEFAULT nextval('callcenter.d_segment_properties_id_seq'),
    source_system                  varchar      NOT NULL DEFAULT '',
    segment                        integer      NOT NULL,
    segment_descr                  text,
    active_flag                    boolean      DEFAULT true,
    host_id                        bigint,
    ml_check_probability           boolean,
    ml_probability_required        numeric,
    cutpercent                     integer,
    nocutpercent                   integer,
    send_loyal_info                boolean,
    product_type                   text[]       NOT NULL DEFAULT '{}',
    ml_check_probability_loyal     boolean,
    ml_probability_required_loyal  numeric,
    trigger_type                   varchar(8)   NOT NULL DEFAULT '',
    sending_day                    smallint     NOT NULL DEFAULT 0,
    ab_group                       varchar(8),
    aff_sub3                       varchar(255) NOT NULL DEFAULT '',
    communication_type             varchar(16)  NOT NULL DEFAULT '',
    partner_name                   varchar(100),
    communication_name             varchar(255) NOT NULL DEFAULT '',
    source_type                    varchar(128) NOT NULL DEFAULT '',
    placement                      varchar(20),
    touch_point                    varchar      NOT NULL DEFAULT '',
    kvint_campaign_id              varchar(100),
    ml_probability_required_uplift numeric,
    active_ml_probability_type     varchar(100),
    business_communication_type    varchar(16)  NOT NULL DEFAULT '',
    selection_wizard_service       varchar(16),
    national_rating                boolean      NOT NULL DEFAULT false,
    marketplace                    boolean      NOT NULL DEFAULT false,
    mobile_app                     boolean      NOT NULL DEFAULT false,
    loyalty                        boolean      NOT NULL DEFAULT false,
    dialog                         boolean      NOT NULL DEFAULT false,
    news                           boolean      NOT NULL DEFAULT false,
    permanent_exclude              boolean
);
ALTER SEQUENCE callcenter.d_segment_properties_id_seq OWNED BY callcenter.d_segment_properties.id;

-- --------------------------------------------------------------- AUDIT LOG
CREATE TABLE IF NOT EXISTS arch.arch_log (
    id          bigserial   PRIMARY KEY,
    table_name  text        NOT NULL,
    operation   text        NOT NULL,
    row_pk      text,
    changed_by  text,
    changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION arch.log_change() RETURNS trigger AS $$
DECLARE
    pk text;
BEGIN
    pk := COALESCE(
        (to_jsonb(NEW) ->> 'code'), (to_jsonb(NEW) ->> 'id'), (to_jsonb(NEW) ->> 'segment'),
        (to_jsonb(OLD) ->> 'code'), (to_jsonb(OLD) ->> 'id'), (to_jsonb(OLD) ->> 'segment')
    );
    INSERT INTO arch.arch_log(table_name, operation, row_pk, changed_by)
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP, pk,
            current_setting('app.current_user', true));
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_push   AFTER INSERT OR UPDATE OR DELETE ON notice.push_template          FOR EACH ROW EXECUTE FUNCTION arch.log_change();
CREATE TRIGGER trg_audit_email  AFTER INSERT OR UPDATE OR DELETE ON notice.email_template         FOR EACH ROW EXECUTE FUNCTION arch.log_change();
CREATE TRIGGER trg_audit_sms    AFTER INSERT OR UPDATE OR DELETE ON notice.d_com_sms_template     FOR EACH ROW EXECUTE FUNCTION arch.log_change();
CREATE TRIGGER trg_audit_cc     AFTER INSERT OR UPDATE OR DELETE ON callcenter.d_segment_properties FOR EACH ROW EXECUTE FUNCTION arch.log_change();
