package ru.banki.crm.service;

import org.springframework.stereotype.Component;
import ru.banki.crm.domain.*;
import ru.banki.crm.dto.TemplateDto;
import ru.banki.crm.dto.TemplateListItemDto;

/** Maps the unified {@link TemplateDto} onto the four channel entities and back. */
@Component
public class TemplateMapper {

    // ---------------------------------------------------------------- list row
    public TemplateListItemDto toListItem(TemplateBase e) {
        String letteros = (e instanceof EmailTemplate em && em.getLetterosId() != null)
                ? String.valueOf(em.getLetterosId()) : null;
        return new TemplateListItemDto(
                e.channel(),
                e.businessCode(),
                e.getCommunicationName(),
                e.getProductType(),
                e.getTouchPoint(),
                e.getTriggerType(),
                e.getPartnerName(),
                e.getActiveFlag(),
                letteros,
                e.getSourceType()
        );
    }

    // ---------------------------------------------------------------- full read
    public TemplateDto toDto(TemplateBase e) {
        TemplateDto d = new TemplateDto();
        d.setChannel(e.channel());
        d.setCode(e.businessCode());
        d.setProductType(e.getProductType());
        d.setSourceType(e.getSourceType());
        d.setCommunicationType(e.getCommunicationType());
        d.setTriggerType(e.getTriggerType());
        d.setSendingDay(e.getSendingDay() == null ? null : String.valueOf(e.getSendingDay()));
        d.setPartnerName(e.getPartnerName());
        d.setAffSub3(e.getAffSub3());
        d.setActive(e.getActiveFlag());
        d.setCommunicationName(e.getCommunicationName());
        d.setTouchPoint(e.getTouchPoint());
        d.setBusinessCommunicationType(e.getBusinessCommunicationType());
        d.setNationalRating(e.getNationalRating());
        d.setMarketplace(e.getMarketplace());
        d.setMobileApp(e.getMobileApp());
        d.setLoyalty(e.getLoyalty());
        d.setDialog(e.getDialog());
        d.setNews(e.getNews());
        d.setSelectionWizardService(e.getSelectionWizardService());

        if (e instanceof PushTemplate p) {
            d.setSource(p.getSource());
            d.setMsgText(p.getMsgText());
            d.setTitle(p.getTitle());
            d.setBrief(p.getBrief());
            d.setName(p.getName());
            d.setDeepLink(p.getDeepLink());
            d.setWebviewUrl(p.getWebviewUrl());
            d.setNightSend(p.getNightSend());
        } else if (e instanceof SmsTemplate s) {
            d.setSource(s.getSource());
            d.setMsgText(s.getMsgText());
            d.setBrief(s.getBrief());
            d.setName(s.getName());
            d.setSenderName(s.getSenderName());
            d.setNightSend(s.getNightSend());
        } else if (e instanceof EmailTemplate em) {
            d.setSource(em.getSource());
            d.setLetterosId(em.getLetterosId() == null ? null : String.valueOf(em.getLetterosId()));
            d.setSubject(em.getSubject());
            d.setEmailFrom(em.getEmailFrom());
            d.setServiceFlag(em.getService());
            d.setInfoFlag(em.getInfo());
            d.setMsgText(em.getMsgText());
            d.setPreheader(em.getPreheader());
            d.setUtmCustom(em.getUtmCustom());
        } else if (e instanceof CcSegment c) {
            d.setSourceSystem(c.getSourceSystem());
            d.setSegmentDescr(c.getSegmentDescr());
            d.setHostId(c.getHostId());
            d.setMlCheckProbability(c.getMlCheckProbability());
            d.setMlProbabilityRequired(c.getMlProbabilityRequired());
            d.setCutpercent(c.getCutpercent());
            d.setNocutpercent(c.getNocutpercent());
            d.setKvintCampaignId(c.getKvintCampaignId());
        }
        return d;
    }

