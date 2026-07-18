package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import ru.banki.crm.security.CurrentUser;

import java.util.List;

/**
 * Единый справочник шаблонов template.d_template — ОСНОВНОЕ хранилище новой архитектуры.
 * Канальные таблицы (notice.* и callcenter.*) — staging-буфер прод-структуры 1:1:
 * из их строк собирается payload для синка во внешнюю прод-БД (app.prod_sync, outbox).
 *
 * Вызывается после каждой операции мастера (TemplateService) и при материализации цепочек.
 */
@Service
public class UnifiedTemplateService {

    /** Ядровые колонки, одинаковые во всех 4 канальных таблицах (email/cc не имеют night_send). */
    private static final String CORE_COLS =
            "communication_name, source_type, communication_type, business_communication_type, trigger_type, " +
            "sending_day, product_type, partner_name, touch_point, aff_sub3, selection_wizard_service, " +
            "marketplace, dialog, loyalty, national_rating, news, mobile_app, night_send, permanent_exclude, active_flag";

    public record ChannelTable(String table, String codeCol, boolean hasNight, boolean prodAssignsCode) {}

    /** (таблица, колонка бизнес-кода, есть ли night_send, генерит ли код прод-БД). */
    public static ChannelTable channelTable(String channel) {
        return switch (channel == null ? "" : channel) {
            case "sms" -> new ChannelTable("notice.d_com_sms_template", "code", true, true);
            case "push" -> new ChannelTable("notice.push_template", "code", true, true);
            case "email" -> new ChannelTable("notice.email_template", "id", false, true);
            // у КЦ код (segment) — бизнес-ключ, задаётся пользователем, прод его не переназначает
            case "cc" -> new ChannelTable("callcenter.d_segment_properties", "segment", false, false);
            default -> null;
        };
    }

    @PersistenceContext
    private EntityManager em;

    /** Свёртка строки канальной таблицы в единый справочник (channel_props = всё, что не ядро). */
    public void upsertFromChannel(String channel, long code) {
        ChannelTable ct = channelTable(channel);
        if (ct == null) return;
        String nightExpr = ct.hasNight() ? "coalesce(t.night_send, false)" : "false";
        String sql =
            "INSERT INTO template.d_template (channel, code, communication_name, campaign_name, communication_type, " +
            "  business_communication_type, trigger_type, sending_day, product_type, partner_name, touch_point, " +
            "  aff_sub3, selection_wizard_service, marketplace, dialog, loyalty, national_rating, news, mobile_app, " +
            "  night_send, permanent_exclude, active_flag, channel_props) " +
            "SELECT :ch, t." + ct.codeCol() + ", t.communication_name, t.source_type, t.communication_type, " +
            "  t.business_communication_type, t.trigger_type, t.sending_day, t.product_type, t.partner_name, t.touch_point, " +
            "  t.aff_sub3, t.selection_wizard_service, coalesce(t.marketplace,false), coalesce(t.dialog,false), " +
            "  coalesce(t.loyalty,false), coalesce(t.national_rating,false), coalesce(t.news,false), " +
            "  coalesce(t.mobile_app,false), " + nightExpr + ", coalesce(t.permanent_exclude,false), coalesce(t.active_flag,true), " +
            "  to_jsonb(t) - string_to_array('id," + ct.codeCol() + "," + CORE_COLS.replace(" ", "") + "', ',') " +
            "FROM " + ct.table() + " t WHERE t." + ct.codeCol() + " = :c " +
            "ON CONFLICT (channel, code) DO UPDATE SET " +
            "  communication_name = EXCLUDED.communication_name, campaign_name = EXCLUDED.campaign_name, " +
            "  communication_type = EXCLUDED.communication_type, business_communication_type = EXCLUDED.business_communication_type, " +
            "  trigger_type = EXCLUDED.trigger_type, sending_day = EXCLUDED.sending_day, product_type = EXCLUDED.product_type, " +
            "  partner_name = EXCLUDED.partner_name, touch_point = EXCLUDED.touch_point, aff_sub3 = EXCLUDED.aff_sub3, " +
            "  selection_wizard_service = EXCLUDED.selection_wizard_service, marketplace = EXCLUDED.marketplace, " +
            "  dialog = EXCLUDED.dialog, loyalty = EXCLUDED.loyalty, national_rating = EXCLUDED.national_rating, " +
            "  news = EXCLUDED.news, mobile_app = EXCLUDED.mobile_app, night_send = EXCLUDED.night_send, " +
            "  permanent_exclude = EXCLUDED.permanent_exclude, active_flag = EXCLUDED.active_flag, " +
            "  channel_props = EXCLUDED.channel_props, timestamp_upd = now()";
        em.createNativeQuery(sql)
                .setParameter("ch", channel)
                .setParameter("c", code)
                .executeUpdate();
    }

