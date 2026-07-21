package ru.banki.crm.dto;

import lombok.Data;

import java.util.List;

/**
 * Unified create/read/update payload across all channels. Only the fields relevant
 * to a given channel are populated; the service maps them onto the right entity.
 */
@Data
public class TemplateDto {

    private String channel;            // push | email | sms | cc
    private String code;               // business id (code / email id / cc segment) — string over the wire

    // --- shared core ---
    private List<String> productType;
    private String sourceType;
    private String communicationType;
    private String source;
    private String triggerType;
    private String sendingDay;
    private String partnerName;
    private String affSub3;
    private Boolean active;
    private String communicationName;
    private String touchPoint;
    private String businessCommunicationType;
    private Boolean nationalRating;
    private Boolean marketplace;
    private Boolean mobileApp;
    private Boolean loyalty;
    private Boolean dialog;
    private Boolean news;
    private String selectionWizardService;

    // --- push / sms ---
    private String msgText;
    private String title;
    private String brief;
    private String name;
    private String deepLink;
    private String webviewUrl;
    private String senderName;
    private Boolean nightSend;

    // --- email ---
    private String letterosId;
    private String subject;
    private String emailFrom;
    private Boolean serviceFlag;
    private Boolean infoFlag;
    private String preheader;
    private String utmCustom;

    // --- cc ---
    private String sourceSystem;
    private String segmentDescr;
    private Long hostId;
    private Boolean mlCheckProbability;
    private java.math.BigDecimal mlProbabilityRequired;
    private Integer cutpercent;
    private Integer nocutpercent;
    private String kvintCampaignId;

    // --- fa (финансовый ассистент, fa_template) ---
    private String faId;
    private Boolean needPush;
    private String c2dTransport;
    private String c2dAccount;
    private Long ch2dOperatorId;
    private String webUrl;
    private String linkTitle;
    private Integer channelId;
    private String actionButtons;   // jsonb (общий с la)

    // --- vk (vk_template) ---
    private String vkTemplateName;
    private Integer ttl;
    private String abGroup;         // общий с la
    private String buttons;         // jsonb

    // --- la (live activity, live_activity_template) ---
    private String activityName;
    private String laEvent;
    private String laVisualization;
    private String laVisualizationAttributes;  // jsonb
    private String laStatus;
    private Integer currentStep;
}
