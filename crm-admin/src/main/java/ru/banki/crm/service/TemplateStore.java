package ru.banki.crm.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.dto.TemplateDto;
import ru.banki.crm.dto.TemplateListItemDto;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Хранилище шаблонов новой архитектуры: ЕДИНСТВЕННЫЙ источник — template.d_template
 * (ядро типизированными колонками + channel_props jsonb с канальными полями).
 * Канальные таблицы (схемы notice и callcenter) больше не читаются и не пишутся —
 * они остались только как исторические данные; в прод-БД строка собирается из
 * d_template обратно в прод-структуру (см. prodPayload).
 */
@Service
public class TemplateStore {

    /** Поле DTO -> ключ channel_props (имена колонок прод-таблиц). */
    private static final Map<String, String> PROPS = Map.ofEntries(
            Map.entry("source", "source"),
            Map.entry("msgText", "msg_text"),
            Map.entry("title", "title"),
            Map.entry("brief", "brief"),
            Map.entry("name", "name"),
            Map.entry("deepLink", "deep_link"),
            Map.entry("webviewUrl", "webview_url"),
            Map.entry("senderName", "sender_name"),
            Map.entry("letterosId", "letteros_id"),
            Map.entry("subject", "subject"),
            Map.entry("emailFrom", "email_from"),
            Map.entry("serviceFlag", "is_service"),
            Map.entry("infoFlag", "is_info"),
            Map.entry("preheader", "preheader"),
            Map.entry("utmCustom", "utm_custom"),
            Map.entry("sourceSystem", "source_system"),
            Map.entry("segmentDescr", "segment_descr"),
            Map.entry("hostId", "host_id"),
            Map.entry("mlCheckProbability", "ml_check_probability"),
            Map.entry("mlProbabilityRequired", "ml_probability_required"),
            Map.entry("cutpercent", "cutpercent"),
            Map.entry("nocutpercent", "nocutpercent"),
            Map.entry("kvintCampaignId", "kvint_campaign_id"));

    /** Ядровые колонки d_template -> имя колонки в прод-таблице (для payload синка). */
    private static final Map<String, String> CORE_TO_PROD = new LinkedHashMap<>(Map.ofEntries(
            Map.entry("communication_name", "communication_name"),
            Map.entry("campaign_name", "source_type"),
            Map.entry("communication_type", "communication_type"),
            Map.entry("business_communication_type", "business_communication_type"),
            Map.entry("trigger_type", "trigger_type"),
            Map.entry("sending_day", "sending_day"),
            Map.entry("product_type", "product_type"),
            Map.entry("partner_name", "partner_name"),
            Map.entry("touch_point", "touch_point"),
            Map.entry("aff_sub3", "aff_sub3"),
            Map.entry("selection_wizard_service", "selection_wizard_service"),
            Map.entry("marketplace", "marketplace"),
            Map.entry("dialog", "dialog"),
            Map.entry("loyalty", "loyalty"),
            Map.entry("national_rating", "national_rating"),
            Map.entry("news", "news"),
            Map.entry("mobile_app", "mobile_app"),
            Map.entry("night_send", "night_send"),
            Map.entry("permanent_exclude", "permanent_exclude"),
            Map.entry("active_flag", "active_flag")));

    private final JdbcTemplate jdbc;
    private final ObjectMapper om;

    public TemplateStore(JdbcTemplate jdbc, ObjectMapper om) {
        this.jdbc = jdbc;
        this.om = om;
    }