    // ---------------------------------------------------------------- write
    /** Applies non-null dto fields onto the entity (works for both create and update). */
    public void apply(TemplateBase e, TemplateDto d) {
        set(d.getProductType(), e::setProductType);
        set(d.getSourceType(), e::setSourceType);
        set(d.getCommunicationType(), e::setCommunicationType);
        set(d.getTriggerType(), e::setTriggerType);
        setInt(d.getSendingDay(), e::setSendingDay);
        set(d.getPartnerName(), e::setPartnerName);
        set(d.getAffSub3(), e::setAffSub3);
        set(d.getActive(), e::setActiveFlag);
        set(d.getCommunicationName(), e::setCommunicationName);
        set(d.getTouchPoint(), e::setTouchPoint);
        set(d.getBusinessCommunicationType(), e::setBusinessCommunicationType);
        set(d.getNationalRating(), e::setNationalRating);
        set(d.getMarketplace(), e::setMarketplace);
        set(d.getMobileApp(), e::setMobileApp);
        set(d.getLoyalty(), e::setLoyalty);
        set(d.getDialog(), e::setDialog);
        set(d.getNews(), e::setNews);
        set(d.getSelectionWizardService(), e::setSelectionWizardService);

        if (e instanceof PushTemplate p) {
            set(d.getSource(), p::setSource);
            set(d.getMsgText(), p::setMsgText);
            set(d.getTitle(), p::setTitle);
            set(d.getBrief(), p::setBrief);
            set(d.getName(), p::setName);
            set(d.getDeepLink(), p::setDeepLink);
            set(d.getWebviewUrl(), p::setWebviewUrl);
            set(d.getNightSend(), p::setNightSend);
        } else if (e instanceof SmsTemplate s) {
            set(d.getSource(), s::setSource);
            set(d.getMsgText(), s::setMsgText);
            set(d.getBrief(), s::setBrief);
            set(d.getName(), s::setName);
            set(d.getSenderName(), s::setSenderName);
            set(d.getNightSend(), s::setNightSend);
        } else if (e instanceof EmailTemplate em) {
            set(d.getSource(), em::setSource);
            setLong(d.getLetterosId(), em::setLetterosId);
            set(d.getSubject(), em::setSubject);
            set(d.getEmailFrom(), em::setEmailFrom);
            set(d.getServiceFlag(), em::setService);
            set(d.getInfoFlag(), em::setInfo);
            set(d.getMsgText(), em::setMsgText);
            set(d.getPreheader(), em::setPreheader);
            set(d.getUtmCustom(), em::setUtmCustom);
        } else if (e instanceof CcSegment c) {
            set(d.getSourceSystem(), c::setSourceSystem);
            set(d.getSegmentDescr(), c::setSegmentDescr);
            set(d.getHostId(), c::setHostId);
            set(d.getMlCheckProbability(), c::setMlCheckProbability);
            set(d.getMlProbabilityRequired(), c::setMlProbabilityRequired);
            set(d.getCutpercent(), c::setCutpercent);
            set(d.getNocutpercent(), c::setNocutpercent);
            set(d.getKvintCampaignId(), c::setKvintCampaignId);
        }
    }

    private static <T> void set(T value, java.util.function.Consumer<T> setter) {
        if (value != null) {
            setter.accept(value);
        }
    }

    /** Parses a numeric string (e.g. sending_day) and applies it; blank/invalid is skipped. */
    private static void setInt(String value, java.util.function.Consumer<Integer> setter) {
        if (value != null && !value.isBlank()) {
            try {
                setter.accept(Integer.valueOf(value.trim()));
            } catch (NumberFormatException ignored) {
                // leave the entity default in place
            }
        }
    }

    private static void setLong(String value, java.util.function.Consumer<Long> setter) {
        if (value != null && !value.isBlank()) {
            try {
                setter.accept(Long.valueOf(value.trim()));
            } catch (NumberFormatException ignored) {
                // letteros_id is bigint; non-numeric input is ignored
            }
        }
    }
}