    /** Удаление из единого справочника (при удалении шаблона в мастере). */
    public void deleteUnified(String channel, long code) {
        em.createNativeQuery("DELETE FROM template.d_template WHERE channel = :ch AND code = :c")
                .setParameter("ch", channel)
                .setParameter("c", code)
                .executeUpdate();
    }

    /** Актуальная строка канальной таблицы как json (payload прод-синка). Требует flush изменений. */
    public String channelRowJson(String channel, long code) {
        ChannelTable ct = channelTable(channel);
        if (ct == null) return null;
        List<?> r = em.createNativeQuery(
                        "SELECT to_jsonb(t)::text FROM " + ct.table() + " t WHERE t." + ct.codeCol() + " = :c")
                .setParameter("c", code)
                .getResultList();
        return r.isEmpty() ? null : String.valueOf(r.get(0));
    }

    /** Поставить операцию в очередь синка с прод-БД (outbox). payload — строка канальной таблицы 1:1. */
    public void enqueueProdSync(String channel, String operation, Long localCode, String payloadJson) {
        if (payloadJson == null) return;
        em.createNativeQuery("INSERT INTO app.prod_sync (channel, operation, local_code, payload, created_by)" +
                        " VALUES (:ch, :op, :c, CAST(:p AS jsonb), :u)")
                .setParameter("ch", channel)
                .setParameter("op", operation)
                .setParameter("c", localCode)
                .setParameter("p", payloadJson)
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
    }

    /** Смена кода после присвоения прод-БД: канальная строка + единый справочник. */
    public void applyProdCode(String channel, long localCode, long prodCode) {
        if (localCode == prodCode) return;
        ChannelTable ct = channelTable(channel);
        if (ct == null || !ct.prodAssignsCode()) return;
        em.createNativeQuery("UPDATE " + ct.table() + " SET " + ct.codeCol() + " = :n WHERE " + ct.codeCol() + " = :o")
                .setParameter("n", prodCode)
                .setParameter("o", localCode)
                .executeUpdate();
        em.createNativeQuery("UPDATE template.d_template SET code = :n, timestamp_upd = now()" +
                        " WHERE channel = :ch AND code = :o")
                .setParameter("n", prodCode)
                .setParameter("ch", channel)
                .setParameter("o", localCode)
                .executeUpdate();
        // хвост очереди этого шаблона: ещё не доставленные UPDATE/DELETE переводим на новый код
        em.createNativeQuery("UPDATE app.prod_sync SET local_code = :n," +
                        " payload = jsonb_set(payload, ('{'||:col||'}')::text[], to_jsonb(CAST(:n AS bigint)))," +
                        " timestamp_upd = now()" +
                        " WHERE channel = :ch AND local_code = :o AND status = 'PENDING'")
                .setParameter("n", prodCode)
                .setParameter("col", ct.codeCol())
                .setParameter("ch", channel)
                .setParameter("o", localCode)
                .executeUpdate();
    }
}
