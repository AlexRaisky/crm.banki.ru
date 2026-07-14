package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.*;
import ru.banki.crm.dto.ChainRequest;
import ru.banki.crm.dto.TemplateDto;
import ru.banki.crm.dto.TemplateListItemDto;
import ru.banki.crm.repo.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
public class TemplateService {

    private final PushTemplateRepository pushRepo;
    private final EmailTemplateRepository emailRepo;
    private final SmsTemplateRepository smsRepo;
    private final CcSegmentRepository ccRepo;
    private final TemplateMapper mapper;
    private final AuditContext audit;

    public TemplateService(PushTemplateRepository pushRepo, EmailTemplateRepository emailRepo,
                           SmsTemplateRepository smsRepo, CcSegmentRepository ccRepo,
                           TemplateMapper mapper, AuditContext audit) {
        this.pushRepo = pushRepo;
        this.emailRepo = emailRepo;
        this.smsRepo = smsRepo;
        this.ccRepo = ccRepo;
        this.mapper = mapper;
        this.audit = audit;
    }

    // ------------------------------------------------------------------- LIST
    @Transactional(readOnly = true)
    public List<TemplateListItemDto> list(String channel, String product, String touch,
                                          String trigger, String active) {
        List<TemplateBase> all = new ArrayList<>();
        all.addAll(pushRepo.findAll());
        all.addAll(emailRepo.findAll());
        all.addAll(smsRepo.findAll());
        all.addAll(ccRepo.findAll());

        return all.stream()
                .map(mapper::toListItem)
                .filter(i -> channel == null || channel.isBlank() || channel.equals(i.channel()))
                .filter(i -> touch == null || touch.isBlank() || touch.equals(i.touchPoint()))
                .filter(i -> trigger == null || trigger.isBlank() || trigger.equals(i.triggerType()))
                .filter(i -> product == null || product.isBlank()
                        || (i.productType() != null && i.productType().contains(product)))
                .filter(i -> active == null || active.isBlank()
                        || ("active".equals(active) == Boolean.TRUE.equals(i.active())))
                .sorted((a, b) -> {
                    int c = a.channel().compareTo(b.channel());
                    return c != 0 ? c : nullSafe(a.code()).compareTo(nullSafe(b.code()));
                })
                .toList();
    }

    private static String nullSafe(String s) {
        return s == null ? "" : s;
    }

    // -------------------------------------------------------------------- GET
    @Transactional(readOnly = true)
    public TemplateDto get(String channel, String code) {
        return mapper.toDto(load(channel, code));
    }

    // ----------------------------------------------------------------- CREATE
    @Transactional
    public String create(TemplateDto dto) {
        audit.mark();
        return switch (norm(dto.getChannel())) {
            case "push" -> {
                PushTemplate p = new PushTemplate();
                mapper.apply(p, dto);
                p.setCode(pushRepo.maxCode() + 1);
                yield String.valueOf(pushRepo.save(p).getCode());
            }
            case "sms" -> {
                SmsTemplate s = new SmsTemplate();
                mapper.apply(s, dto);
                s.setCode(smsRepo.maxCode() + 1);
                yield String.valueOf(smsRepo.save(s).getCode());
            }
            case "email" -> {
                EmailTemplate em = new EmailTemplate();
                mapper.apply(em, dto);
                yield String.valueOf(emailRepo.save(em).getId());
            }
            case "cc" -> {
                CcSegment c = new CcSegment();
                if (dto.getCode() == null || dto.getCode().isBlank()) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Для КЦ обязателен номер сегмента");
                }
                c.setSegment(Integer.valueOf(dto.getCode().trim()));  // id (PK) is auto-generated
                mapper.apply(c, dto);
                yield String.valueOf(ccRepo.save(c).getSegment());
            }
            default -> throw badChannel(dto.getChannel());
        };
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
        // shallow field copy is enough — DTO holds only value types / immutable lists here
        org.springframework.beans.BeanUtils.copyProperties(base, d);
        d.setSendingDay(day);
        return d;
    }

    // ----------------------------------------------------------------- UPDATE
    @Transactional
    public void update(String channel, String code, TemplateDto dto) {
        audit.mark();
        TemplateBase e = load(channel, code);
        dto.setChannel(channel);
        mapper.apply(e, dto);
        // managed entity — flush on commit
    }

    // ----------------------------------------------------------------- DELETE
    @Transactional
    public void delete(String channel, String code) {
        audit.mark();
        TemplateBase e = load(channel, code);
        switch (norm(channel)) {
            case "push" -> pushRepo.delete((PushTemplate) e);
            case "sms" -> smsRepo.delete((SmsTemplate) e);
            case "email" -> emailRepo.delete((EmailTemplate) e);
            case "cc" -> ccRepo.delete((CcSegment) e);
            default -> throw badChannel(channel);
        }
    }

    // ------------------------------------------------------------------ helpers
    private TemplateBase load(String channel, String code) {
        Optional<? extends TemplateBase> found = switch (norm(channel)) {
            case "push" -> pushRepo.findFirstByCode(Integer.valueOf(code));
            case "sms" -> smsRepo.findFirstByCode(Integer.valueOf(code));
            case "email" -> emailRepo.findById(Long.valueOf(code));
            case "cc" -> ccRepo.findFirstBySegment(Integer.valueOf(code));
            default -> throw badChannel(channel);
        };
        return found.orElseThrow(() -> new ResponseStatusException(
                HttpStatus.NOT_FOUND, "Шаблон не найден: " + channel + "/" + code));
    }

    private static String norm(String channel) {
        return channel == null ? "" : channel.trim().toLowerCase();
    }

    private static ResponseStatusException badChannel(String channel) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный канал: " + channel);
    }
}