    // ------------------------------------------------------------------- READ
    public List<TemplateListItemDto> list() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT channel, code, communication_name, campaign_name, product_type, touch_point," +
                " trigger_type, partner_name, active_flag, channel_props->>'letteros_id' AS letteros_id" +
                " FROM template.d_template ORDER BY channel, code");
        List<TemplateListItemDto> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            out.add(new TemplateListItemDto(
                    str(r.get("channel")),
                    str(r.get("code")),
                    str(r.get("communication_name")),
                    toList(r.get("product_type")),
                    str(r.get("touch_point")),
                    str(r.get("trigger_type")),
                    str(r.get("partner_name")),
                    (Boolean) r.get("active_flag"),
                    str(r.get("letteros_id")),
                    str(r.get("campaign_name"))));
        }
        return out;
    }

    public TemplateDto get(String channel, String code) {
        JsonNode row = rowNode(channel, code);
        if (row == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Шаблон не найден: " + channel + "/" + code);
        }
        TemplateDto d = new TemplateDto();
        d.setChannel(text(row, "channel"));
        d.setCode(text(row, "code"));
        d.setCommunicationName(text(row, "communication_name"));
        d.setSourceType(text(row, "campaign_name"));
        d.setCommunicationType(text(row, "communication_type"));
        d.setBusinessCommunicationType(text(row, "business_communication_type"));
        d.setTriggerType(text(row, "trigger_type"));
        d.setSendingDay(text(row, "sending_day"));
        d.setPartnerName(text(row, "partner_name"));
        d.setTouchPoint(text(row, "touch_point"));
        d.setAffSub3(text(row, "aff_sub3"));
        d.setSelectionWizardService(text(row, "selection_wizard_service"));
        d.setMarketplace(bool(row, "marketplace"));
        d.setDialog(bool(row, "dialog"));
        d.setLoyalty(bool(row, "loyalty"));
        d.setNationalRating(bool(row, "national_rating"));
        d.setNews(bool(row, "news"));
        d.setMobileApp(bool(row, "mobile_app"));
        d.setNightSend(bool(row, "night_send"));
        d.setActive(bool(row, "active_flag"));
        JsonNode pt = row.get("product_type");
        if (pt != null && pt.isArray()) {
            List<String> products = new ArrayList<>();
            pt.forEach(n -> products.add(n.asText()));
            d.setProductType(products);
        }
        // канальные поля из channel_props
        JsonNode props = row.get("channel_props");
        if (props != null && props.isObject()) {
            d.setSource(txt(props, "source"));
            d.setMsgText(txt(props, "msg_text"));
            d.setTitle(txt(props, "title"));
            d.setBrief(txt(props, "brief"));
            d.setName(txt(props, "name"));
            d.setDeepLink(txt(props, "deep_link"));
            d.setWebviewUrl(txt(props, "webview_url"));
            d.setSenderName(txt(props, "sender_name"));
            d.setLetterosId(txt(props, "letteros_id"));
            d.setSubject(txt(props, "subject"));
            d.setEmailFrom(txt(props, "email_from"));
            d.setServiceFlag(bool(props, "is_service"));
            d.setInfoFlag(bool(props, "is_info"));
            d.setPreheader(txt(props, "preheader"));
            d.setUtmCustom(txt(props, "utm_custom"));
            d.setSourceSystem(txt(props, "source_system"));
            d.setSegmentDescr(txt(props, "segment_descr"));
            if (props.hasNonNull("host_id")) d.setHostId(props.get("host_id").asLong());
            d.setKvintCampaignId(txt(props, "kvint_campaign_id"));
            // fa
            d.setFaId(txt(props, "fa_id"));
            d.setC2dTransport(txt(props, "c2d_transport"));
            d.setC2dAccount(txt(props, "c2d_account"));
            d.setWebUrl(txt(props, "web_url"));
            d.setLinkTitle(txt(props, "link_title"));
            if (props.has("need_push")) d.setNeedPush(bool(props, "need_push"));
            if (props.hasNonNull("ch2d_operator_id")) d.setCh2dOperatorId(props.get("ch2d_operator_id").asLong());
            if (props.hasNonNull("channel_id")) d.setChannelId(props.get("channel_id").asInt());
            d.setActionButtons(jsonTxt(props, "action_buttons"));
            // vk
            d.setVkTemplateName(txt(props, "vk_template_name"));
            d.setAbGroup(txt(props, "ab_group"));
            if (props.hasNonNull("ttl")) d.setTtl(props.get("ttl").asInt());
            d.setButtons(jsonTxt(props, "buttons"));
            // la
            d.setActivityName(txt(props, "activity_name"));
            d.setLaEvent(txt(props, "la_event"));
            d.setLaVisualization(txt(props, "la_visualization"));
            d.setLaStatus(txt(props, "la_status"));
            if (props.hasNonNull("current_step")) d.setCurrentStep(props.get("current_step").asInt());
            d.setLaVisualizationAttributes(jsonTxt(props, "la_visualization_attributes"));
        }
        return d;
    }

    public boolean exists(String channel, String code) {
        Long n = jdbc.queryForObject(
                "SELECT count(*) FROM template.d_template WHERE channel = ? AND code = ?",
                Long.class, channel, asLong(code));
        return n != null && n > 0;
    }

    /** Строка шаблона как json — для журнала t_admin_log. */
    public String rowJson(String channel, String code) {
        List<String> r = jdbc.queryForList(
                "SELECT to_jsonb(t)::text FROM template.d_template t WHERE channel = ? AND code = ?",
                String.class, channel, asLong(code));
        return r.isEmpty() ? null : r.get(0);
    }

    /**
     * Строка в структуре ПРОД-таблицы: channel_props + ядро под прод-именами + бизнес-код.
     * Именно это уезжает в прод-БД через очередь синка.
     */
    public String prodPayload(String channel, String code) {
        JsonNode row = rowNode(channel, code);
        if (row == null) return null;
        ObjectNode out = (row.get("channel_props") != null && row.get("channel_props").isObject())
                ? ((ObjectNode) row.get("channel_props")).deepCopy()
                : om.createObjectNode();
        CORE_TO_PROD.forEach((ourCol, prodCol) -> {
            JsonNode v = row.get(ourCol);
            // null не отправляем: в проде такие колонки NOT NULL с дефолтом — пусть остаются как есть
            if (v != null && !v.isNull()) out.set(prodCol, v);
        });
        List<String> emptyKeys = new ArrayList<>();
        out.fieldNames().forEachRemaining(k -> { if (out.get(k).isNull()) emptyKeys.add(k); });
        emptyKeys.forEach(out::remove);
        out.put(codeColumn(channel), asLong(code));
        return out.toString();
    }

    /** Имя колонки бизнес-кода в прод-таблице канала. */
    public static String codeColumn(String channel) {
        return switch (channel == null ? "" : channel) {
            case "email", "fa", "vk", "la" -> "id";
            case "cc" -> "segment";
            default -> "code";
        };
    }

    // ------------------------------------------------------------------ WRITE
    /**
     * Следующий бизнес-код канала (у КЦ segment задаёт пользователь).
     * Диапазон нумерации тот же, что и в проде: sms/email — до 10000, push — сквозной.
     */
    public long nextCode(String channel) {
        Long limit = UnifiedTemplateService.channelTable(channel) == null
                ? null : UnifiedTemplateService.channelTable(channel).codeLimit();
        Long max = limit == null
                ? jdbc.queryForObject("SELECT COALESCE(MAX(code), 0) FROM template.d_template WHERE channel = ?",
                        Long.class, channel)
                : jdbc.queryForObject("SELECT COALESCE(MAX(code), 0) FROM template.d_template" +
                        " WHERE channel = ? AND code < ?", Long.class, channel, limit);
        long next = (max == null ? 0 : max) + 1;
        if (limit != null && next >= limit) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Свободные коды канала " + channel + " в диапазоне до " + limit + " закончились");
        }
        return next;
    }

    public void insert(String channel, long code, TemplateDto d) {
        jdbc.update("INSERT INTO template.d_template (channel, code, communication_name, campaign_name," +
                        " communication_type, business_communication_type, trigger_type, sending_day, product_type," +
                        " partner_name, touch_point, aff_sub3, selection_wizard_service, marketplace, dialog," +
                        " loyalty, national_rating, news, mobile_app, night_send, active_flag, channel_props)" +
                        " VALUES (?,?,?,?,?,?,?,?,CAST(? AS text[]),?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS jsonb))",
                // дефолты как у прежних сущностей: прод-колонки NOT NULL не принимают null
                channel, code, nz(d.getCommunicationName()), nz(d.getSourceType()),
                nz(d.getCommunicationType()), nz(d.getBusinessCommunicationType()), nz(d.getTriggerType()),
                d.getSendingDay() == null || d.getSendingDay().isBlank() ? 0 : intOrNull(d.getSendingDay()),
                pgArray(d.getProductType()),
                d.getPartnerName(), nz(d.getTouchPoint()), nz(d.getAffSub3()), d.getSelectionWizardService(),
                flag(d.getMarketplace()), flag(d.getDialog()), flag(d.getLoyalty()), flag(d.getNationalRating()),
                flag(d.getNews()), flag(d.getMobileApp()), flag(d.getNightSend()),
                d.getActive() == null || d.getActive(), propsJson(d, channel));
    }

    /** Частичное обновление: null-поля DTO не затирают сохранённые значения. */
    public void update(String channel, String code, TemplateDto d) {
        JsonNode current = rowNode(channel, code);
        if (current == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Шаблон не найден: " + channel + "/" + code);
        }
        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        addSet(sets, args, "communication_name", d.getCommunicationName());
        addSet(sets, args, "campaign_name", d.getSourceType());
        addSet(sets, args, "communication_type", d.getCommunicationType());
        addSet(sets, args, "business_communication_type", d.getBusinessCommunicationType());
        addSet(sets, args, "trigger_type", d.getTriggerType());
        if (d.getSendingDay() != null && !d.getSendingDay().isBlank()) {
            sets.add("sending_day = ?");
            args.add(intOrNull(d.getSendingDay()));
        }
        if (d.getProductType() != null) {
            sets.add("product_type = CAST(? AS text[])");
            args.add(pgArray(d.getProductType()));
        }
        addSet(sets, args, "partner_name", d.getPartnerName());
        addSet(sets, args, "touch_point", d.getTouchPoint());
        addSet(sets, args, "aff_sub3", d.getAffSub3());
        addSet(sets, args, "selection_wizard_service", d.getSelectionWizardService());
        addSet(sets, args, "marketplace", d.getMarketplace());
        addSet(sets, args, "dialog", d.getDialog());
        addSet(sets, args, "loyalty", d.getLoyalty());
        addSet(sets, args, "national_rating", d.getNationalRating());
        addSet(sets, args, "news", d.getNews());
        addSet(sets, args, "mobile_app", d.getMobileApp());
        addSet(sets, args, "night_send", d.getNightSend());
        addSet(sets, args, "active_flag", d.getActive());
        // channel_props: мержим новые значения поверх сохранённых
        sets.add("channel_props = channel_props || CAST(? AS jsonb)");
        args.add(propsJson(d, channel));
        sets.add("timestamp_upd = now()");

        args.add(channel);
        args.add(asLong(code));
        jdbc.update("UPDATE template.d_template SET " + String.join(", ", sets) +
                " WHERE channel = ? AND code = ?", args.toArray());
    }

    public void delete(String channel, String code) {
        jdbc.update("DELETE FROM template.d_template WHERE channel = ? AND code = ?", channel, asLong(code));
    }

    /**
     * Обратный импорт: строка внешней прод-таблицы (jsonb, прод-имена колонок) → d_template.
     * Ядро по CORE_TO_PROD (source_type→campaign_name и т.д.), остальное (кроме id и кода) →
     * channel_props. Идемпотентно (ON CONFLICT DO UPDATE). НЕ ставит в очередь синка (тянем ИЗ прода).
     */
    public void upsertFromProdRow(String channel, JsonNode prod) {
        String codeCol = UnifiedTemplateService.channelTable(channel).codeCol();
        JsonNode codeNode = prod.get(codeCol);
        if (codeNode == null || codeNode.isNull()) return;
        long code = codeNode.asLong();
        java.util.Set<String> coreProd = new java.util.HashSet<>(CORE_TO_PROD.values());
        ObjectNode props = om.createObjectNode();
        prod.fieldNames().forEachRemaining(k -> {
            if (k.equals("id") || k.equals(codeCol) || coreProd.contains(k)) return;
            props.set(k, prod.get(k));
        });
        List<String> products = new ArrayList<>();
        JsonNode pt = prod.get("product_type");
        if (pt != null && pt.isArray()) pt.forEach(n -> products.add(n.asText()));
        jdbc.update(
            "INSERT INTO template.d_template (channel, code, communication_name, campaign_name, communication_type," +
            " business_communication_type, trigger_type, sending_day, product_type, partner_name, touch_point," +
            " aff_sub3, selection_wizard_service, marketplace, dialog, loyalty, national_rating, news, mobile_app," +
            " night_send, active_flag, permanent_exclude, channel_props)" +
            " VALUES (?,?,?,?,?,?,?,?,CAST(? AS text[]),?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS jsonb))" +
            " ON CONFLICT (channel, code) DO UPDATE SET communication_name=EXCLUDED.communication_name," +
            " campaign_name=EXCLUDED.campaign_name, communication_type=EXCLUDED.communication_type," +
            " business_communication_type=EXCLUDED.business_communication_type, trigger_type=EXCLUDED.trigger_type," +
            " sending_day=EXCLUDED.sending_day, product_type=EXCLUDED.product_type, partner_name=EXCLUDED.partner_name," +
            " touch_point=EXCLUDED.touch_point, aff_sub3=EXCLUDED.aff_sub3, selection_wizard_service=EXCLUDED.selection_wizard_service," +
            " marketplace=EXCLUDED.marketplace, dialog=EXCLUDED.dialog, loyalty=EXCLUDED.loyalty," +
            " national_rating=EXCLUDED.national_rating, news=EXCLUDED.news, mobile_app=EXCLUDED.mobile_app," +
            " night_send=EXCLUDED.night_send, active_flag=EXCLUDED.active_flag," +
            " permanent_exclude=EXCLUDED.permanent_exclude, channel_props=EXCLUDED.channel_props," +
            " timestamp_upd=now()",
            channel, code,
            nz(text(prod, "communication_name")), nz(text(prod, "source_type")), nz(text(prod, "communication_type")),
            nz(text(prod, "business_communication_type")), nz(text(prod, "trigger_type")),
            jbInt(prod, "sending_day"), pgArray(products),
            text(prod, "partner_name"), nz(text(prod, "touch_point")), nz(text(prod, "aff_sub3")), text(prod, "selection_wizard_service"),
            jbBool(prod, "marketplace"), jbBool(prod, "dialog"), jbBool(prod, "loyalty"), jbBool(prod, "national_rating"),
            jbBool(prod, "news"), jbBool(prod, "mobile_app"), jbBool(prod, "night_send"),
            jbBoolTrue(prod, "active_flag"), jbBool(prod, "permanent_exclude"), props.toString());
    }

    private static int jbInt(JsonNode row, String f) { JsonNode v = row.get(f); return v == null || v.isNull() ? 0 : v.asInt(); }
    private static boolean jbBool(JsonNode row, String f) { JsonNode v = row.get(f); return v != null && v.asBoolean(); }
    private static boolean jbBoolTrue(JsonNode row, String f) { JsonNode v = row.get(f); return v == null || v.isNull() || v.asBoolean(); }

    // ---------------------------------------------------------------- helpers
    private JsonNode rowNode(String channel, String code) {
        List<String> r = jdbc.queryForList(
                "SELECT to_jsonb(t)::text FROM template.d_template t WHERE channel = ? AND code = ?",
                String.class, channel, asLong(code));
        if (r.isEmpty()) return null;
        try {
            return om.readTree(r.get(0));
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось разобрать строку шаблона", e);
        }
    }

    /** channel_props из DTO: только заполненные канальные поля (остальные сохраняются как были). */
    private String propsJson(TemplateDto d, String channel) {
        ObjectNode props = om.createObjectNode();
        putIfSet(props, "source", d.getSource());
        putIfSet(props, "msg_text", d.getMsgText());
        putIfSet(props, "title", d.getTitle());
        putIfSet(props, "brief", d.getBrief());
        putIfSet(props, "name", d.getName());
        putIfSet(props, "deep_link", d.getDeepLink());
        putIfSet(props, "webview_url", d.getWebviewUrl());
        putIfSet(props, "sender_name", d.getSenderName());
        putIfSet(props, "subject", d.getSubject());
        putIfSet(props, "email_from", d.getEmailFrom());
        putIfSet(props, "preheader", d.getPreheader());
        putIfSet(props, "utm_custom", d.getUtmCustom());
        putIfSet(props, "source_system", d.getSourceSystem());
        putIfSet(props, "segment_descr", d.getSegmentDescr());
        putIfSet(props, "kvint_campaign_id", d.getKvintCampaignId());
        if (d.getLetterosId() != null && !d.getLetterosId().isBlank()) {
            Long l = asLongOrNull(d.getLetterosId());
            if (l != null) props.put("letteros_id", l);
        }
        if (d.getServiceFlag() != null) props.put("is_service", d.getServiceFlag());
        if (d.getInfoFlag() != null) props.put("is_info", d.getInfoFlag());
        if (d.getHostId() != null) props.put("host_id", d.getHostId());
        if (d.getMlCheckProbability() != null) props.put("ml_check_probability", d.getMlCheckProbability());
        if (d.getMlProbabilityRequired() != null) props.put("ml_probability_required", d.getMlProbabilityRequired());
        if (d.getCutpercent() != null) props.put("cutpercent", d.getCutpercent());
        if (d.getNocutpercent() != null) props.put("nocutpercent", d.getNocutpercent());
        // fa
        putIfSet(props, "fa_id", d.getFaId());
        putIfSet(props, "c2d_transport", d.getC2dTransport());
        putIfSet(props, "c2d_account", d.getC2dAccount());
        putIfSet(props, "web_url", d.getWebUrl());
        putIfSet(props, "link_title", d.getLinkTitle());
        if (d.getNeedPush() != null) props.put("need_push", d.getNeedPush());
        if (d.getCh2dOperatorId() != null) props.put("ch2d_operator_id", d.getCh2dOperatorId());
        if (d.getChannelId() != null) props.put("channel_id", d.getChannelId());
        putJsonIfSet(props, "action_buttons", d.getActionButtons());
        // vk
        putIfSet(props, "vk_template_name", d.getVkTemplateName());
        putIfSet(props, "ab_group", d.getAbGroup());
        if (d.getTtl() != null) props.put("ttl", d.getTtl());
        putJsonIfSet(props, "buttons", d.getButtons());
        // la
        putIfSet(props, "activity_name", d.getActivityName());
        putIfSet(props, "la_event", d.getLaEvent());
        putIfSet(props, "la_visualization", d.getLaVisualization());
        putIfSet(props, "la_status", d.getLaStatus());
        if (d.getCurrentStep() != null) props.put("current_step", d.getCurrentStep());
        putJsonIfSet(props, "la_visualization_attributes", d.getLaVisualizationAttributes());
        // поля, которые прод требует непустыми (напр. email.subject) — пустая строка вместо null
        UnifiedTemplateService.prodDefaults(channel).forEach((k, v) -> {
            if (!props.hasNonNull(k)) props.put(k, v);
        });
        return props.toString();
    }

    private static void putIfSet(ObjectNode n, String key, String value) {
        if (value != null) n.put(key, value);
    }

    /** jsonb-поле: парсим строку в узел; если не валидный JSON — кладём как строку (данные не теряем). */
    private void putJsonIfSet(ObjectNode n, String key, String jsonText) {
        if (jsonText == null || jsonText.isBlank()) return;
        try {
            n.set(key, om.readTree(jsonText));
        } catch (Exception e) {
            n.put(key, jsonText);
        }
    }

    /** Читает jsonb-поле обратно как JSON-строку (для DTO). */
    private static String jsonTxt(JsonNode props, String key) {
        JsonNode v = props.get(key);
        return (v == null || v.isNull()) ? null : v.toString();
    }

    private static void addSet(List<String> sets, List<Object> args, String col, Object value) {
        if (value != null) {
            sets.add(col + " = ?");
            args.add(value);
        }
    }

    private static boolean flag(Boolean b) {
        return Boolean.TRUE.equals(b);
    }

    /** Пустая строка вместо null — как было у сущностей (прод не принимает null в NOT NULL). */
    private static String nz(String v) {
        return v == null ? "" : v;
    }

    private static Integer intOrNull(String v) {
        if (v == null || v.isBlank()) return null;
        try { return Integer.valueOf(v.trim()); } catch (NumberFormatException e) { return null; }
    }

    private static Long asLongOrNull(String v) {
        if (v == null || v.isBlank()) return null;
        try { return Long.valueOf(v.trim()); } catch (NumberFormatException e) { return null; }
    }

    private static long asLong(String code) {
        Long l = asLongOrNull(code);
        if (l == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректный код шаблона: " + code);
        }
        return l;
    }

    /** Литерал массива Postgres: {a,b}. */
    private static String pgArray(List<String> values) {
        if (values == null || values.isEmpty()) return "{}";
        List<String> quoted = new ArrayList<>(values.size());
        for (String v : values) {
            if (v != null && !v.isBlank()) quoted.add("\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\"");
        }
        return "{" + String.join(",", quoted) + "}";
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    @SuppressWarnings("unchecked")
    private static List<String> toList(Object pgArray) {
        if (pgArray == null) return List.of();
        try {
            Object arr = ((java.sql.Array) pgArray).getArray();
            List<String> out = new ArrayList<>();
            for (Object o : (Object[]) arr) if (o != null) out.add(String.valueOf(o));
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String text(JsonNode row, String field) {
        JsonNode v = row.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static String txt(JsonNode props, String field) {
        JsonNode v = props.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static Boolean bool(JsonNode row, String field) {
        JsonNode v = row.get(field);
        return v == null || v.isNull() ? null : v.asBoolean();
    }
}
