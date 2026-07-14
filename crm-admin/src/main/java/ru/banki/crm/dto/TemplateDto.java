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
}
