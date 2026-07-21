package ru.banki.crm.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import ru.banki.crm.security.CurrentUser;

import java.util.Map;

/**
 * Единый справочник шаблонов template.d_template — ЕДИНСТВЕННОЕ наше хранилище шаблонов.
 * payload для синка собирается из d_template (см. TemplateStore.prodPayload) и кладётся
 * в очередь app.prod_sync (outbox), откуда доставляется во ВНЕШНЮЮ прод-БД (ProdDbService).
 * Имена внешних прод-таблиц отдаёт channelTable(); локальных копий этих таблиц у нас нет.
 *
 * Вызывается после каждой операции мастера (TemplateService) и при материализации цепочек.
 */
@Service
public class UnifiedTemplateService {

    /**
     * @param codeLimit верхняя граница бизнес-кода (исключительно): код выделяется
     *                  в диапазоне ниже неё. null — без ограничения.
     */
    public record ChannelTable(String table, String codeCol, boolean hasNight,
                               boolean prodAssignsCode, Long codeLimit) {}

    /** (таблица, колонка бизнес-кода, есть ли night_send, генерит ли код прод-БД, лимит кода). */
    public static ChannelTable channelTable(String channel) {
        return switch (channel == null ? "" : channel) {
            // SMS и Email нумеруются в диапазоне до 10000 (выше — служебные коды прода)
            case "sms" -> new ChannelTable("notice.d_com_sms_template", "code", true, true, 10000L);
            case "push" -> new ChannelTable("notice.push_template", "code", true, true, null);
            case "email" -> new ChannelTable("notice.email_template", "id", false, true, 10000L);
            // у КЦ код (segment) — бизнес-ключ, задаётся пользователем, прод его не переназначает;
            // суррогатный id прод выдаёт по счётчику
            case "cc" -> new ChannelTable("callcenter.d_segment_properties", "segment", false, false, null);
            // Новые типы. Схема прод-таблиц (notice.*) — предварительная, уточняется при
            // подключении доставки; PK = id, отдельной «code»-колонки нет → codeCol = id (прод присваивает).
            case "fa" -> new ChannelTable("notice.fa_template", "id", false, true, null);
            case "vk" -> new ChannelTable("notice.vk_template", "id", false, true, null);
            case "la" -> new ChannelTable("notice.live_activity_template", "id", true, true, null);
            default -> null;
        };
    }

    /**
     * Канальные поля, которые прод-таблица требует непустыми (NOT NULL без DEFAULT).
     * Подставляются и при записи в d_template, и при доставке — чтобы уже стоящие
     * в очереди записи уехали без ручной правки payload.
     */
    public static Map<String, String> prodDefaults(String channel) {
        return switch (channel == null ? "" : channel) {
            case "email" -> Map.of("subject", "");
            default -> Map.of();
        };
    }

    @PersistenceContext
    private EntityManager em;

    /** Адрес внешней прод-БД (пусто = синк не настроен, очередь не ведём). */
    @org.springframework.beans.factory.annotation.Value("${app.proddb.url:}")
    private String prodDbUrl;

    private boolean prodConfigured() {
        return prodDbUrl != null && !prodDbUrl.isBlank();
    }

    /** Удаление из единого справочника (при удалении шаблона в мастере). */
    public void deleteUnified(String channel, long code) {
        em.createNativeQuery("DELETE FROM template.d_template WHERE channel = :ch AND code = :c")
                .setParameter("ch", channel)
                .setParameter("c", code)
                .executeUpdate();
    }

    /**
     * Поставить операцию в очередь синка с прод-БД (outbox). payload — строка канальной таблицы 1:1.
     * Пока прод-БД не подключена (PROD_DB_URL пуст), очередь НЕ ведём: копить нечего и некуда,
     * записи появятся только с момента реального подключения.
     */
    public void enqueueProdSync(String channel, String operation, Long localCode, String payloadJson) {
        if (payloadJson == null || !prodConfigured()) return;
        em.createNativeQuery("INSERT INTO app.prod_sync (channel, operation, local_code, payload, created_by)" +
                        " VALUES (:ch, :op, :c, CAST(:p AS jsonb), :u)")
                .setParameter("ch", channel)
                .setParameter("op", operation)
                .setParameter("c", localCode)
                .setParameter("p", payloadJson)
                .setParameter("u", CurrentUser.email())
                .executeUpdate();
    }

    /** Смена кода после присвоения прод-БД: единый справочник d_template + хвост очереди. */
    public void applyProdCode(String channel, long localCode, long prodCode) {
        if (localCode == prodCode) return;
        ChannelTable ct = channelTable(channel);
        if (ct == null || !ct.prodAssignsCode()) return;
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
