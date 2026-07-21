package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.dto.ChainRequest;
import ru.banki.crm.dto.TemplateDto;
import ru.banki.crm.dto.TemplateListItemDto;

import java.util.ArrayList;
import java.util.List;

/**
 * CRUD шаблонов новой архитектуры. Единственное хранилище — template.d_template
 * (см. {@link TemplateStore}); канальные таблицы notice и callcenter не читаются
 * и не пишутся. В прод-БД строка уезжает очередью синка (app.prod_sync) уже
 * собранной в прод-структуру.
 */
@Service
public class TemplateService {

    private final TemplateStore store;
    private final AuditContext audit;
    private final AdminLogService adminLog;
    private final UnifiedTemplateService unified;

    public TemplateService(TemplateStore store, AuditContext audit,
                           AdminLogService adminLog, UnifiedTemplateService unified) {
        this.store = store;
        this.audit = audit;
        this.adminLog = adminLog;
        this.unified = unified;
    }

    // ------------------------------------------------------------------- LIST
    @Transactional(readOnly = true)
    public List<TemplateListItemDto> list(String channel, String product, String touch,
                                          String trigger, String active) {
        return store.list().stream()
                .filter(i -> channel == null || channel.isBlank() || channel.equals(i.channel()))
                .filter(i -> touch == null || touch.isBlank() || touch.equals(i.touchPoint()))
                .filter(i -> trigger == null || trigger.isBlank() || trigger.equals(i.triggerType()))
                .filter(i -> product == null || product.isBlank()
                        || (i.productType() != null && i.productType().contains(product)))
                .filter(i -> active == null || active.isBlank()
                        || ("active".equals(active) == Boolean.TRUE.equals(i.active())))
                .toList();
    }

    // -------------------------------------------------------------------- GET
    @Transactional(readOnly = true)
    public TemplateDto get(String channel, String code) {
        return store.get(norm(channel), code);
    }

    // ----------------------------------------------------------------- CREATE
    @Transactional
    public String create(TemplateDto dto) {
        audit.mark();
        String channel = norm(dto.getChannel());
        if (!List.of("sms", "push", "email", "cc", "fa", "vk", "la").contains(channel)) {
            throw badChannel(dto.getChannel());
        }
        long code;
        if ("cc".equals(channel)) {
            // у КЦ бизнес-ключ (segment) задаёт пользователь
            if (dto.getCode() == null || dto.getCode().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Для КЦ обязателен номер сегмента");
            }
            code = Long.parseLong(dto.getCode().trim());
            if (store.exists(channel, String.valueOf(code))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Сегмент уже заведён: " + code);
            }
        } else {
            code = store.nextCode(channel);
        }
        store.insert(channel, code, dto);

        String codeStr = String.valueOf(code);
        adminLog.logTable("template.d_template", "INSERT", store.rowJson(channel, codeStr));
        unified.enqueueProdSync(channel, "INSERT", code, store.prodPayload(channel, codeStr));
        return codeStr;
    }

    // ------------------------------------------------------------- CREATE CHAIN
    /** Один транзакционный batch вместо N отдельных INSERT-ов (v2 крутил цикл на клиенте). */
    @Transactional
    public List<String> createChain(ChainRequest req) {
        if (req.getBase() == null || req.getDays() == null || req.getDays().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нужны base и непустой список days");
        }
        List<String> created = new ArrayList<>();
        for (String day : req.getDays()) {
            TemplateDto copy = cloneWithDay(req.getBase(), day);
            created.add(create(copy));
        }
        return created;
    }

    private TemplateDto cloneWithDay(TemplateDto base, String day) {
        TemplateDto d = new TemplateDto();
        org.springframework.beans.BeanUtils.copyProperties(base, d);
        d.setSendingDay(day);
        return d;
    }

    // ----------------------------------------------------------------- UPDATE
    @Transactional
    public void update(String channel, String code, TemplateDto dto) {
        audit.mark();
        String ch = norm(channel);
        // old_row: состояние ДО изменения
        adminLog.logTable("template.d_template", "UPDATE", store.rowJson(ch, code));
        dto.setChannel(ch);
        store.update(ch, code, dto);
        unified.enqueueProdSync(ch, "UPDATE", Long.parseLong(code.trim()), store.prodPayload(ch, code));
    }

    // ----------------------------------------------------------------- DELETE
    @Transactional
    public void delete(String channel, String code) {
        audit.mark();
        String ch = norm(channel);
        if (!store.exists(ch, code)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Шаблон не найден: " + ch + "/" + code);
        }
        // old_row: удаляемая строка; тот же payload уедет DELETE-ом в прод
        String payload = store.prodPayload(ch, code);
        adminLog.logTable("template.d_template", "DELETE", store.rowJson(ch, code));
        store.delete(ch, code);
        unified.enqueueProdSync(ch, "DELETE", Long.parseLong(code.trim()), payload);
    }

    // ------------------------------------------------------------------ helpers
    private static String norm(String channel) {
        return channel == null ? "" : channel.trim().toLowerCase();
    }

    private static ResponseStatusException badChannel(String channel) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный канал: " + channel);
    }
}
